import fs from "fs";
import path from "path";
import { Agent, Asyncify } from "typeagent";
import type { TypeChatLanguageModel } from "typechat";

import { ICRMAgent, RecordFieldsAndValues, RecordId, RecordInfo, SObjectType } from "./crmSchema";
// importing the schema source for IShipmentAgent to create an instance of Agent
const schema = fs.readFileSync(path.join(__dirname, "crmSchema.ts"), "utf8");

export class CRMAgent extends Agent<ICRMAgent> implements Asyncify<ICRMAgent> {

  name = "CRM";

  description = "Use this agent to interact with the Customer Relationship Management (CRM) system. It can perform CRUD operations. It can also perform operations like summarizing, recommending and computations based on a natural language prompt input. If the agent succeed, it returns the result of the operation in natural language. If it fails, it returns an error message in natural language for interpretation.";

  constructor(model: TypeChatLanguageModel) {
    super(model, schema);
  }

  async createRecord(_input: { SObjectType: SObjectType; fieldValuePairs: RecordFieldsAndValues; }): Promise<RecordId> {
    throw new Error("Not implemented");
  }

  async updateRecord(_input: { SObjectType: SObjectType; recordId: RecordId; fieldValuePairs: RecordFieldsAndValues; }): Promise<void> {
    throw new Error("Not implemented");
  }

  async summarizeRecord(_input: { recordId: RecordId; SObjectType: SObjectType; }): Promise<string> {
    throw new Error("Not implemented");
  }

  async findSObjectByName(_input: { objectNameOrIdentifier: string; }): Promise<RecordInfo> {
    throw new Error("Not implemented");
  }

  async findSObjectType(_input: { objectNameOrIdentifier: string; }): Promise<SObjectType> {
    throw new Error("Not implemented");
  }

  async getRecordFieldsAndValues(_input: { userMessage: string; }): Promise<RecordFieldsAndValues> {
    throw new Error("Not implemented");
  }

  async getSObjectType(_input: { recordId: RecordId; SObjectType: SObjectType; }): Promise<SObjectType> {
    throw new Error("Not implemented");
  }

  async getRecordId(_input: { recordId: RecordId; SObjectType: SObjectType; }): Promise<RecordId> {
    throw new Error("Not implemented");
  }

}
