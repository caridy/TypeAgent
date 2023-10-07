import { Agent } from "./agent";
import { evaluateJsonProgram } from "typechat";

import type { AgentResponses, EscalationMessage, FinalAnswer, IOrchestratorAgent, Scratchpad } from "./orchestratorSchema";
import { Tracer } from "./tracer";
import { ProgramPlanner } from "./planner";

type Asyncify<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R ? (...args: A) => Promise<R> : never;
};

export class AgentExecutor implements Asyncify<IOrchestratorAgent> {
  #agents: Map<string, Agent<any>>;
  #planner: ProgramPlanner;
  #turns = 0;
  #maxTurns;
  #rootTracer: Tracer;

  constructor(agents: Map<string, Agent<any>>, planner: ProgramPlanner, options: {
    maxTurns: number;
    tracer: Tracer;
  }) {
    this.#agents = agents;
    this.#planner = planner;
    this.#maxTurns = options.maxTurns;
    this.#rootTracer = options.tracer;
  }

  async #handleCall(parentTracer: Tracer, name: string, args: unknown[]): Promise<unknown> {
    if (name in this) {
      // calling a method of the executor as part of the program
      // @ts-ignore
      return await this[name as keyof AgentExecutor](...args);
    }
    // delegating to an agent as part of the program
    const agent = this.#agents.get(name);
    if (agent) {
      const [ prompt ] = args as [ string ];
      const childTracer = await parentTracer.sub(`Orchestrator.${name}`, "chain", {
        prompt,
      });
      const response = await agent.execute(prompt, childTracer);
      await childTracer.success({
        response 
      });
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
    responses: AgentResponses[],
    scratchpad?: Scratchpad,
  ): Promise<EscalationMessage | FinalAnswer> {
    this.#turns++;
    if (this.#turns > this.#maxTurns) {
      return {
        Error: 'StackOverflow',
        Escalation: `Maximun number of turns reached (${this.#maxTurns}). Please try again later.`,
      };
    }
    const instructions = this.#createInstructions(prompt, responses, scratchpad);
    const childTracer = await this.#rootTracer.sub(`Orchestrator.Thinking.Turn[${this.#turns}]`, "tool", {
      prompt: instructions
    });
    const response = await this.#planner.plan(instructions, childTracer);
    if (!response.success) {
        await childTracer.error(response.message, response);
        return {
          Error: 'InternalError',
          Escalation: response.message,
        };
    }
    const program = response.data;
    const outputs = await evaluateJsonProgram(program, this.#handleCall.bind(this, childTracer)) as FinalAnswer | EscalationMessage;
    await childTracer.success(outputs);
    return outputs;
  }

  #createInstructions(
    prompt: string,
    responses: AgentResponses[],
    scratchpad?: Scratchpad,
  ): string {
    if (this.#turns === 1) {
      // first turn
      return prompt;
    } else {
      // subsequent turns
      return (
        `Program for turn #${this.#turns} must be implemented based on the interpretation and results from the previous turn described below.\n"""\n` +
        `The following is the original prompt from user:\n` +
        `"""\n${prompt}\n"""\n` +
        `The following is the "Scratchpad" value from turn #${this.#turns - 1}:\n` +
        `"""\n${JSON.stringify(scratchpad, null, 2)}\n"""\n` +
        `The following are the "AgentResponses" values from #${this.#turns - 1}:\n` +
        `"""\n${JSON.stringify(responses, null, 2)}`
      );
    } 
  }

}
