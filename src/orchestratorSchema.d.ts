/**
The Orchestrator schema must be used to craft a IntermediateProgram or a FinalProgram.
These programs are sequences of function calls that, when executed, progress through the task trying to
fulfill the original user's request. By following this schema, you ensures the task either progresses
to a logical conclusion or ends with a proper indication that it can't be completed.

The Orchestrator can rely on domain-specific agents who's capabilities are described in AgentsCapabilities to delegate sub-tasks to try to answer the user's request.
To answer the user's request, it might require multiple turns in order to gather new information, where each turn is represented by a program using an agent.
The Orchestrator can use the results from previous turns to inform the next turn.

On every turn, you must reflect on the results and strategies from the previous turn to refine your approach.
In every turn review and analyze previous thoughts to ensure you are performing to the best of your abilities.
Every turn and api call has a cost, so be smart and efficient, and avoid executing the same task multiple times. Aim to complete tasks in the least number of steps.
Try to recover from errors ocurring on the previous step. If you cannot, escalate to the user by using ErrorMessage.
Choose the best tool for the job. If you are not sure, use ErrorMessage.

Pay special attention to the following:
- When calling an agent, remember that it does not have access to your thoughts, or results from previous turns or steps, therefore you must provide a self-contained detailed prompt as a program spec with all necessary data for the agent to perform its job.
- If the user's consent is required for a task to be carry on, by very explicit in your request to the user, and in the prompt to the agent.
- AgentCall can only use @func to invoke capabilities defined in AgentsCapabilities interface.
*/

// Base capabilities of a ReAct Turn Program:
export type ReActBaseCapabilities = {
  WriteThoughts(input: ReflectionRecord): ReflectionRecord;
  // Use this to inform that the request cannot be handled.
  ErrorMessage(
    reason: string
  ): string;
  // Use this to inform the result of the program execution.
  OutputMessage(
    message: string,
    data: { [key: string]: unknown; }
  ): string;
  NextTurn(): void;
}

export type ReflectionRecord = {
  reasoning: string; // Reason or thoughts. Cannot be empty
  plan: string[]; // Short bulleted list that conveys the high-level plan. Cannot be empty
  critique: string; // Is the result is correct, meet the requirements and based on the information provided?
  observation: string; // Analysis result of the previous turn if any
};
