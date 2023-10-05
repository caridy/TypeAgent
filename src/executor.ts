import { Agent } from "./agent";
import { Program, evaluateJsonProgram, getData, TypeChatJsonTranslator } from "typechat";

import type { Context, EscalationMessage, FinalAnswer, History, IOrchestratorAgent, Scratchpad } from "./orchestratorSchema";

type Asyncify<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R ? (...args: A) => Promise<R> : never;
};

export class AgentExecutor implements Asyncify<IOrchestratorAgent> {
  #agents: Map<string, Agent<any>>;
  #translator: TypeChatJsonTranslator<Program>;
  #context: Context;
  #history: History;
  #turns = 0;

  constructor(agents: Map<string, Agent<any>>, translator: TypeChatJsonTranslator<Program>, context: Context, history: History) {
    this.#agents = agents;
    this.#translator = translator;
    this.#context = context;
    this.#history = history;
  }

  async #handleCall(name: string, args: unknown[]): Promise<unknown> {
    if (name in this) {
      console.log(`Calling ${name} with arguments: ${JSON.stringify(args, null, 2)})`);
      // calling a method of the executor as part of the program
      // @ts-ignore
      return await this[name as keyof AgentExecutor](...args);
    }
    // delegating to an agent as part of the program
    const agent = this.#agents.get(name);
    if (agent) {
      const [ prompt ] = args as [ string ];
      console.log(`Calling IAgents["${name}"] with prompt: ${prompt})`);
      const response = await agent.execute(prompt);
      console.log(`IAgents["${name}"] Response: \n${response}`);
      return {
        command: `IAgents.${name}`,
        input: prompt,
        output: response,
      };
    }
    throw new TypeError(`Invalid Agent ${name}`);
  }

  async WriteThoughts(input: Scratchpad): Promise<Scratchpad> {
    return input;
  }

  async GetCurrentContext(): Promise<Context> {
    return this.#context;
  }

  async GetHistory(): Promise<History> {
    return this.#history;
  }

  async DeadEnd(
    Escalation: string
  ): Promise<EscalationMessage> {
    return {
      Error: 'DeadEnd',
      Escalation,
    };
  }

  async CompleteAssignment(answer: string): Promise<FinalAnswer> {
    return {
      CompleteAssignment: answer,
    };
  }

  async ThinkMore(
    prompt: string,
    info: string[],
    scratchpad?: Scratchpad,
  ): Promise<EscalationMessage | FinalAnswer> {
    this.#turns++;
    console.log(`Thinking... (Turn: ${this.#turns})`);
    const response = await this.#translator.translate(JSON.stringify({
      prompt,
      oldScratchpad: scratchpad,
      commandsFromPreviousTurn: info.length ? info : undefined,
    }, null, 2));
    if (!response.success) {
        return {
          Error: 'InternalError',
          Escalation: response.message,
        };
    }
    const program = response.data;
    console.log(getData(this.#translator.validator.createModuleTextFromJson(program)));
    return await evaluateJsonProgram(program, this.#handleCall.bind(this)) as FinalAnswer | EscalationMessage;
  }
}
