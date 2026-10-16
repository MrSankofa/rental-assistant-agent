export interface Property {
  name: string;
  address: string;
  city: string;
  state: string;
  zipCode: string;

  available: boolean;
  rent: number | null;

  bedrooms: number;
  bathrooms: number;

  utilitiesIncluded: boolean;
  parking: string;
  leaseTerm: string;

  applicationUrl: string;
  applicationAvailableFrom: string | null;

  showingUrl: string;
}

export interface PropertyInfoResponse {
  found: boolean;
  message?: string;
  property?: Property;
}