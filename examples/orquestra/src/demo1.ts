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

// const history = `BOT: Welcome to Salesforce CRM. How may I help you today?
// USER: I would like to know when my parcel from AboutYou arrives
// BOT: Sure, I can help you with that. Could you please provide me with the 9-digit tracking number of your parcel?
// USER: Tracking number is 123456789 and zip code is 22222
// BOT: Thank you, Kathy. Your parcel with tracking number 123456789 is currently in transit and is expected to be delivered on 08-09-2023.`;

const prompt = `Oh… I won't be at home on that day… And as it is a valuable delivery I don't want it to end up in a PackStation or at one of my neighbours. Can you please change the delivery date?`;

orchestrator.execute(prompt).then(response => {
  console.log(`Result: ${JSON.stringify(response)}`);
});
