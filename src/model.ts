import {
  Result,
  PromptSection,
  TypeChatLanguageModel,
} from "typechat";
import { ChatOpenAI } from "@langchain/openai";
import { SystemMessage, BaseMessage, HumanMessage } from "@langchain/core/messages";
import { CallbackManager } from "@langchain/core/callbacks/manager";
import { Tracer } from "./tracer";

function createPromptPreamble(messages: PromptSection[]): BaseMessage[] {
  return messages.map((msg) => {
    if (msg.role === "system") {
      return new SystemMessage(msg.content);
    } else {
      return new HumanMessage(msg.content);
    }
  });
}

export class OpenAIModel implements TypeChatLanguageModel {
  #model: ChatOpenAI;
  #runName: string;
  #tags: string[];
  protected parentTracer: Tracer | undefined;

  constructor(env: Record<string, string | undefined>, runName: string, tags: string[]) {
    this.#runName = runName;
    this.#tags = tags;
    // TODO: this should also have the json mode in the future
    this.#model = new ChatOpenAI({
      temperature: 0,
      modelName: env.OPENAI_MODEL as string,
      maxTokens: 4096,
    });
  }

  set tracer(tracer: Tracer) {
    this.parentTracer = tracer;
  }

  get tracer(): Tracer | undefined {
    return this.parentTracer;
  }

  async complete(prompt: string | PromptSection[]): Promise<Result<string>> {
    if (!this.parentTracer) {
      throw new Error(`Missing Model.tracer value.`);
    }
    prompt = typeof prompt === "string" ? [{ role: "user", content: prompt }] : prompt;
    const messages = createPromptPreamble(prompt);
    // get a langchain callback from the langsmith parent tracer when possible
    const callbacks = (this.parentTracer.run as any).id ? new CallbackManager((this.parentTracer.run as any).id) : [];
    const response = await this.#model.predictMessages(messages, {
      runName: this.#runName,
      tags: this.#tags,
      callbacks,
    });
    const { content } = response;
    return {
      success: true,
      data: content.toString(),
    };
  }

}

export class EinsteinModel extends OpenAIModel {
  #env: Record<string, string | undefined>;

  constructor(env: Record<string, string | undefined>, runName: string, tags: string[]) {
    super(env, runName, tags);
    this.#env = env;
  }

  async complete(prompt: string | PromptSection[]): Promise<Result<string>> {
    if (!this.parentTracer) {
      throw new Error(`Missing Model.tracer value.`);
    }
    prompt = typeof prompt === "string" ? [{ role: "user", content: prompt }] : prompt;
    const messages = createPromptPreamble(prompt);

    const url = this.#env.EINSTEIN_URL as string;
    const headers = {
      'Content-Type': 'application/json',
      'X-LLM-Provider': this.#env.EINSTEIN_MODEL_PROVIDER as string,
      'X-Org-Id': this.#env.EINSTEIN_ORG_ID as string,
      'X-Client-Feature-Id': this.#env.EINSTEIN_CLIENT_FEATURE_ID as string,
      Authorization: 'API_KEY ' + this.#env.EINSTEIN_API_KEY as string
    };
    const requestObject = {
      prompt: conversationConcat(messages),
      temperature: 0,
      model: this.#env.EINSTEIN_MODEL,
    };
    const body = JSON.stringify(requestObject);

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body,
    });

    const responseBody = await response.text();
    const llmgResponse = JSON.parse(responseBody);

    if (llmgResponse.errorCode !== undefined) {
      const { messageCode, message } = llmgResponse;
      await this.parentTracer.error(`Internal LLM Error: ${messageCode}`, {
        message
      });
      throw new Error (`Internal LLM Error: ${messageCode} - ${message}`);
    }

    const content = llmgResponse.generations[0].text;
    return {
      success: true,
      data: content.toString(),
    };

  }

}

function conversationConcat(messages: BaseMessage[]): string {
  return messages.map((m) => m.content).join('\n');
}
