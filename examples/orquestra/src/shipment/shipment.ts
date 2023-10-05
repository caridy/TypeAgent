import fs from "fs";
import path from "path";
import { Agent, Asyncify } from "typeagent";
import type { TypeChatLanguageModel } from "typechat";

import { IShipmentAgent, IsoDate, TrackingNumber } from "./shipmentSchema";
// importing the schema source for IShipmentAgent to create an instance of Agent
const schema = fs.readFileSync(path.join(__dirname, "shipmentSchema.ts"), "utf8");

export class ShipmentAgent extends Agent<IShipmentAgent> implements Asyncify<IShipmentAgent> {

  name = "Shipment";

  description = "Use this agent to interact with the DHL's Shipment and Tracking system. It can perform operations all common operations about tracking, packages, delivery dates, etc., all based on a natural language prompt input. If the agent succeed, it returns the result of the operation in natural language. If it fails, it returns an error message in natural language for interpretation.";

  constructor(model: TypeChatLanguageModel) {
    super(model, schema);
  }

  async DHLChangeDeliveryDate(input: { trackingNumber: TrackingNumber; newDeliveryDate: IsoDate; }): Promise<TrackingNumber> {
    return input.trackingNumber; // mock data
    // throw new Error("Not implemented");
  }
  async DHLGetAvailableDeliveryDates(_input: { trackingNumber: TrackingNumber; expectedDeliveryDate: IsoDate; }): Promise<IsoDate[]> {
    return ["2023-09-24T07:08:05.016Z", "2023-010-24T07:08:05.016Z"]; // mock data
    // throw new Error("Not implemented");
  }
  async DHLTrackShipment(_input: { trackingNumber: TrackingNumber; }): Promise<{ trackingNumber: TrackingNumber; customerFullName: string; status: string; estimatedDeliveryDate: IsoDate; actualDeliveryDate: IsoDate; }> {
    return {
      trackingNumber: "123456789",
      customerFullName: "Caridy Patino",
      status: "Pending",
      estimatedDeliveryDate: "2023-08-24T07:08:05.016Z",
      actualDeliveryDate: "2023-08-24T07:08:05.016Z"
    }; // mock data
    // throw new Error("Not implemented");
  }

}
