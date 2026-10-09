export type Property = {
  name: string,
  available: boolean,
  rent: number,
  bedrooms: number,
  bathrooms: number,
  utilitiesIncluded: boolean,
  parking: string,
  leaseTerm: string,
  applicationUrl: string,
}
export type PropertyInfoResponse = {
  found: boolean,
  message?: string
  property?: Property
}