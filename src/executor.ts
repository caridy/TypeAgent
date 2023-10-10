import { Agent } from "./agent";
import { evaluateJsonProgram } from "typechat";

import type { AgentResponse, EscalationMessage, FinalAnswer, OrchestratorInterface, ReflectionRecord } from "./orchestratorSchema";
import { Tracer } from "./tracer";
import { ProgramPlanner } from "./planner";

type Asyncify<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R ? (...args: A) => Promise<R> : never;
};

export class AgentExecutor implements Asyncify<OrchestratorInterface> {
  #agents: Map<string, Agent<any>>;
  #planner: ProgramPlanner;
  #turns = 0;
  #maxTurns: number;
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
      return response;
    }
    throw new TypeError(`Invalid Agent ${name}`);
  }

  async WriteThoughts(input: ReflectionRecord): Promise<ReflectionRecord> {
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

  async NextTurn(
    originalPrompt: string,
    reflections: ReflectionRecord,
    agentOutputs: AgentResponse[]
  ): Promise<EscalationMessage | FinalAnswer> {
    const prompt = this.#createInstructions(originalPrompt, reflections, agentOutputs);
    return await this.execute(prompt);
  }

  async execute(prompt: string): Promise<EscalationMessage | FinalAnswer> {
    this.#turns++;
    if (this.#turns > this.#maxTurns) {
      return {
        Error: 'StackOverflow',
        Escalation: `Maximun number of turns reached (${this.#maxTurns}). Please try again later.`,
      };
    }
    const childTracer = await this.#rootTracer.sub(`Orchestrator.Thinking.Turn[${this.#turns}]`, "tool", {
      prompt
    });
    const response = await this.#planner.plan(prompt, childTracer);
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
    originalPrompt: string,
    reflections?: ReflectionRecord,
    agentOutputs?: AgentResponse[],
  ): string {
    if (this.#turns === 0) {
      // first turn
      return originalPrompt;
    } else {
      // subsequent turns
      return (
        `Write a TurnProgram or FinalTurnProgram for turn #${this.#turns + 1} after interpreting the results in AgentResponse[] from turn #${this.#turns} that are listed below.\n"""\n` +
        `The following is the original prompt from user:\n` +
        `"""\n${originalPrompt}\n"""\n` +
        `The following is the ReflectionRecord value from turn #${this.#turns}:\n` +
        `"""\n${JSON.stringify(reflections, null, 2)}\n"""\n` +
        `The following are the AgentResponse[] values from turn #${this.#turns}:\n` +
        `"""\n${JSON.stringify(agentOutputs, null, 2)}`
      );
    } 
  }

}
