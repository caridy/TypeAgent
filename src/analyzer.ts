import { TypeChatJsonTranslator, TypeChatLanguageModel, createJsonTranslator } from "typechat";
import { Tracer, createDefaultTracer } from "./tracer";

export class Analyzer<T extends object> {

  #translator: TypeChatJsonTranslator<T>;

  constructor(model: TypeChatLanguageModel, schema: string) {
    this.#translator = createJsonTranslator<T>(model, schema, "LastUserMessage");
  }

  async execute(prompt: string, parentTracer?: Tracer): Promise<T> {
    parentTracer = parentTracer ?? await createDefaultTracer();
    const childTracer = await parentTracer.sub(`Analyzer`, "tool", {
      prompt,
    });
    const response = await this.#translator.translate(prompt);
    if (!response.success) {
        await childTracer.error(response.message, {
          response
        });
        throw new Error(response.message);
    }
    await childTracer.success({
      response
    });
    return response.data;
  }

}
