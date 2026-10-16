import { Property } from "../types/property";

export const properties: Record<string, Property> = {
  virginia: {
    name: "Virginia",
    address: "Virginia Park St",
    city: "Detroit",
    state: "MI",
    zipCode: "",

    available: true,
    rent: 1800,

    bedrooms: 3,
    bathrooms: 1,

    utilitiesIncluded: false,
    parking: "Driveway and street parking available",
    leaseTerm: "12 months",

    applicationUrl: "https://example.com/apply",
    applicationAvailableFrom: null,

    showingUrl: "",
  },

  ziegler: {
    name: "Ziegler",
    address: "4932 Ziegler St",
    city: "Dearborn Heights",
    state: "MI",
    zipCode: "48125",

    available: true,

  
    rent: 1500,

    bedrooms: 3,
    bathrooms: 1,

    utilitiesIncluded: false,
    parking: "Driveway and two-car garage",
    leaseTerm: "12 months",

    applicationUrl:
      "https://www.zillow.com/homedetails/4932-Ziegler-St-Dearborn-Heights-MI-48125/88094499_zpid/?view=public",

    applicationAvailableFrom: "2026-10-24",

    showingUrl:
      "https://calendly.com/altruistic-re/ziegler-house-showing",
  },
};