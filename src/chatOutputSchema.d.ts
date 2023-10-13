/*
The schema definition below is for analyzing the last message from an assistant in a conversation with a user.
- given a conversation log between a user and an assistant
- given a detailed analysis of the last message from the user (including the sentiment and the language of the interaction)
- and given an agent's answer in english

Your job is to interpret the agent's answer in the context of the conversation, and produce an appropriate answer in the language of the interaction. If the answer is a question to the user because there is insuficient or ambigous information, you must produce a question in the expected language as well.
*/

// Different types of answers that the assistant might expect.
type AnswerType = "date" | "time" | "datetime" | "text" | "number" | "selection" | "multiselect";

// Mapping the answer type to its possible values.
type AnswerValue<T extends AnswerType> = 
    T extends "number" ? number : 
    T extends "selection" | "multiselect" ? string[] : 
    string;

// Configuration for expected answers that require more detail.
type AnswerConfig<T extends AnswerType> = {
    type: T;
    defaultValue?: AnswerValue<T>;
    options?: T extends "selection" | "multiselect" ? string[] : undefined;
};

export type Answer = {
    // Flag to indicate if the assistant is asking a follow-up question.
    isQuestion: boolean;
    
    // The language of the answer and all its elements. this must match the language detected from the last message from the user.
    language: string;

    // The text representing the answer to the user. must be empty if isQuestion is true.
    text?: string;

    // If the assistant's response is a question, the details of the expected answer. must be defined if isQuestion is true.
    expectedAnswerType?: AnswerType;
    expectedAnswerConfig?: AnswerConfig<AnswerType>;

    // If the assistant's response is a question, the text of that question to be presented to the user. must be defined if isQuestion is true.
    question?: string;
};
