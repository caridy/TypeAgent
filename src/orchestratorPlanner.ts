import fs from "fs";
import path from "path";
import { Agent } from "./agent";

import { Tracer } from "./tracer";

import {
  Result,
  TypeChatJsonTranslator,
  createJsonTranslator,
  error,
  success,
} from "typechat";
import { AskAgent, Plan } from "./orchestratorProgram";
import { OpenAIModel } from "./model";

// importing the schema source for OrchestratorInterface needed to construct the orchestrator prompt
const planSchemaTextTemplate = fs.readFileSync(
  path.join(__dirname, "orchestratorProgram.d.ts"),
  "utf8"
);

function isIntermediatePlan(plan: Plan): boolean {
  return plan.action !== undefined;
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
  #logStep: (content: string) => void;

  constructor(
    env: Record<string, string | undefined>,
    agents: Map<string, Agent>,
    options: {
      maxTurns?: number;
      maxRepairAttempts?: number;
      tracer: Tracer;
      request: string;
    },
    logStep: (content: string) => void
  ) {
    this.#env = env;
    this.#agents = agents;
    this.#maxTurns = options?.maxTurns ?? 3;
    this.#rootTracer = options.tracer;
    this.#request = options.request;
    this.#logStep = logStep;
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
    if (isIntermediatePlan(plan) && plan.action) {
      const results = await this.#evaluateAction(plan.action, childTracer);
      await childTracer.success({
        answer: results,
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

    const model = new OpenAIModel(this.#env, 'Orchestrator.TypeChat', ["orchestrator", "llm", "planner"]);
    model.tracer = childTracer;
    const schema = this.#createRequestPrompt();
    const PlanTranslator: TypeChatJsonTranslator<Plan> =
      createJsonTranslator<Plan>(
        model,
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

    if (this.#turns === 1 && !isIntermediatePlan(plan)) {
      errors.push(`Invalid Plan. You must use an action to gather information, or produce an error.`);
    }

    if (isIntermediatePlan(plan)) {
      if (this.#operations.find(({ question }) => question === plan.action?.question)) {
        errors.push(`Invalid Plan. action.question "${plan.action?.question}" already has an answer in Memory. You must not ask the same question twice.`);
        // errors.push(`All the information needed to solve the request is available in Memory, you should be able to write a FinalPlan with the outputMessage.`);
      }
      if (isFinalPlan(plan)) {
        errors.push(`Ambigous Plan. You cannot have an action and outputMessage at the same time. If more information is needed, you must use an action to AskAgent, else, you must use outputMessage.`);
      }
    } else if (isFinalPlan(plan)) {
      if (!plan.outputMessage) {
        errors.push(`Invalid Plan. outputMessage cannot be empty.`);
      }
      if (isIntermediatePlan(plan)) {
        errors.push(`Ambigous Plan. You cannot have an action and outputMessage at the same time. If more information is needed, you must use an action to AskAgent, else, you must use outputMessage.`);
      }
    } else {
      if (!isFinalPlan(plan) && !isIntermediatePlan(plan)) {
        errors.push(`Ambigous Plan. You must have an action or an outputMessage as part of the plan. If more information is needed, you must use an action to AskAgent, else, you must use outputMessage.`);
      }
    }

    if (errors.length > 0) {
      return error(errors.join('\n'));
    }

    return success(plan);
  }

  /**
   * Evaluates an action. It returns the answer from the agent.
   */
  async #evaluateAction(action: AskAgent, parentTracer: Tracer): Promise<unknown> {
    this.#logStep(action.speak);
    return await this.#handleCall(parentTracer, action.agent, action.question);
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
