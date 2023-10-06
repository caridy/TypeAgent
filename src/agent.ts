import fs from "fs";
import path from "path";
import { IBaseAgent } from "./agentSchema";
import { Program, evaluateJsonProgram, getData, TypeChatJsonTranslator, TypeChatLanguageModel } from "typechat";
import { Tracer } from "./tracer";
import { ProgramPlanner } from "./planner";

// importing the schema source for IBaseAgent needed to construct the agent prompt
const IBaseAgentSchema = fs.readFileSync(path.join(__dirname, "agentSchema.ts"), "utf8");

export type Asyncify<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R ? (...args: A) => Promise<R> : never;
};

export abstract class Agent<T> implements Asyncify<IBaseAgent> {

  abstract name: string;
  abstract description: string;

  #planner: ProgramPlanner;

  // @param schema — The TypeScript source code for the target API. The source code must export a type named IAgent.
  constructor(model: TypeChatLanguageModel, agentSchema: string) {
    const schema = this.#generateAgentSchema(agentSchema);
    this.#planner = new ProgramPlanner(model, schema);
  }

  async execute(prompt: string, parentTracer: Tracer): Promise<string> {
    const childTracer = await parentTracer.createChild({
      name: `Agent.${this.name}`,
      run_type: "chain",
      inputs: {
        prompt,
      },
    });
    await childTracer.postRun();
    const plan = await this.#planner.plan(prompt, childTracer);
    if (!plan.success) {
        return plan.message;
    }
    const program = plan.data;
    const response = await evaluateJsonProgram(program, this.#handleCall.bind(this, childTracer)) as string;
    await childTracer.end({
      outputs: {
        response
      }
    });
    childTracer.patchRun();
    return response;
  }

  async getProperty<O extends object, P extends PropertyKey>(
    // the target value must always be a reference to an output from a previous step
    target: O,
    propertyKey: P,
  ): Promise<P extends keyof O ? O[P] : undefined> {
    // @ts-ignore
    return target[propertyKey];
  }

  // Use this to output the result of the program.
  // You can use previous computations to interpolate those values on the "message"
  // Interpolations are positional. If no arguments, pass an empty array
  async OutputMessage(
    message: string, // String to be interpolated. Use double brackets notation for the string interpolation (example: "Hi {{0}}!")
    substitutionList?: any[] // List of substitutions. Must match the number of interpolations within "message".
  ): Promise<string> {
    return message.replace(/\{\{(\d+)\}\}/g, (match, index) => {
      const substitution = substitutionList?.[index];
      if (substitution === undefined) {
        throw "[missing]";
      }
      return substitution;
    });
  }

  /** Use this to inform that the request cannot be handled. Reason must be as detailed as possible, including information about missing data that if provided, the program can be created. */
  async ErrorMessage(reason: string): Promise<string> {
    return `Sorry, I cannot help you with that. ${reason}`;
  }

  #generateAgentSchema(agentSchema: string): string {
    return `${IBaseAgentSchema}

${agentSchema}

export type API = IBaseAgent & IAgent;
`;
  }

  async #handleCall(parentTracer: Tracer, name: string, args: unknown[]): Promise<unknown> {
    if (name in (this as (Asyncify<T> & Asyncify<IBaseAgent>))) {
      const childTracer = await parentTracer.createChild({
        name: `Agent.${this.name}.${name}`,
        run_type: "tool",
        inputs: {
          args,
        },
      });
      await childTracer.postRun();
      // calling a method of the agent as part of the program
      // @ts-ignore
      const response = await this[name as keyof T](...args);
      await childTracer.end({
        outputs: {
          response
        }
      });
      childTracer.patchRun();
      return response;
    }
    throw new TypeError(`Invalid Skill ${this.name}[${name}]`);
  }

}
