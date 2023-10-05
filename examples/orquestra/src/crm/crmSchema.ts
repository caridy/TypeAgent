// Salesforce Object Type
export type SObjectType = "ACCOUNT" | "LEAD" | "CONTACT" | "OPPORTUNITY";
// A Salesforce CRM record id.
export type RecordId = string;

// fieldName: value pairs for fields in the given record.
export type RecordFieldsAndValues = { [key: string]: string; };

export type RecordInfo = {
  recordId: RecordId;
  SObjectType: SObjectType;
}

export interface ICRMAgent {
  // CRM CRU Skills

  // Creates a new record. Returns the id for the newly created record.
  createRecord(input: {
    // Type of the record to be created. Must be identified by either findSObjectByName or findSObjectType, and not assumed.
    SObjectType: SObjectType;
    // field:value pairs for the record. Fields and values must match those returned by getRecordFieldsAndValues() function for this SObjectType.
    fieldValuePairs: RecordFieldsAndValues;
  }): RecordId;

  // Updates a record.
  updateRecord(input: {
    SObjectType: SObjectType;
    // record to be updated
    recordId: RecordId;
    // field:value pairs to be updated, it must match those returned by getRecordFieldsAndValues() function for this SObjectType.
    fieldValuePairs: RecordFieldsAndValues;
  }): void;
  
  // Provides a summary for a given record. Returns the record summary.
  summarizeRecord(input: RecordInfo): string;

  // CRM Entity Resolution Skills:

  // Given a name or a phrase, identifies the corresponding Salesforce CRM Record or SObject.
  findSObjectByName(input: {
    // Name or phrase which must be mapped to a specific record, e.g. "foo" or "most recent oppty created for foo".
    objectNameOrIdentifier: string;
  }): RecordInfo;

  // Finds an SObjectType from its description.
  findSObjectType(input: {
    // Name or phrase.
    objectNameOrIdentifier: string;
  }): SObjectType;

  // Get Salesforce CRM record fields and their corresponding values from a user’s message.
  getRecordFieldsAndValues(input: {
    // The complete user utterance to facilitate identification of field and values.
    userMessage: string;
  }): RecordFieldsAndValues;

  getSObjectType(recordInfo: RecordInfo): SObjectType;
  getRecordId(recordInfo: RecordInfo): RecordId;

}

export type IAgent = ICRMAgent;
