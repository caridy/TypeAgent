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

  async complete(prompt: string): Promise<string> {
    const completion = await this.#openai.chat.completions.create({
      model: this.#model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
      n: 1,
      // max_tokens: 1000, // probably can be removed
    });
    if (completion.choices[0].message?.content) {
      return completion.choices[0].message?.content;
    }
    throw new Error(`Invalid Completion Response`);
  }

  async chat(messages: ChatMessage[], parentTracer: Tracer): Promise<ChatMessage> {
    const childRun = await parentTracer.sub(`TypeAgent.Model.${this.#model}`, "llm", {
      messages,
    });
    const completion = await this.#openai.chat.completions.create({
      model: this.#model,
      messages,
      temperature: 0,
      n: 1,
      // max_tokens: 1000, // probably can be removed
    });
    if (completion.choices[0].message?.content) {
      const message = completion.choices[0].message as ChatMessage;
      await childRun.success(message);
      return message;
    }
    await childRun.error('Invalid Completion Response', {
      choice: completion.choices[0],
    });
    throw new Error(`Invalid Completion Response`);
  }

}
