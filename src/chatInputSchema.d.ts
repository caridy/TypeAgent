/*
The following is a schema definition for analyzing the last message from user in a conversation between a assistant and a user.
- given a conversation log between a user and an assistant where the last message is from the user
- given additional context about the conversation
Your job is to determine if the last message from the user needs an answer from the assistant. And if so, produce a program specifications in plain english for the agent, which needs to include all the details necessary for an agent to write a program that can answer the question. Because the agent can only speaks english and does not have access to the full conversation or the context, the program specs must be self contained and include all relevant values inline.
*/
export interface LastUserMessage {
  // The last message from the user.
  message: string;
  // The detected language from the last message from the user.
  language: string;
  // The sentiment of the interaction
  sentiment: "negative" | "neutral" | "positive";
  // Whether or not the last message from user needs an answer
  answerExpected: boolean;
  // The program spec prompt for the agent in english.
  programSpecs?: string;
}
