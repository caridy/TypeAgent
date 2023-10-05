import fs from "fs";
import path from "path";
import { Agent } from "./agent";
import { Program, createProgramTranslator, TypeChatJsonTranslator, TypeChatLanguageModel } from "typechat";
import { AgentExecutor } from "./executor";
import { Context, EscalationMessage, FinalAnswer, History } from "./orchestratorSchema";

// importing the schema source for IOrchestratorAgent needed to construct the orchestrator prompt
const IOrchestratorAgentSchema = fs.readFileSync(path.join(__dirname, "orchestratorSchema.ts"), "utf8");

export class OrchestratorAgent {
  #agents = new Map<string, Agent<any>>();
  #capabilities = new Map<string, string>();
  #translator: TypeChatJsonTranslator<Program> | undefined;
  #model: TypeChatLanguageModel;

  constructor(model: TypeChatLanguageModel) {
    this.#model = model;
  }

  registerAgent(agent: Agent<any>) {
    const { name, description } = agent;
    this.#agents.set(name, agent);
    this.#capabilities.set(name, description);
  }

  async execute(prompt: string, context: Context, history: History): Promise<EscalationMessage | FinalAnswer> {
    const translator = this.#getTranslator();
    const executor = new AgentExecutor(this.#agents, translator, context, history);
    return await executor.ThinkMore(prompt, []);
  }

  #renderCapabilities() {
    return [...this.#capabilities.entries()].map(([name, description]) => 
`// ${description}
${name}(prompt: string): string;`).join("\n");
  }

  #getTranslator() {
    if (!this.#translator) {
      const schema = this.#generateOrchestratorSchema();
      this.#translator = createProgramTranslator(this.#model, schema);
    }
    return this.#translator;
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
