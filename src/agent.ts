import fs from "fs";
import path from "path";
import { createDefaultTracer, Tracer } from "./tracer";
import { AgentPlanner } from "./agentPlanner";
import { OpenAIModel } from "./model";
import { Program } from "typechat";

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

  model: OpenAIModel;
  schema: string;

  #fallbackModel: OpenAIModel | undefined;
  #planner: AgentPlanner<Agent>;

  // @param schema — The TypeScript source code for the target API. The source code must export a type named IAgent.
  constructor(model: OpenAIModel, schema: string, options?: {
    fallbackModel?: OpenAIModel | undefined;
  }) {
    this.model = model;
    this.schema = this.#generateAgentSchema(schema);
    this.#fallbackModel = options?.fallbackModel;
    this.#planner = new AgentPlanner(this, this.model, this.schema, {
      fallbackModel: this.#fallbackModel,
    });
  }

  async plan(prompt: string, parentTracer?: Tracer): Promise<Program> {
    parentTracer = parentTracer ?? await createDefaultTracer();
    const tracer = await parentTracer.sub(`IAgent.${this.name}.plan`, "chain", {
      prompt,
    });
    try {
      const program = await this.#planner.plan(prompt, tracer);
      await tracer.success({ program });
      return program;
    } catch (e) {
      await tracer.error('Internal Error');
      throw e;
    }
  }

  async execute(program: Program, parentTracer?: Tracer): Promise<string> {
    parentTracer = parentTracer ?? await createDefaultTracer();
    const tracer = await parentTracer.sub(`IAgent.${this.name}.execute`, "chain", {
      program,
    });
    try {
      const response = await this.#planner.execute(program, tracer);
      await tracer.success({ response });
      return response;
    } catch (e) {
      await tracer.error('Internal Error');
      throw e;
    }
  }

  async planAndExecute(prompt: string, parentTracer?: Tracer): Promise<string> {
    parentTracer = parentTracer ?? await createDefaultTracer();
    const tracer = await parentTracer.sub(`IAgent.${this.name}.planAndExecute`, "chain", {
      prompt,
    });
    try {
      const program = await this.plan(prompt, tracer);
      const response = await this.execute(program, tracer);
      await tracer.success({ response });
      return response;
    } catch (e) {
      await tracer.error('Internal Error');
      throw e;
    }
  }

  #generateAgentSchema(agentSchema: string): string {
    return `${IBaseAgentSchema}

${agentSchema}

export type API = IBaseAgent & IAgent;
`;
  }

}
