/*
Interpret the request, and produce the appropriate program. You can only create 2 types of programs. You must always follow the correct structure described below:

1. A succeed program must have at least 2 steps, and it looks like this:
 * Step 1 to N: Call IAgent.* APIs to execute one or more actions
 * Step N + 1: Call OutputMessage

2. A failure program has only one step, and it looks like this:
 * Step 1: Call ErrorMessage

Pay attention to the following:
- If there is missing or insufficient data, an error program must be returned.
- When you're not sure, ask for help, escalate to the user to clarify the request.
- Ensure you are performing within the confinements of the data model dictated by APIs.
- Every step in the program has a cost, so be smart and efficient.
- Not all the data provided might be relevant, so be selective.
*/

export interface IBaseAgent {
  OutputMessage(
    message: string, // Detailed output message with the result of the program execution in natural language.
    data: { [key: string]: string; } // Key-value pairs of any data that is relevant to the output message or can help to interpret the output message.
  ): string;

  // Use this to inform that the request cannot be handled.
  ErrorMessage(
    // Reason must be as detailed as possible, including information about missing data that if provided, the program can be created.
    reason: string
  ): string;
}
