import fs from "fs";
import path from "path";
import { Agent } from "./agent";
import { createProgramTranslator, TypeChatLanguageModel } from "typechat";
import { AgentExecutor } from "./executor";
import { EscalationMessage, FinalAnswer } from "./orchestratorSchema";
import { createRootRun } from "./tracer";
import { ProgramPlanner } from "./planner";

// importing the schema source for IOrchestratorAgent needed to construct the orchestrator prompt
const IOrchestratorAgentSchema = fs.readFileSync(path.join(__dirname, "orchestratorSchema.ts"), "utf8");

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

  async execute(prompt: string): Promise<EscalationMessage | FinalAnswer> {
    const planner = this.#getPlanner();
    const tracer = await createRootRun(prompt, {
      // Serialized representation of the orchestrator
      maxTurns: this.#maxTurns,
      agents: [...this.#agents.keys()], // List of available agents
    });
    await tracer.postRun();
    const executor = new AgentExecutor(this.#agents, planner, {
      maxTurns: this.#maxTurns,
      tracer,
    });
    const result = await executor.ThinkMore(prompt, []);
    if ("CompleteAssignment" in result) {
      await tracer.end({
        outputs: result,
      });
    } else {
      await tracer.end({
        error: result.Error,
        outputs: result,
      });
    }
    tracer.patchRun();
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
      this.#planner = new ProgramPlanner(this.#model, schema);
    }
    return this.#planner;
  }

  #generateOrchestratorSchema() {
    return `${IOrchestratorAgentSchema}

type IAgents = {
  ${this.#renderCapabilities()}
}

export type API = IOrchestratorAgent & IAgents;
`;
  }

}
