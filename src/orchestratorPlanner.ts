import { Agent, Asyncify } from "./agent";
import { ChatMessage, OpenAIModel } from "./model";
import type {
  EscalationMessage,
  FinalAnswer,
  OrchestratorInterface,
  ReflectionRecord,
} from "./orchestratorSchema";
import { Tracer } from "./tracer";

import {
  Program,
  Result,
  Success,
  TypeChatJsonValidator,
  createJsonValidator,
  createModuleTextFromProgram,
  error,
  success,
} from "typechat";

const programSchemaText = `// A program consists of a sequence of function calls that are evaluated in order.
export type Program = {
    "@steps": FunctionCall[];
}

// A function call specifies a function name and a list of argument expressions. Arguments may contain
// nested function calls and result references.
export type FunctionCall = {
    // Name of the function
    "@func": string;
    // Arguments for the function, if any
    "@args"?: Expression[];
};

// An expression is a JSON value, a function call, or a reference to the result of a preceding expression.
export type Expression = JsonValue | FunctionCall | ResultReference;

// A JSON value is a string, a number, a boolean, null, an object, or an array. Function calls and result
// references can be nested in objects and arrays.
export type JsonValue = string | number | boolean | null | { [x: string]: Expression } | Expression[];

// A result reference represents the value of an expression from a preceding step.
export type ResultReference = {
    // Index of the previous expression in the "@steps" array
    "@ref": number;
};
`;

export class OrchestratorPlanner implements Asyncify<OrchestratorInterface> {
  #agents: Map<string, Agent>;
  #turns = 0;
  #maxTurns: number;
  #maxRepairAttempts: number;
  #rootTracer: Tracer;
  #model: OpenAIModel;
  #validator: TypeChatJsonValidator<Program>;
  #messages: ChatMessage[] = [];

  constructor(
    model: OpenAIModel,
    agents: Map<string, Agent>,
    schema: string,
    options: {
      maxTurns?: number;
      maxRepairAttempts?: number;
      tracer: Tracer;
    }
  ) {
    this.#model = model;
    this.#agents = agents;
    this.#maxTurns = options?.maxTurns ?? 3;
    this.#maxRepairAttempts = options?.maxRepairAttempts ?? 2;
    this.#rootTracer = options.tracer;
    this.#validator = createJsonValidator<Program>(schema, "Program");
    this.#validator.createModuleTextFromJson = createModuleTextFromProgram;
    this.#messages.push(this.#createSystemPrompt());
  }

  async WriteThoughts(input: ReflectionRecord): Promise<ReflectionRecord> {
    return input;
  }

  async DeadEnd(Escalation: string): Promise<EscalationMessage> {
    return {
      Error: "DeadEnd",
      Escalation,
    };
  }

  async CompleteAssignment(answer: string): Promise<FinalAnswer> {
    return {
      CompleteAssignment: answer,
    };
  }

  async NextTurn(): Promise<void> {
    return;
  }

  async plan(request: string): Promise<EscalationMessage | FinalAnswer> {
    this.#messages.push(this.#createRequestPrompt(request));
    const result = await this.#execute();
    return result.pop() as FinalAnswer | EscalationMessage;
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
          `With this new information, write a new program to solve the original user's request.\n` +
          `The following is the next turn JSON program object ready for evaluation:\n`,
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
      const response = await agent.execute(prompt, childTracer);
      await childTracer.success({
        response,
      });
      return response;
    }
    throw new TypeError(`Invalid Agent ${name}`);
  }

  #createSystemPrompt(): ChatMessage {
    return {
      role: "system",
      content:
        `You are a service that translates user requests into programs represented as JSON using the following TypeScript definitions:\n` +
        `\`\`\`\n${programSchemaText}\`\`\`\n` +
        `The programs can call functions from the API defined in the following TypeScript definitions:\n` +
        `\`\`\`\n${this.#validator.schema}\`\`\`\n`,
    };
  }

  #createRequestPrompt(request: string): ChatMessage {
    return {
      role: "user",
      content:
        `The following is a user request:\n` +
        `"""\n${request}\n"""\n` +
        `The following is the user request translated into a JSON program object with 2 spaces of indentation and no properties with the value undefined:\n`,
    };
  }

  #createRepairPrompt(validationError: string): ChatMessage {
    return {
      role: "user",
      content:
        `The JSON program object is invalid for the following reason:\n` +
        `"""\n${validationError}\n"""\n` +
        `The following is a revised JSON program object:\n`,
    };
  }

  async #translate(tracer: Tracer): Promise<Success<Program>> {
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
      // remove the last error
      this.#messages.splice(-1);
      if (repairAttempts > this.#maxRepairAttempts) {
        throw new Error('Invalid Program');
      }
    }
  }

  #extendedValidation(data: Program): Result<Program> {
    const len = data["@steps"].length;
    const firstStep = data["@steps"][0];
    const lastStep = data["@steps"][len - 1];
    if (
      lastStep["@func"] === "CompleteAssignment" ||
      lastStep["@func"] === "DeadEnd"
    ) {
      return len === 2 && firstStep["@func"] === "WriteThoughts"
        ? success(data)
        : error(
            `Invalid final turn program structure, it should have only 2 steps, WriteThoughts and CompleteAssignment or DeadEnd`
          );
    } else if (lastStep["@func"] === "NextTurn") {
      return len > 2 && firstStep["@func"] === "WriteThoughts"
        ? success(data)
        : error(
            `Invalid turn program structure. If it needs to collect more data from IAgents.*, then it should have at least 3 steps, WriteThoughts, FunctionCalls and NextTurn, otherwise it should be a final turn program structure`
          );
    }
    return error(
      `Invalid program structure, it is neither a final turn program structure nor a turn program structure`
    );
  }

  /**
   * Evaluates a JSON program using a simple interpreter. It returns an array of results, one for each step.
   */
  async #evaluate(program: Program, parentTracer: Tracer): Promise<unknown[]> {
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
