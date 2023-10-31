import fs from "fs";
import path from "path";
import { Agent } from "./agent";

import { Tracer } from "./tracer";

import {
  Result,
  TypeChatJsonTranslator,
  createJsonTranslator,
  createLanguageModel,
  error,
  success,
} from "typechat";
import { AskAgentStep, Plan } from "./orchestratorProgram";

// importing the schema source for OrchestratorInterface needed to construct the orchestrator prompt
const planSchemaTextTemplate = fs.readFileSync(
  path.join(__dirname, "orchestratorProgram.d.ts"),
  "utf8"
);

function isIntermediatePlan(plan: Plan): boolean {
  return plan.steps !== undefined;
}

function isFinalPlan(plan: Plan): boolean {
  return plan.outputMessage !== undefined;
}

export class OrchestratorPlanner {
  #env: Record<string, string | undefined>;
  #agents: Map<string, Agent>;
  #turns = 0;
  #maxTurns: number;
  #rootTracer: Tracer;
  #operations: { question: string, answer: string }[] = [];
  #request: string;

  constructor(
    env: Record<string, string | undefined>,
    agents: Map<string, Agent>,
    options: {
      maxTurns?: number;
      maxRepairAttempts?: number;
      tracer: Tracer;
      request: string;
    }
  ) {
    this.#env = env;
    this.#agents = agents;
    this.#maxTurns = options?.maxTurns ?? 3;
    this.#rootTracer = options.tracer;
    this.#request = options.request;
  }

  async ErrorMessage(reason: string): Promise<string> {
    return `Sorry, I cannot complete the task. ${reason}`;
  }

  async OutputMessage(message: string): Promise<string> {
    return message;
  }

  async plan(): Promise<string> {
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
        prompt: this.#request,
        cachedResults: this.#operations,
      }
    );
    const plan = await this.#createPlan(childTracer);
    if (isIntermediatePlan(plan) && plan.steps) {
      const results = await this.#evaluateSteps(plan.steps, childTracer);
      await childTracer.success({
        refs: results,
      });
      return await this.#execute();
    } else {
      // final step was reached
      return [plan.outputMessage];
    }
  }

  async #handleCall(
    parentTracer: Tracer,
    name: string,
    programSpec: string,
  ): Promise<unknown> {
    // delegating to an agent as part of the plan
    const agent = this.#agents.get(name);
    if (agent) {
      const childTracer = await parentTracer.sub(
        `Orchestrator.${name}`,
        "chain",
        {
          prompt: programSpec,
        }
      );
      try {
        const plan = await agent.plan(programSpec, childTracer);
        const response = await agent.execute(plan, childTracer);
        this.#operations.push({ question: programSpec, answer: response });
        await childTracer.success({
          response,
        });
        return response;
      } catch (e) {
        const { message } = (e as Error);
        this.#operations.push({ question: programSpec, answer: message });
        await childTracer.error('Internal Error: Agent ${name} failed to handle request', {
          message
        });
        return message;
      }
    }
    throw new TypeError(`Invalid Agent ${name}`);
  }

  #createRequestPrompt(): string {
    return planSchemaTextTemplate
      .replace("\"/*AGENT_NAMES_PLACEHOLDER*/\"", this.#renderCapabilities())
      .replace("[/*AGENT_MEMORY*/]", JSON.stringify(this.#operations, null, 2));
  }

  async #createPlan(
    parentTracer: Tracer
  ): Promise<Plan> {
    const childTracer = await parentTracer.sub(`Orchestrator.Planner`, "tool", {
      prompt: this.#request,
    });

    const model = createLanguageModel(this.#env);
    const schema = this.#createRequestPrompt();
    const PlanTranslator: TypeChatJsonTranslator<Plan> =
      createJsonTranslator<Plan>(
        {
          async complete(prompt: string): Promise<Result<string>> {
            const llmTracer = await childTracer.sub(`Orchestrator.TypeChat`, "llm", { prompt });
            const response = await model.complete(prompt);
            llmTracer.success({ response });
            return response;
          },
        },
        schema,
        "Plan"
      );
    PlanTranslator.validateInstance = this.#extendedValidation.bind(this);
    
    const response = await PlanTranslator.translate(`${this.#request}. Utilize information from memory when possible to avoid asking an agent again.`);
    if (!response.success) {
      await childTracer.error(response.message, {
        response,
      });
      throw new Error(`Unable to construct a plan to answer the the question.`);
    }
    await childTracer.success({
      response,
    });
    return response.data;
  }

  #extendedValidation(plan: Plan): Result<Plan> {
    const errors: string[] = [];

    let hasAgentCall = false;
    let memoryMatches = 0;
    let agentCalls = 0;

    if (isIntermediatePlan(plan) && plan.steps) {
      if (plan.steps && plan.steps.length === 0) {
        errors.push(`Invalid Plan. steps cannot be empty.`);
      }
      for (let i = 0; i < plan.steps.length; i++) {
        const step = plan.steps[i];
        hasAgentCall = true;
        agentCalls++;
        if (this.#operations.find(({ question }) => question === step.question)) {
          errors.push(`Invalid Plan. steps[${i}]'s question "${step.question}" already has an answer in Memory. You must not ask the same question twice.`);
          memoryMatches++;
        }
      }
    }

    if (isFinalPlan(plan)) {
      if (plan.isError && this.#turns === 1) {
        errors.push(`Invalid Plan. You must use an IntermediatePlan to gather information, or produce an error.`);
      }
      if (!plan.outputMessage) {
        errors.push(`Invalid FinalPlan. outputMessage cannot be empty.`);
      }
      if (hasAgentCall) {
        errors.push(`Ambigous Plan. If more information is needed, you must use a IntermediatePlan that relies on at least one AskAgentStep, else, you must use a FinalPlan to interpret the information from memory, and finish.`);
      }
    }

    if (agentCalls > 0 && memoryMatches === agentCalls) {
      errors.push(`All the information needed to solve the request is available in Memory, you should be able to write a FinalPlan with the outputMessage.`);
    }

    if (errors.length > 0) {
      return error(errors.join('\n'));
    }

    return success(plan);
  }

  /**
   * Evaluates a list of steps. It returns an array of results, one for each step.
   */
  async #evaluateSteps(steps: AskAgentStep[], parentTracer: Tracer): Promise<unknown[]> {
    const evaluateStep = async (step: AskAgentStep): Promise<unknown> => {
      return await this.#handleCall(parentTracer, step.agent, step.question);
    };
    return await Promise.all(steps.map(evaluateStep));
  }

  #renderCapabilities() {
    return [...this.#agents.entries()]
      .map(
        ([name, { description }]) =>
          `/* ${description} */\n  "${name}"`
      )
      .join(" |\n  ");
  }

}
