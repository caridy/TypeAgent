import {
  Program,
  Result,
  TypeChatJsonValidator,
  TypeChatLanguageModel,
  createJsonValidator,
  createModuleTextFromProgram,
  error,
  success,
} from "typechat";
import { Tracer } from "./tracer";

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

export class ProgramPlanner {
  #model: TypeChatLanguageModel;
  #validator: TypeChatJsonValidator<Program>;
  #maxRepairAttempts: number;
  #extendedValidation: (data: Program) => Result<Program>;

  constructor(model: TypeChatLanguageModel, schema: string, options?: {
    maxRepairAttempts?: number;
    validation?: (data: Program) => Result<Program>
  }) {
    this.#model = model;
    this.#validator = createJsonValidator<Program>(schema, "Program");
    this.#validator.createModuleTextFromJson = createModuleTextFromProgram;
    this.#maxRepairAttempts = options?.maxRepairAttempts ?? 2;
    this.#extendedValidation = options?.validation ?? ((data) => success(data));
  }

  #createRequestPrompt(request: string): string {
    return (
      `You are a service that translates user requests into programs represented as JSON using the following TypeScript definitions:\n` +
      `\`\`\`\n${programSchemaText}\`\`\`\n` +
      `The programs can call functions from the API defined in the following TypeScript definitions:\n` +
      `\`\`\`\n${this.#validator.schema}\`\`\`\n` +
      `The following is a user request:\n` +
      `"""\n${request}\n"""\n` +
      `The following is the user request translated into a JSON program object with 2 spaces of indentation and no properties with the value undefined:\n`
    );
  }

  #createRepairPrompt(validationError: string): string {
    return (
      `The JSON program object is invalid for the following reason:\n` +
      `"""\n${validationError}\n"""\n` +
      `The following is a revised JSON program object:\n`
    );
  }

  async #translate(request: string, tracer: Tracer): Promise<Result<Program>> {
    const prompt = this.#createRequestPrompt(request);
    let currentPrompt = prompt;
    let repairAttempts = 0;
    while (true) {
      const response = await this.#complete(currentPrompt, tracer);
      if (!response.success) {
        return response;
      }
      const responseText = response.data;
      const childRun = await tracer.sub("TypeChat.Validation", "parser", {
        responseText,
      });
      const startIndex = responseText.indexOf("{");
      const endIndex = responseText.lastIndexOf("}");
      if (!(startIndex >= 0 && endIndex > startIndex)) {
        await childRun.error(`Response is not a valid JSON structure`, {
          generations: [responseText],
        });
        return error(`Response is not JSON:\n${responseText}`);
      }
      const jsonText = responseText.slice(startIndex, endIndex + 1);
      const schemaValidation = this.#validator.validate(jsonText);
      const validation = schemaValidation.success
        ? this.#extendedValidation(schemaValidation.data)
        : schemaValidation;
      if (validation.success) {
        await childRun.success(validation);
        return validation;
      }
      await childRun.error(`Program validation failed`, validation);
      repairAttempts++;
      if (repairAttempts > this.#maxRepairAttempts) {
        return error(
          `JSON validation failed: ${validation.message}\n${jsonText}`
        );
      }
      currentPrompt = `${prompt}${responseText}\n${this.#createRepairPrompt(
        validation.message
      )}`;
    }
  }

  async #complete(prompt: string, parentTracer: Tracer): Promise<Result<string>> {
    const childRun = await parentTracer.sub("TypeChat.Planner", "llm", {
      prompts: [prompt],
    });
    const response = await this.#model.complete(prompt);
    if (response.success) {
      await childRun.success({
        generations: [response],
      });
    } else {
      await childRun.error(response.message, {
        generations: [response],
      });
    }
    return response;
  }

  plan(prompt: string,  tracer: Tracer): Promise<Result<Program>> {
    const result = this.#translate(prompt, tracer);

    // console.log(getData(this.#planner.validator.createModuleTextFromJson(program)));

    return result;
  }
}
