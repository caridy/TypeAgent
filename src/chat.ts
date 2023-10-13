import fs from "fs";
import path from "path";
import { Tracer, createDefaultTracer } from "./tracer";
import { ChatMessage } from "./model";
import { OrchestratorAgent } from "./orchestrator";
import {
  TypeChatJsonTranslator,
  createJsonTranslator,
  Result,
  TypeChatLanguageModel,
  createLanguageModel,
} from "typechat";
import { LastUserMessage } from "./chatInputSchema";

const inputSchema = fs.readFileSync(
  path.join(__dirname, "chatInputSchema.d.ts"),
  "utf8"
);
import { Answer } from "./chatOutputSchema";
const outputSchema = fs.readFileSync(
  path.join(__dirname, "chatOutputSchema.d.ts"),
  "utf8"
);

export class Chat {
  #env: Record<string, string | undefined>;
  #agent: OrchestratorAgent;

  constructor(
    env: Record<string, string | undefined>,
    agent: OrchestratorAgent
  ) {
    this.#env = env;
    this.#agent = agent;
  }

  async analyze(
    messages: ChatMessage[],
    parentTracer?: Tracer
  ): Promise<Answer | null> {
    // Create a new tracer for this method call
    parentTracer = parentTracer ?? (await createDefaultTracer());
    const childTracer = await parentTracer.sub(`Chat`, "tool", {
      messages,
    });

    // Analyze the messages to determine the expected answer type
    const question = await this.#extractQuestionInfo(messages, childTracer);

    if (question.programSpecs && question.answerExpected) {
      // Delegate the question to the orchestrator agent
      const response = await this.#agent.execute(question.programSpecs, childTracer);
      const responseText =
        "CompleteAssignment" in response
          ? response.CompleteAssignment
          : response.Escalation;
      return await this.#produceAnswer(
        messages,
        question,
        responseText,
        childTracer
      );
    }
    // in case the last message is not a question, we return null (e.g.: the user says "thank you")
    return null;
  }

  async #extractQuestionInfo(
    messages: ChatMessage[],
    parentTracer: Tracer
  ): Promise<LastUserMessage> {
    parentTracer = parentTracer ?? (await createDefaultTracer());

    // dummy context for now
    const context = { today: new Date().toISOString() };

    const childTracer = await parentTracer.sub(`Question.Analyzer`, "tool", {
      messages,
      context,
    });

    const model = createLanguageModel(this.#env);
    const questionAnalysisTranslator: TypeChatJsonTranslator<LastUserMessage> =
      createJsonTranslator<LastUserMessage>(
        {
          async complete(prompt: string): Promise<Result<string>> {
            return await model.complete(prompt);
          },
        },
        inputSchema,
        "LastUserMessage"
      );

    const response = await questionAnalysisTranslator.translate(
      this.#createQuestionPrompt(messages, context)
    );
    if (!response.success) {
      await childTracer.error(response.message, {
        response,
      });
      throw new Error(response.message);
    }
    await childTracer.success({
      response,
    });
    return response.data;
  }

  async #produceAnswer(
    messages: ChatMessage[],
    question: LastUserMessage,
    answerText: string,
    parentTracer: Tracer
  ): Promise<Answer> {
    parentTracer = parentTracer ?? (await createDefaultTracer());
    const childTracer = await parentTracer.sub(`Answer.Analyzer`, "tool", {
      messages,
      question,
      answerText,
    });

    const model = createLanguageModel(this.#env);
    const answerAnalysisTranslator: TypeChatJsonTranslator<Answer> =
      createJsonTranslator<Answer>(
        {
          async complete(prompt: string): Promise<Result<string>> {
            return await model.complete(prompt);
          },
        },
        outputSchema,
        "Answer"
      );

    const response = await answerAnalysisTranslator.translate(
      this.#createAnswerPrompt(messages, question, answerText)
    );
    if (!response.success) {
      await childTracer.error(response.message, {
        response,
      });
      throw new Error(response.message);
    }
    await childTracer.success({
      response,
    });
    return response.data;
  }

  #createQuestionPrompt(
    conversation: ChatMessage[],
    context: Record<string, unknown>
  ): string {
    return `Given the following contextual information about the conversation:\n` +
      `${JSON.stringify(context)}\n` +
      `And given the following messages log:\n` +
      `${JSON.stringify(conversation)}\n` +
      `Produce the "LastUserMessage" object`;
  }

  #createAnswerPrompt(
    conversation: ChatMessage[],
    question: LastUserMessage,
    answerText: string,
  ): string {
    return `Given the following messages log:\n` +
      `${JSON.stringify(conversation)}\n` +
      `Given the following inferred question from the message log:\n` +
      `${JSON.stringify(question)}\n` +
      `And given the answer in english:\n` +
      `${answerText}\n` +
      `Produce the "Answer" object`;
  }

}
