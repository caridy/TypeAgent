// Date string format based on ISO 8601. The timezone is always UTC.
export type IsoDate = string;

// 9-digit tracking number.
export type TrackingNumber = string;

export type IShipmentAgent = {

  // Changes the delivery date of a shipment based on customer request.
  DHLChangeDeliveryDate(input: {
    trackingNumber: TrackingNumber;
    newDeliveryDate: IsoDate;
  }): TrackingNumber;

  // Provides a list of alternate delivery dates for a shipment.
  DHLGetAvailableDeliveryDates(input: {
    trackingNumber: TrackingNumber;
    expectedDeliveryDate: IsoDate;
  }): IsoDate[];

  // Get the tracking info for a package.
  DHLTrackShipment(input: {
    trackingNumber: TrackingNumber;
  }): {
    trackingNumber: TrackingNumber;
    // Full name for the customer.
    customerFullName: string;
    // Current status for the shipment.
    status: string;
    // The initial estimate for the delivery during shipment.
    estimatedDeliveryDate: IsoDate;
    // Date when the delivery was finally made.
    actualDeliveryDate: IsoDate;
  };

};

export type IAgent = IShipmentAgent;
