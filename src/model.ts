import OpenAI from "openai";
import { Tracer } from "./tracer";

function missingEnvironmentVariable(name: string): never {
  throw new Error(`Missing model configuration variable: ${name}`);
}

// export function createOpenAICompleteModel(env: Record<string, string | undefined>): TypeChatLanguageModel {
//   if (env.OPENAI_API_KEY) {
//     const apiKey =
//       env.OPENAI_API_KEY ?? missingEnvironmentVariable("OPENAI_API_KEY");
//     const model =
//       env.OPENAI_MODEL ?? missingEnvironmentVariable("OPENAI_MODEL");

//     const openai = new OpenAI({
//       apiKey: apiKey,
//     });

//     return {
//       async complete(prompt: string) {
//         const response = await openai.completions.create({
//           model: model,
//           prompt,
//           temperature: 0,
//           top_p: 1,
//           frequency_penalty: 0,
//           presence_penalty: 0,
//           max_tokens: 1000,
//         });
//         // TODO: error control
//         return success(response.choices[0].text || "");
//       }
//     }
//   }
//   missingEnvironmentVariable("OPENAI_API_KEY");
// }

export type ChatMessage = {
  role: "function" | "user" | "system" | "assistant";
  content: string;
};

export class OpenAIModel {
  #model: string;
  #openai: OpenAI;

  constructor(env: Record<string, string | undefined>) {
    if (!env.OPENAI_API_KEY) {
      missingEnvironmentVariable("OPENAI_API_KEY");
    }
    const apiKey = env.OPENAI_API_KEY;
    this.#model = env.OPENAI_MODEL ?? missingEnvironmentVariable("OPENAI_MODEL");
    this.#openai = new OpenAI({
      apiKey: apiKey,
    });    
  }

  async complete(prompt: string, parentTracer: Tracer): Promise<string> {
    const config = {
      model: this.#model,
      prompt,
      temperature: 0,
      n: 1,
      // max_tokens: 1000, // probably can be removed
    };
    const childRun = await parentTracer.sub(`TypeAgent.Model.${this.#model}`, "llm", config);
    const completion = await this.#openai.completions.create(config);
    const { choices } = completion;
    if (choices[0].text) {
      await childRun.success({ choices });
      return choices[0].text;
    }
    await childRun.error('Invalid Completion Response', {
      choices,
    });
    throw new Error(`Invalid Completion Response`);
  }

  async chat(messages: ChatMessage[], parentTracer: Tracer): Promise<ChatMessage> {
    const config = {
      model: this.#model,
      messages,
      temperature: 0,
      n: 1,
      // max_tokens: 1000, // probably can be removed
    };
    const childRun = await parentTracer.sub(`TypeAgent.Model.${this.#model}`, "llm", config);
    const completion = await this.#openai.chat.completions.create(config);
    const { choices } = completion;
    if (choices[0].message?.content) {
      await childRun.success({ choices });
      return choices[0].message as ChatMessage;
    }
    await childRun.error('Invalid Completion Response', {
      choices,
    });
    throw new Error(`Invalid Completion Response`);
  }

}
