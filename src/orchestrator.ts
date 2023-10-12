import fs from "fs";
import path from "path";
import { Agent } from "./agent";
import { OrchestratorPlanner } from "./orchestratorPlanner";
import { EscalationMessage, FinalAnswer } from "./orchestratorSchema";
import { Tracer, createDefaultTracer } from "./tracer";
import { OpenAIModel } from "./model";

// importing the schema source for OrchestratorInterface needed to construct the orchestrator prompt
const OrchestratorInterfaceSchema = fs.readFileSync(
  path.join(__dirname, "orchestratorSchema.d.ts"),
  "utf8"
);

export class OrchestratorAgent {
  #agents = new Map<string, Agent>();
  #capabilities = new Map<string, string>();
  #model: OpenAIModel;
  #maxTurns = 3;

  constructor(
    model: OpenAIModel,
    options?: {
      maxTurns?: number;
    }
  ) {
    this.#model = model;
    if (options?.maxTurns) {
      this.#maxTurns = options.maxTurns;
    }
  }

  registerAgent(agent: Agent) {
    const { name, description } = agent;
    this.#agents.set(name, agent);
    this.#capabilities.set(name, description);
  }

  async execute(
    prompt: string,
    parentTracer?: Tracer
  ): Promise<EscalationMessage | FinalAnswer> {
    parentTracer = parentTracer ?? (await createDefaultTracer());
    const tracer = await parentTracer.sub(`Orchestrator`, "chain", {
      prompt,
      maxTurns: this.#maxTurns,
      agents: [...this.#agents.keys()], // List of available agents
    });
    const schema = this.#generateOrchestratorSchema();
    const planner = new OrchestratorPlanner(
      this.#model,
      this.#agents,
      schema,
      {
        maxTurns: this.#maxTurns,
        tracer,
      }
    );
    const result = await planner.plan(prompt);
    if ("CompleteAssignment" in result) {
      await tracer.success(result);
    } else {
      await tracer.error(result.Error, result);
    }
    return result;
  }

  #renderCapabilities() {
    return [...this.#capabilities.entries()]
      .map(
        ([name, description]) =>
          `// ${description}
${name}(prompt: string): string;`
      )
      .join("\n");
  }

  #generateOrchestratorSchema() {
    return `${OrchestratorInterfaceSchema}

type IAgents = {
  ${this.#renderCapabilities()}
}

export type API = OrchestratorInterface & IAgents;
`;
  }
}
