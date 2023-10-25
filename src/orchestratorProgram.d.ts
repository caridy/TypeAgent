// A program consists of a sequence of function calls that are evaluated in order.

// A function call specifies a function name and a list of argument expressions. Arguments may contain
// nested function calls and result references.
export type FunctionCall = {
  // Name of the function
  "@func": string;
  // Arguments for the function, if any
  "@args"?: Expression[];
};

// An expression is a JSON value, a function call, or a reference to the result of a preceding expression.
export type Expression = JsonValue | FunctionCall | ResultReference;

// A JSON value is a string, a number, a boolean, null, an object, or an array. Function calls and result
// references can be nested in objects and arrays.
export type JsonValue = string | number | boolean | null | { [x: string]: Expression } | Expression[];

// A result reference represents the value of an expression from a preceding step.
export type ResultReference = {
  // Index of the previous expression in the "@steps" array
  "@ref": number;
};

// There are special types of programs that implement a ReAct Method, which represents a multi-turn program
// where each turn is created based on the previous intermediate program and its results, this way every turn can be optimized
// to arrive to the final output in the shorter number of steps. The following declarations are definig a turn program:

interface WriteThoughtsStep extends FunctionCall {
  "@func": "WriteThoughts";
  "@args": [unknown];
}

interface OutputMessageStep extends FunctionCall {
  "@func": "OutputMessage";
  "@args": [
    // message: Detailed explanation in natural language for the result of the program and the "data" gathered from previous steps that is relevant to the output.
    string,
    // Data: A key-value pairs for data described by "message", where the key is string, and value represents the result from a preceding step. This data would be formatted in yaml format and concatenated to the end of the "message".
    { [key: string]: unknown; }
  ]
}

interface ErrorMessageStep extends FunctionCall {
  "@func": "ErrorMessage";
  "@args": [
    // A reason for the error, it must be as detailed as possible, including information about missing data that if provided, the program can be created.
    string
  ]
}

interface NextTurnStep extends FunctionCall {
  "@func": "NextTurn";
  "@args": []
}

type AgentFunction = {
  "@func": string;
  "@args"?: Expression[];
}

type ExcludeFunctionNames = "WriteThoughts" | "OutputMessage" | "ErrorMessage" | "NextTurn";
type AgentCall = Omit<AgentFunction, "@func"> & {
  "@func": Exclude<AgentFunction["@func"], ExcludeFunctionNames>;
}

// The following two declarations define a specific program type within the ReAct Method:

// Use this when you need to gather more information by calling an agent.
export type IntermediateProgram = {
  "@steps": [
    WriteThoughtsStep,
    ...AgentCall[],
    NextTurnStep
  ];
};

// Use this when the program can interprets the results of previous turns, and produces a final output.
export type FinalProgram = {
  "@steps": [
    WriteThoughtsStep,
    OutputMessageStep | ErrorMessageStep,
  ];
};

export type TurnProgram = IntermediateProgram | FinalProgram;
