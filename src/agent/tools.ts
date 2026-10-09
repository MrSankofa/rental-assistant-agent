import { properties } from "../data/properties";

export function getPropertyInformation(propertyId: string) {
  const property = properties[propertyId as keyof typeof properties];

  if (!property) {
    return {
      found: false,
      message: "Property not found",
    };
  }

  return {
    found: true,
    property,
  };
}

