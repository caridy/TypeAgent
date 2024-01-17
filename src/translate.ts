import {
  TypeChatJsonTranslator,
  createJsonTranslator,
  PromptSection,
} from "typechat";
import { OpenAIModel } from "./model";
import { Tracer } from "./tracer";

export async function translateToProgram<T extends Object>(prompt: string, messages: PromptSection[], schema: string, typeName: string, model: OpenAIModel, parentTracer: Tracer): Promise<T> {
  model.tracer = parentTracer;
  const translator: TypeChatJsonTranslator<T> =
    createJsonTranslator<T>(
      model,
      schema,
      typeName
    );

  const response = await translator.translate(prompt, messages);
  if (!response.success) {
    throw new Error(response.message);
  }
  return response.data;
}
