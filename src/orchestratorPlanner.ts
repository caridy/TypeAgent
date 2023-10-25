import fs from "fs";
import path from "path";
import { Agent, Asyncify } from "./agent";
import { ChatMessage, OpenAIModel } from "./model";

import { Tracer } from "./tracer";
import { stringify } from "json-to-pretty-yaml";

import {
  Result,
  Success,
  TypeChatJsonValidator,
  createJsonValidator,
  createModuleTextFromProgram,
  error,
  success,
} from "typechat";
import { ReActBaseCapabilities, ReflectionRecord } from "./orchestratorSchema";
import { TurnProgram } from "./orchestratorProgram";

// importing the schema source for OrchestratorInterface needed to construct the orchestrator prompt
const programSchemaText = fs.readFileSync(
  path.join(__dirname, "orchestratorProgram.d.ts"),
  "utf8"
);

export class OrchestratorPlanner implements Asyncify<ReActBaseCapabilities> {
  #agents: Map<string, Agent>;
  #turns = 0;
  #maxTurns: number;
  #maxRepairAttempts: number;
  #rootTracer: Tracer;
  #model: OpenAIModel;
  #validator: TypeChatJsonValidator<TurnProgram>;
  #messages: ChatMessage[] = [];
  #request: string;

  constructor(
    model: OpenAIModel,
    agents: Map<string, Agent>,
    schema: string,
    options: {
      maxTurns?: number;
      maxRepairAttempts?: number;
      tracer: Tracer;
      request: string;
    }
  ) {
    this.#model = model;
    this.#agents = agents;
    this.#maxTurns = options?.maxTurns ?? 3;
    this.#maxRepairAttempts = options?.maxRepairAttempts ?? 2;
    this.#rootTracer = options.tracer;
    this.#validator = createJsonValidator<TurnProgram>(schema, "TurnProgram");
    this.#validator.createModuleTextFromJson = createModuleTextFromProgram;
    this.#messages.push(this.#createSystemPrompt());
    this.#request = options.request;
  }

  async WriteThoughts(input: ReflectionRecord): Promise<ReflectionRecord> {
    return input;
  }

  async ErrorMessage(reason: string): Promise<string> {
    return `Sorry, I cannot complete the task. ${reason}`;
  }

  async OutputMessage(message: string, data: { [key: string]: unknown; } ): Promise<string> {
    if (Object.keys(data).length > 0) {
      return `${message}\n${stringify(data)}`;
    }
    return message;
  }

  async NextTurn(): Promise<void> {
    return;
  }

  async plan(): Promise<string> {
    this.#messages.push(this.#createRequestPrompt());
    const result = await this.#execute();
    return result.pop() as string;
  }

  async #execute(): Promise<unknown[]> {
    this.#turns++;
    if (this.#turns > this.#maxTurns) {
      return [
        {
          Error: "StackOverflow",
          Escalation: `Maximun number of turns reached (${
            this.#maxTurns
          }). Please try again later.`,
        },
      ];
    }
    const childTracer = await this.#rootTracer.sub(
      `Orchestrator.Thinking.Turn[${this.#turns}]`,
      "tool",
      {
        messages: this.#messages,
      }
    );
    const response = await this.#translate(childTracer);
    const program = response.data;
    const results = await this.#evaluate(program, childTracer);
    await childTracer.success({
      refs: results,
    });
    const len = program["@steps"].length;
    const lastStep = program["@steps"][len - 1];
    if (lastStep["@func"] === "NextTurn") {
      // recursive call to execute the next turn
      this.#messages.push({
        role: "user",
        content:
          `The following are the results of each step's FunctionCall from turn #${
            this.#turns
          } where each position in the array corresponds to every ResultReference:\n` +
          `\`\`\`\n${JSON.stringify(results, null, 2)}\n\`\`\`\n` +
          `With this new information, write a new TurnProgram to solve the original user's request:\n` +
          `"""\n${this.#request}\n"""\n` +
          `The following is the TurnProgram as a JSON object ready for evaluation:\n`,
      });
      return await this.#execute();
    }
    // final step was reached
    return results;
  }

  async #handleCall(
    parentTracer: Tracer,
    name: string,
    args: unknown[]
  ): Promise<unknown> {
    if (name in this) {
      // calling a method of the planner as part of the program
      // @ts-ignore
      return await this[name as keyof OrchestratorPlanner](...args);
    }
    // delegating to an agent as part of the program
    const agent = this.#agents.get(name);
    if (agent) {
      const [prompt] = args as [string];
      const childTracer = await parentTracer.sub(
        `Orchestrator.${name}`,
        "chain",
        {
          prompt,
        }
      );
      try {
        const program = await agent.plan(prompt, childTracer);
        const response = await agent.execute(program, childTracer);
        await childTracer.success({
          response,
        });
        return response;
      } catch (e) {
        const { message } = (e as Error);
        await childTracer.error('Internal Error: Agent ${name} failed to handle request', {
          message
        });
        return message;
      }
    }
    throw new TypeError(`Invalid Agent ${name}`);
  }

  #createSystemPrompt(): ChatMessage {
    return {
      role: "system",
      content:
        `You are a service that translates user requests into programs represented as JSON using the following TypeScript definitions:\n` +
        `\`\`\`\n${programSchemaText}\`\`\`\n` +
        `A TurnProgram can call functions from the API defined in the following TypeScript definitions:\n` +
        `\`\`\`\n${this.#validator.schema}\`\`\`\n`,
    };
  }

  #createRequestPrompt(): ChatMessage {
    return {
      role: "user",
      content:
        `The following is a user request:\n` +
        `"""\n${this.#request}\n"""\n` +
        `The following is the user request translated into a JSON TurnProgram object with 2 spaces of indentation and no properties with the value undefined:\n`,
    };
  }

  #createRepairPrompt(validationError: string): ChatMessage {
    return {
      role: "user",
      content:
        `The JSON TurnProgram object is invalid for the following reason:\n` +
        `"""\n${validationError}\n"""\n` +
        `The following is a revised JSON TurnProgram object:\n`,
    };
  }

  async #translate(tracer: Tracer): Promise<Success<TurnProgram>> {
    let repairAttempts = 0;
    while (true) {
      const { role, content } = await this.#model.chat(
        this.#messages,
        tracer
      );
      if (repairAttempts > 0) {
        // remove the program and error from the previous repair attempt from history
        this.#messages.splice(-2);
      }
      this.#messages.push({ role, content });
      const childRun = await tracer.sub("TypeChat.Validation", "parser", {
        content,
      });
      const startIndex = content.indexOf("{");
      const endIndex = content.lastIndexOf("}");
      if (!(startIndex >= 0 && endIndex > startIndex)) {
        await childRun.error(`Response is not a valid JSON structure`, {
          generations: [content],
        });
      } else {
        const jsonText = content.slice(startIndex, endIndex + 1);
        const schemaValidation = this.#validator.validate(jsonText);
        const validation = schemaValidation.success
          ? this.#extendedValidation(schemaValidation.data)
          : schemaValidation;
        if (validation.success) {
          await childRun.success(validation);
          return validation;
        }
        await childRun.error(`Program validation failed`, validation);
        this.#messages.push(this.#createRepairPrompt(validation.message));
      }
      // attempting to repair the program
      repairAttempts++;
      if (repairAttempts > this.#maxRepairAttempts) {
        // remove the last error to avoid carrying that over to the next turn
        this.#messages.splice(-1);
        throw new Error('Unable to construct a program to answer the the question.');
      }
    }
  }

  #extendedValidation(data: TurnProgram): Result<TurnProgram> {
    const errors: string[] = [];
    const steps = data["@steps"];
    const len = steps.length;
    const firstStep = steps[0];
    const lastStep = steps[len - 1];

    let hasAgentCall = false;
    let hasOutputMessage = false;
    let howManyOutputMessage = 0;
    let hasErrorMessage = false;
    let howManyErrorMessage = 0;
    let hasNextTurn = false;
    let hasWriteThoughts = false;

    for (let i = 0; i < len - 1; i++) {
      const step = steps[i];
      if (step["@func"] === "WriteThoughts") {
        hasWriteThoughts = true;
      } else if (step["@func"] === "OutputMessage") {
        howManyOutputMessage++;
        hasOutputMessage = true;
      } else if (step["@func"] === "ErrorMessage") {
        howManyErrorMessage++;
        hasErrorMessage = true;
      } else if (step["@func"] === "NextTurn") {
        hasNextTurn = true;
      } else {
        hasAgentCall = true;
      }
    }

    // correcting common mistakes from GPT3.5
    if (hasAgentCall && !hasNextTurn && !hasOutputMessage && !hasErrorMessage) {
      // usually means we are gathering info via AgentCall
      // @ts-ignore this step is safe to add
      steps.push({ "@func": "NextTurn", "@args": [] });
      hasNextTurn = true;
    }

    if (!hasWriteThoughts || firstStep["@func"] !== "WriteThoughts") {
      errors.push(`Invalid TurnProgram. The first step must be WriteThoughtsStep.`);
    }
    if (lastStep["@func"] === "OutputMessage" || lastStep["@func"] === "ErrorMessage") {
      if (hasAgentCall) {
        errors.push(`Ambigous TurnProgram. If more information is needed, you must use a IntermediateProgram that relies on at least one AgentCallStep, else, you must use a FinalProgram with the following steps: [WriteThoughtsStep, OutputMessageStep | ErrorMessageStep] to interpret the information gathered, and finish.`);
      }
      if (howManyErrorMessage > 1) {
        errors.push(`Invalid TurnProgram. Only one ErrorMessageStep is allowed as the last step of a FinalProgram.`);
      }
      if (howManyOutputMessage > 1) {
        errors.push(`Invalid TurnProgram. Only one OutputMessageStep is allowed as the last step of a FinalProgram.`);
      }
    } else {
      if (!hasAgentCall) {
        if (lastStep["@func"] === "NextTurn") {
          errors.push(`Ambiguous TurnProgram. No new information is being collected by an AgentCallStep, however the program is not a valid FinalProgram because it is calling NextTurnStep. If you have all the necessary information, use OutputMessageStep or ErrorMessageStep instead to make it a FinalProgram, otherwise you must add at least one AgentCallStep before calling NextTurnStep to make it a valid IntermediateProgram.`);
        } else {
          errors.push(`Invalid FinalProgram. You must use OutputMessageStep or ErrorMessageStep in the final step of the program.`);
        }
      }

      let hasCalledSomethingElse = false;
      for (let i = 1; i < len - 1; i++) {
        const step = steps[i];
        if (step["@func"] === "WriteThoughts") {
          if (hasCalledSomethingElse) {
            errors.push(`Invalid WriteThoughtsStep in step ${i + 1}, it can only appear before an AgentCall step.`);
          }
        } else {
          hasCalledSomethingElse = true;
        }
      }
    }

    if (errors.length > 0) {
      return error(errors.join('\n'));
    }

    return success(data);
  }

  /**
   * Evaluates a JSON program using a simple interpreter. It returns an array of results, one for each step.
   */
  async #evaluate(program: TurnProgram, parentTracer: Tracer): Promise<unknown[]> {
    const evaluate = async (expr: unknown): Promise<unknown> => {
      return typeof expr === "object" && expr !== null
        ? await evaluateObject(expr as Record<string, unknown>)
        : expr;
    };

    const evaluateObject = async (obj: Record<string, unknown>) => {
      if (obj.hasOwnProperty("@ref")) {
        const index = obj["@ref"];
        if (typeof index === "number" && index < results.length) {
          return results[index];
        }
      } else if (obj.hasOwnProperty("@func")) {
        const func = obj["@func"];
        const args = obj.hasOwnProperty("@args") ? obj["@args"] : [];
        if (typeof func === "string" && Array.isArray(args)) {
          return await this.#handleCall(
            parentTracer,
            func,
            await evaluateArray(args)
          );
        }
      } else if (Array.isArray(obj)) {
        return evaluateArray(obj);
      } else {
        const values = await Promise.all(Object.values(obj).map(evaluate));
        return Object.fromEntries(
          Object.keys(obj).map((k, i) => [k, values[i]])
        );
      }
    };

    const evaluateArray = (array: unknown[]) => {
      return Promise.all(array.map(evaluate));
    };

    const results: unknown[] = [];
    for (const expr of program["@steps"]) {
      results.push(await evaluate(expr));
    }
    return results;
  }
}
