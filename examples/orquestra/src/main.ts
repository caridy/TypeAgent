import path from "path";
import dotenv from "dotenv";
import { processRequests, createLanguageModel } from "typechat";
import { OrchestratorAgent } from "typeagent";
import { CRMAgent } from "./crm/crm";
import { ShipmentAgent } from "./shipment/shipment";

// TODO: use local .env file.
dotenv.config({ path: path.join(__dirname, "../../../.env") });

const model = createLanguageModel(process.env);
const orchestrator = new OrchestratorAgent(model);
orchestrator.registerAgent(new CRMAgent(model));
orchestrator.registerAgent(new ShipmentAgent(model));

// Process requests interactively or from the input file specified on the command line
processRequests("orchestrator> ", process.argv[2], async (request) => {
    const response = await orchestrator.execute(request, {}, []);
    console.log(`Result: ${JSON.stringify(response)}`);
});
