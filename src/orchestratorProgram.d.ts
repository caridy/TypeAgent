// The schema defines the Plan JSON Objects. If steps are defined, outputMessage should not be present, and vice versa.
export type Plan = {
  thoughts: WriteThoughts;
  // Use this when the output message can be constructed based on information from memory to fulfill the request.
  // Detailed explanation in natural language of the results including relevant information gathered from memory that is relevant to the output. You can add structured data in yaml at the end of the message. This message is intended to be interpreted by an LLM, be precise. Cannot be empty.
  outputMessage?: string,
  // indicates whether or not the request was resolved.
  isError: boolean,
  // Use this when the information available from memory is not enough to fullfil the request, but it is enough to ask an agent for more information.
  // You must avoid using AskAgentStep to request information from agents if the information is already available in memory.
  steps?: AskAgentStep[];
};

// Use this on every plan to reasoning about the plan itself before completing the plan.
export interface WriteThoughts {
  reasoning: string; // Reason or thoughts about the plan. Cannot be empty
  highLevelPlan: string[]; // Short bulleted list that conveys the high-level plan. Cannot be empty
  critique: string; // Is the result correct, meet the requirements and based on the information provided and from memory?
  observation: string; // Does the memory contains a match for the request or relevant parts of the request?
}

// Use this to ask an agent for additional information to be stored in memory.
export type AskAgentStep = {
  type: "AskAgent";
  // The name of the agent from AgentNames
  agent: AgentNames;
  // A question for the agent in natural language to gather necessary information to complete the request. Since the agent does not have access to the request, your state or memory, the specs must be self contained and include all relevant values inline.
  question: string;
}

type AgentNames = "/*AGENT_NAMES_PLACEHOLDER*/";

/* This is your memory, this allow you to recollect facts to construct plans.
When you receive a request, start by checking this memory for relevant information.
If relevant information is available, use it to generate a plan. */
const Memory = [/*AGENT_MEMORY*/];

/* Pay attention to the following guidelines:
- Memory is your most valuable asset. Use it wisely.
- Calling an agent is expensive, avoid calling them when data is available from memory.
- When you are not sure, error out.
- You must not assume agents that are not defined.
*/