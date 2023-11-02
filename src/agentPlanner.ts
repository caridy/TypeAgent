import {
  Program,
  Result,
  Success,
  TypeChatJsonValidator,
  createJsonValidator,
  createModuleTextFromProgram,
  error,
  evaluateJsonProgram,
  success,
} from "typechat";
import { stringify } from "json-to-pretty-yaml";
import { Tracer } from "./tracer";
import { ChatMessage, OpenAIModel } from "./model";
import { IBaseAgent } from "./agentSchema";
import { Asyncify } from "./agent";

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

export class AgentPlanner<T extends object> implements Asyncify<IBaseAgent> {
  #skills: T;
  #model: OpenAIModel;
  #fallbackModel: OpenAIModel | undefined;
  #validator: TypeChatJsonValidator<Program>;
  #maxRepairAttempts: number;

  constructor(skills: T, model: OpenAIModel, schema: string, options: {
    // use a more expensive and powerful model as a fallback to handle requests that the main model cannot handle
    fallbackModel?: OpenAIModel | undefined;
    maxRepairAttempts?: number;
  }) {
    this.#skills = skills;
    this.#model = model;
    this.#validator = createJsonValidator<Program>(schema, "Program");
    this.#validator.createModuleTextFromJson = createModuleTextFromProgram;
    this.#maxRepairAttempts = options?.maxRepairAttempts ?? 2;
    this.#fallbackModel = options?.fallbackModel;
  }

  async OutputMessage(
    message: string,
    data: { [key: string]: unknown; },
  ): Promise<string> {
    if (Object.keys(data).length > 0) {
      return `${message}\n${stringify(data)}`;
    }
    return message;
  }

  /** Use this to inform that the request cannot be handled. Reason must be as detailed as possible, including information about missing data that if provided, the program can be created. */
  async ErrorMessage(reason: string): Promise<string> {
    return `Sorry, I cannot help you with that. ${reason}`;
  }

  async plan(prompt: string, parentTracer: Tracer): Promise<Program> {
    const childTracer = await parentTracer.sub(
      `${this.constructor.name}.plan`,
      "tool",
      {
        prompt,
      }
    );
    try  {
      const program = await this.#createProgram(this.#model, prompt, childTracer);
      await childTracer.success({
        program,
      });
      return program;
    } catch (e) {
      if (this.#fallbackModel) {
        try {
          const program = await this.#createProgram(this.#fallbackModel, prompt, childTracer);
          await childTracer.success({
            program,
          });
          return program;
        } catch (e) {
          const { message } = (e as Error);
          await childTracer.error('Internal Error: Agent failed to handle request with default and fallback models', {
            message
          });
        }
      } else {
        const { message } = (e as Error);
        await childTracer.error('Internal Error: Agent failed to handle request with default model', { message });
      }
    }
    throw new Error('Internal Error: Agent failed to handle request');
  }

  async #createProgram(model: OpenAIModel, prompt: string, tracer: Tracer): Promise<Program> {
    const messages: ChatMessage[] = [
      this.#createSystemPrompt(),
      this.#createRequestPrompt(prompt),
    ];
    let response = await this.#translate(model, messages, tracer);
    return response.data;
  }

  async execute(program: Program, parentTracer: Tracer): Promise<string> {
    const childTracer = await parentTracer.sub(
      `${this.constructor.name}.execute`,
      "tool",
      {
        program,
      }
    );
    try  {
      const result = await this.#executeProgram(program, childTracer);
      await childTracer.success({
        response: result,
      });
      return result;
    } catch (e) {
      const { message } = (e as Error);
      await childTracer.error('Internal Error: Agent failed to execute plan', {
        message: message,
      });
      // throw a nice error is important for the orchestrator to be able to handle the error
      throw new Error(`Agent Failure: ${message}`);
    }
  }

  async #executeProgram(program: Program, tracer: Tracer): Promise<string> {
    return await evaluateJsonProgram(program, this.#handleCall.bind(this, tracer)) as string;
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

  async #translate(model: OpenAIModel, messages: ChatMessage[], tracer: Tracer): Promise<Success<Program>> {
    let repairAttempts = 0;
    while (true) {
      const { role, content } = await model.chat(messages, tracer);
      if (repairAttempts > 0) {
        // remove the program and error from the previous repair attempt from history
        messages.splice(-2);
      }
      messages.push({ role, content });
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
        messages.push(this.#createRepairPrompt(validation.message));
      }
      repairAttempts++;
      if (repairAttempts > this.#maxRepairAttempts) {
        messages.splice(-1);
        throw new Error('Invalid Program');
      }
    }
  }

  #extendedValidation(data: Program): Result<Program> {
    const len = data["@steps"].length;
    const lastStep = data["@steps"][len - 1];
    if (lastStep["@func"] === "ErrorMessage") {
      return len === 1 ? success(data) : error(
        `Invalid error program structure, it should have only 1 step, calling ErrorMessage`
      );
    } else if (lastStep["@func"] === "OutputMessage") {
      if (len > 1) {
        // @ts-ignore
        const stepData = lastStep["@args"][1] as Record<string, unknown>;
        return Reflect.ownKeys(stepData) ? success(data) : error(
          `Invalid OutputMessage FunctionCall structure. It needs to define at least one key:value pair as part of the data argument.`
        );
      }
      return error(
        `Invalid program structure. It needs to collect more data by calling IAgent.* APIS before calling OutputMessage`
      );
    }
    return error(
      `Invalid program structure, it is neither a program using OutputMessage or ErrorMessage as the final step`
    );
  }

  async #handleCall(parentTracer: Tracer, name: string, args: unknown[]): Promise<unknown> {
    if (name in this) {
      // calling a method of the planner as part of the program
      // @ts-ignore
      return await this[name as keyof AgentPlanner](...args);
    }
    if (name in this.#skills) {
      const childTracer = await parentTracer.sub(`IAgent.${name}`, "tool",{
        args,
      });
      // calling a method of the agent as part of the program
      // @ts-ignore
      const response = await this.#skills[name as keyof T](...args);
      await childTracer.success({
        response
      });
      return response;
    }
    throw new TypeError(`Invalid Skill ${name}`);
  }

}
