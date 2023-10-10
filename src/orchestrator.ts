import fs from "fs";
import path from "path";
import { Agent } from "./agent";
import { TypeChatLanguageModel, error, success } from "typechat";
import { AgentExecutor } from "./executor";
import { EscalationMessage, FinalAnswer } from "./orchestratorSchema";
import { Tracer, createDefaultTracer } from "./tracer";
import { ProgramPlanner } from "./planner";

// importing the schema source for OrchestratorInterface needed to construct the orchestrator prompt
const OrchestratorInterfaceSchema = fs.readFileSync(path.join(__dirname, "orchestratorSchema.d.ts"), "utf8");

export class OrchestratorAgent {
  #agents = new Map<string, Agent<any>>();
  #capabilities = new Map<string, string>();
  #planner: ProgramPlanner | undefined;
  #model: TypeChatLanguageModel;
  #maxTurns = 3;

  constructor(model: TypeChatLanguageModel, options?: {
    maxTurns?: number;
  }) {
    this.#model = model;
    if (options?.maxTurns) {
      this.#maxTurns = options.maxTurns;
    }
  }

  registerAgent(agent: Agent<any>) {
    const { name, description } = agent;
    this.#agents.set(name, agent);
    this.#capabilities.set(name, description);
  }

  async execute(prompt: string, parentTracer?: Tracer): Promise<EscalationMessage | FinalAnswer> {
    const planner = this.#getPlanner();
    parentTracer = parentTracer ?? await createDefaultTracer();
    const tracer = await parentTracer.sub(`Orchestrator`, "chain", {
      prompt,
      maxTurns: this.#maxTurns,
      agents: [...this.#agents.keys()], // List of available agents
    });
    const executor = new AgentExecutor(this.#agents, planner, {
      maxTurns: this.#maxTurns,
      tracer,
    });
    const result = await executor.execute(prompt);
    if ("CompleteAssignment" in result) {
      await tracer.success(result);
    } else {
      await tracer.error(result.Error, result);
    }
    return result;
  }

  #renderCapabilities() {
    return [...this.#capabilities.entries()].map(([name, description]) => 
`// ${description}
${name}(prompt: string): string;`).join("\n");
  }

  #getPlanner() {
    if (!this.#planner) {
      const schema = this.#generateOrchestratorSchema();
      this.#planner = new ProgramPlanner(this.#model, schema, {
        maxRepairAttempts: 2,
        validation: (data) => {
          const len = data["@steps"].length;
          const firstStep = data["@steps"][0];
          const lastStep = data["@steps"][len - 1];
          if (lastStep["@func"] === "CompleteAssignment" || firstStep["@func"] === "DeadEnd") {
            return len === 2 && firstStep["@func"] === "WriteThoughts" ? success(data) : error(`Invalid final turn program structure`);
          } else if (lastStep["@func"] === "NextTurn") {
            return len > 2 && firstStep["@func"] === "WriteThoughts" ? success(data) : error(`Invalid turn program structure`);
          }
          return error(`Invalid program structure`);
        }
      });
    }
    return this.#planner;
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
