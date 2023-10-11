/**
The Orchestrator schema must be used to craft a TurnProgram or a FinalTurnProgram.
These programs are sequences of function calls that, when executed, progress through the task trying to
fulfill the original user's request. By following this schema, you ensures the task either progresses
to a logical conclusion or ends with a proper indication that it can't be completed.

The Orchestrator can rely on domain-specific agents declared in IAgents to delegate sub-tasks to try to answer the user's request.
To answer the user's request, it might require multiple turns in order to gather new information, where each turn is represented by a program.
The Orchestrator can use the results from previous turns to inform the next turn.

You can only create 2 types of programs: 1) a turn, and 2) a final turn. You must always follow the correct structure described below:

1. A turn program must have at least 3 steps, and it looks like this:
 * Step 1: Call WriteThoughts
 * Step 2 to N: Call IAgent.* to delegate sub-tasks to agents.
 * Step N + 1: Call NextTurn to indicate the end of the current execution turn.

2. A final turn program has only two steps, and it looks like this:
 * Step 1: Call WriteThoughts
 * Step 2: Call CompleteAssignment or DeadEnd to indicate that you have completed the task or you cannot help the user with the task

On every turn, you must reflect on the results and strategies from the previous turn to refine your approach.
In every turn review and analyze previous thoughts to ensure you are performing to the best of your abilities.
Every turn and api call has a cost, so be smart and efficient. Aim to complete tasks in the least number of steps.
*/

type AtLeastOne<T> = [T, ...T[]];

export type ReflectionRecord = {
  reasoning: string; // Reason or thoughts. Cannot be empty
  plan: string[]; // Short bulleted list that conveys the high-level plan. Cannot be empty
  critique: string; // Is the result is correct, meet the requirements and based on the real data in the org?
  observation: string; // Analysis result of the execution and the whole Program
};

// The final error message when orchestrator cannot help
export type EscalationMessage = {
  Error: 'DeadEnd' | 'InternalError' | 'StackOverflow',
  Escalation: string,
};

// The final message when the orchestrator found an answer
export type FinalAnswer = {
  CompleteAssignment: string,
};

// Describes the base capabilities of the orchestrator. They can only be used in first and last step of a program.
export interface OrchestratorInterface {
  WriteThoughts(input: ReflectionRecord): ReflectionRecord;
  DeadEnd(escalation: string): EscalationMessage;
  CompleteAssignment(answer: string): FinalAnswer;
  NextTurn(): void;
}

/**
 * A TurnProgram represents the flow of a single turn:
 * - Start with reflection.
 * - Engage with one or more agents to carry out sub-tasks.
 * - Conclude with a decision to proceed to another turn or complete the assignment.
 */
export type TurnProgram = {
  "@steps": [
    { "@func": "WriteThoughts"; "@args": [ReflectionRecord] },
    {
      "@func": string; // Name of the agent for sub-task.
      "@args": [
        string // Prompt used to call the agent.
      ],
    },
    // ... more agent calls if any
    {
      "@func": "NextTurn";
      "@args": [];
    }
  ];
};

/**
 * A FinalTurnProgram captures the concluding steps:
 * - Start with reflection.
 * - End with a declaration of task completion or an inability to proceed further.
 */
export type FinalTurnProgram = {
  "@steps": [
    { "@func": "WriteThoughts"; "@args": [ReflectionRecord] },
    { "@func": "CompleteAssignment" | "DeadEnd"; "@args": [string] }
  ];
};
