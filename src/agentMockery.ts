import { Program, createJsonValidator, createModuleTextFromProgram, getData } from "typechat";
import { Agent } from "./agent";
import { Tracer, createDefaultTracer } from "./tracer";
import { ChatMessage } from ".";

const MockPromptTemplate = `You are a mock data generator. Try to help to generate the mocked data based on a TypeScript function declaration.
The following is the "schema.ts" module source:
\`\`\`ts\n{schema}\n\`\`\`
The following is the "program.ts" module source:
\`\`\`ts\n{moduleSource}\n\`\`\`
Based on the code above, please generate a reasonable dataset for any data structure needed to mock only the methods of IAgent definition that are invoked by the program via "api" argument. The output must be json format, and must follow this format:
\`\`\`
{
  "<methodName1>": {
    "<stringifiedArguments1>": "<mockedOutput1>",
    "<stringifiedArguments2>": "<mockedOutput2>",
    // ...
  },
  "<methodName2>": {
    // ...
  },
  // ... Additional methods
}
\`\`\`

Here is the mock data in json with 2 spaces of indentation:`;

type MockedData = Record<string, Record<string, unknown>>;

export abstract class AgentMock extends Agent {

  abstract name: string;
  abstract description: string;

  public data: MockedData = {};

  async execute(program: Program, parentTracer?: Tracer): Promise<string> {
    this.data = await this.mock(program, parentTracer);
    const response = super.execute(program, parentTracer);
    return response;
  }

  async mock(program: Program, parentTracer?: Tracer): Promise<MockedData> {
    parentTracer = parentTracer ?? await createDefaultTracer();
    const validator = createJsonValidator<Program>(this.schema, "Program");
    validator.createModuleTextFromJson = createModuleTextFromProgram;
    const moduleResult = validator.createModuleTextFromJson(program);
    const moduleSource = getData(moduleResult);
    const childTracer = await parentTracer.sub(
      `${this.constructor.name}.mock`,
      "chain",
      {
        program,
      }
    );
    const message = this.#createSystemPrompt(moduleSource);
    try {
      const { content } = await this.model.chat([message], childTracer);
      const startIndex = content.indexOf("{");
      const endIndex = content.lastIndexOf("}");
      const data = JSON.parse(content.slice(startIndex, endIndex + 1));
      await childTracer.success(data);
      return data;
    } catch (e) {
      const { message } = (e as Error);
      await childTracer.error('Internal Error', { message });
      throw e;
    }
  }
  
  #createSystemPrompt(moduleSource: string): ChatMessage {
    return {
      role: "user",
      content: MockPromptTemplate.replace('{schema}', this.schema).replace('{moduleSource}', moduleSource),
    };
  }

}
