import { Agent } from "./agent";
import { OrchestratorPlanner } from "./orchestratorPlanner";
import { Tracer, createDefaultTracer } from "./tracer";

export class OrchestratorAgent {
  #agents = new Map<string, Agent>();
  #env: Record<string, string | undefined>;
  #maxTurns = 3;

  constructor(
    env: Record<string, string | undefined>,
    options?: {
      maxTurns?: number;
    }
  ) {
    this.#env = env;
    if (options?.maxTurns) {
      this.#maxTurns = options.maxTurns;
    }
  }

  registerAgent(agent: Agent) {
    const { name } = agent;
    this.#agents.set(name, agent);
  }

  async execute(
    prompt: string,
    parentTracer?: Tracer
  ): Promise<string> {
    parentTracer = parentTracer ?? (await createDefaultTracer());
    const tracer = await parentTracer.sub(`Orchestrator`, "chain", {
      prompt,
      maxTurns: this.#maxTurns,
      agents: [...this.#agents.keys()], // List of available agents
    });
    const planner = new OrchestratorPlanner(
      this.#env,
      this.#agents,
      {
        maxTurns: this.#maxTurns,
        tracer,
        request: prompt,
      }
    );
    const result = await planner.plan();
    await tracer.success({ response: result });
    return result;
  }

}
