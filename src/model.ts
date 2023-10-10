import OpenAI from "openai";
import { success, TypeChatLanguageModel } from "typechat";

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

export function createOpenAIChatModel(env: Record<string, string | undefined>): TypeChatLanguageModel {
  if (env.OPENAI_API_KEY) {
    const apiKey =
      env.OPENAI_API_KEY ?? missingEnvironmentVariable("OPENAI_API_KEY");
    const model =
      env.OPENAI_MODEL ?? missingEnvironmentVariable("OPENAI_MODEL");

    const openai = new OpenAI({
      apiKey: apiKey,
    });

    return {
      async complete(prompt: string) {
        const response = await openai.chat.completions.create({
          model: model,
          messages: [{ role: "user", content: prompt }],
          temperature: 0,
          n: 1,
          max_tokens: 1000,
        });
        // TODO: error control
        return success(response.choices[0].message?.content || "");
      }
    }
  }
  missingEnvironmentVariable("OPENAI_API_KEY");
}
