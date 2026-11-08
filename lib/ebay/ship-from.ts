// The seller's ship-from address, used to create their eBay inventory location
// (eBay won't publish an offer without one). It comes from environment
// variables, never from code, because it is the seller's real address and
// forks of this project are often public.

export interface ShipFromAddress {
  addressLine1?: string;
  city?: string;
  stateOrProvince?: string;
  postalCode: string;
  country: string;
}

// Letters only, well inside eBay's 36-character limit for merchantLocationKey.
export const SHIP_FROM_LOCATION_KEY = "ListingWriterShipFrom";
export const SHIP_FROM_LOCATION_NAME = "Ship-from address";

type Env = Record<string, string | undefined>;

/** The configured ship-from address, or null until EBAY_LOCATION_POSTAL_CODE is set. */
export function shipFromAddressFromEnv(
  env: Env = process.env,
): ShipFromAddress | null {
  const value = (key: string) => env[key]?.trim() || undefined;
  const postalCode = value("EBAY_LOCATION_POSTAL_CODE");
  if (!postalCode) return null;
  return {
    addressLine1: value("EBAY_LOCATION_ADDRESS"),
    city: value("EBAY_LOCATION_CITY"),
    stateOrProvince: value("EBAY_LOCATION_STATE"),
    postalCode,
    country: (value("EBAY_LOCATION_COUNTRY") ?? "US").toUpperCase(),
  };
}

/** Request body for eBay's createInventoryLocation call. */
export function shipFromLocationBody(address: ShipFromAddress) {
  return {
    location: { address },
    locationTypes: ["WAREHOUSE"],
    merchantLocationStatus: "ENABLED",
    name: SHIP_FROM_LOCATION_NAME,
  };
}
