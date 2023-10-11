import fs from "fs";
import path from "path";
import { createDefaultTracer, Tracer } from "./tracer";
import { AgentPlanner } from "./agentPlanner";
import { OpenAIModel } from "./model";

// importing the schema source for IBaseAgent needed to construct the agent prompt
const IBaseAgentSchema = fs.readFileSync(path.join(__dirname, "agentSchema.d.ts"), "utf8");

export type Asyncify<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R
    ? (...args: A) => Promise<R>
    : never;
};

export abstract class Agent {

  abstract name: string;
  abstract description: string;

  #schema: string;
  #model: OpenAIModel;
  #fallbackModel: OpenAIModel | undefined;

  // @param agentSchema — The TypeScript source code for the target API. The source code must export a type named IAgent.
  constructor(model: OpenAIModel, agentSchema: string, options?: {
    fallbackModel?: OpenAIModel | undefined;
  }) {
    this.#model = model;
    this.#schema = this.#generateAgentSchema(agentSchema);
    this.#fallbackModel = options?.fallbackModel;
  }

  async execute(prompt: string, parentTracer?: Tracer): Promise<string> {
    parentTracer = parentTracer ?? await createDefaultTracer();
    const tracer = await parentTracer.sub(`IAgent.${this.name}`, "chain", {
      prompt,
    });
    const planner = new AgentPlanner(this, this.#model, this.#schema, {
      tracer,
      fallbackModel: this.#fallbackModel,
    });
    try {
      const result = await planner.plan(prompt);
      await tracer.success({ response: result });
      return result;
    } catch (e) {
      await tracer.error('Internal Error');
      return 'Internal Error';
    }
  }

  #generateAgentSchema(agentSchema: string): string {
    return `${IBaseAgentSchema}

${agentSchema}

export type API = IBaseAgent & IAgent;
`;
  }

}
