import fs from "fs";
import path from "path";
import { createDefaultTracer, Tracer, createLangSmithTracer } from "./tracer";
import { AgentPlanner } from "./agentPlanner";
import { OpenAIModel } from "./model";
import { Program } from "typechat";
import { CallbackManagerForToolRun } from "@langchain/core/callbacks/manager";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";

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
  currentTracer: Tracer | undefined;

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

  async executeSkill(name: string, args: unknown[], parentTracer?: Tracer): Promise<string> {
    parentTracer = parentTracer ?? await createDefaultTracer();
    const childTracer = await parentTracer.sub(`IAgent.${name}`, "tool",{
      args,
    });
    let response;
    try {
      this.currentTracer = childTracer;
      // calling a method of the agent as part of the program
      // @ts-ignore
      response = await this[name as keyof T](...args);
      await childTracer.success({
        response
      });
    } catch (e) {
      await childTracer.error('Internal Error[skill=IAgent.${name}]]: ' + (e as Error).message);
      throw e;
    }
    return response;
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

  // useful to integrate this agent as a tool in a langchain program using lang graph
  createAgentAsTool() {
    const { name, description } = this;
    return new DynamicStructuredTool({
      name: name,
      description: description,
      schema: z.object({
        prompt: z.string().describe(`A detailed self-contained prompt for the ${name}`),
      }),
      func: async ({ prompt }: { prompt: string }, config: CallbackManagerForToolRun | undefined) => {
        // @ts-ignore protected value access
        const parentRunId = config?.runId;
        const childTracer = await createLangSmithTracer(
          `AgentNode: ${name}`,
          "chain",
          { prompt },
          parentRunId,
        );
        try {
          const plan = await this.plan(prompt, childTracer);
          const response = await this.execute(plan, childTracer);
          return response;
        } catch (e) {
          const { message } = (e as Error);
          return message;
        }
      },
    });
  }

  #generateAgentSchema(agentSchema: string): string {
    return `${IBaseAgentSchema}

${agentSchema}

export type API = IBaseAgent & IAgent;
`;
  }

}
