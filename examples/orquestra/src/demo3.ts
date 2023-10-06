import path from "path";
import dotenv from "dotenv";
import { createLanguageModel } from "typechat";
import { OrchestratorAgent } from "typeagent";
import { CRMAgent } from "./crm/crm";
import { ShipmentAgent } from "./shipment/shipment";

// TODO: use local .env file.
dotenv.config({ path: path.join(__dirname, "../../../.env") });

const model = createLanguageModel(process.env);
const orchestrator = new OrchestratorAgent(model);
orchestrator.registerAgent(new CRMAgent(model));
orchestrator.registerAgent(new ShipmentAgent(model));

// const history = "BOT: Welcome to Salesforce CRM. How may I help you today?";

const prompt = `Locate a package from AboutYou with tracking number is 123456789 and zip code is 22222`;

orchestrator.execute(prompt).then(response => {
  console.log(`Result: ${JSON.stringify(response)}`);
});
