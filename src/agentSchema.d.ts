/*
Based on this schema, you must call "OutputMessage" as part of the program. You must pay special attention to missing or insufficient information in user request, in which case an error program with a single step using "ErrorMessage" must be returned.
*/

type PropertyKey = string | number;

export interface IBaseAgent {
  // Gets the property of target, equivalent to target[propertyKey].
  // Useful when you need to pass a piece of an output as input to another function.
  getProperty<T extends object, P extends PropertyKey>(
    // the target value must always be a reference to an output from a previous step
    target: T,
    propertyKey: P,
  ): P extends keyof T ? T[P] : any;

  // Use this to output the result of the program.
  // You can use previous computations to interpolate those values on the "message"
  // Interpolations are positional. If no arguments, pass an empty array
  OutputMessage(
    message: string, // String to be interpolated. Use double brackets notation for the string interpolation (example: "Hi {{0}}!")
    substitutionList?: any[] // List of substitutions. Must match the number of interpolations within "message".
  ): string;

  /** Use this to inform that the request cannot be handled. Reason must be as detailed as possible, including information about missing data that if provided, the program can be created. */
  ErrorMessage(reason: string): string;
}
