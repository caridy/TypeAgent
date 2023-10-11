/*
You can only create 2 types of programs. You must always follow the correct structure described below:

1. A succeed program must have at least 2 steps, and it looks like this:
 * Step 1 to N: Call IAgent.* APIs to execute one or more actions
 * Step N + 1: Call OutputMessage

2. A failure program has only one step, and it looks like this:
 * Step 1: Call ErrorMessage

If you identify any missing or insufficient data in user request, an error program must be returned.
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
