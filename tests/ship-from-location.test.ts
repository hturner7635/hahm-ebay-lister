import { afterEach, describe, expect, it, vi } from "vitest";
import { EBAY_INV_BASE } from "@/lib/ebay/config";
import {
  ensureShipFromLocation,
  type AccountOptions,
} from "@/lib/ebay/publish";
import {
  SHIP_FROM_LOCATION_KEY,
  shipFromAddressFromEnv,
  shipFromLocationBody,
} from "@/lib/ebay/ship-from";

const address = {
  addressLine1: "100 Main St",
  city: "Springfield",
  stateOrProvince: "IL",
  postalCode: "62701",
  country: "US",
};
const noLocation: AccountOptions = {
  fulfillment: [{ id: "ship", name: "Shipping" }],
  payment: [{ id: "pay", name: "Payment" }],
  returns: [{ id: "ret", name: "Returns" }],
  locations: [],
};
const locationUrl = `${EBAY_INV_BASE}/location/${SHIP_FROM_LOCATION_KEY}`;

// Answers eBay calls in order with the given [status, body] replies.
function fakeEbay(...replies: [number, unknown?][]) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init: RequestInit = {}) => {
      calls.push({
        method: init.method || "GET",
        url: String(url),
        body: init.body ? JSON.parse(String(init.body)) : null,
      });
      const reply = replies.shift();
      if (!reply) throw new Error("Unexpected eBay request " + String(url));
      const [status, body] = reply;
      return new Response(body === undefined ? null : JSON.stringify(body), {
        status,
      });
    }),
  );
  return calls;
}
afterEach(() => vi.unstubAllGlobals());

describe("ship-from address settings", () => {
  it("stay off until a postal code is set", () => {
    expect(shipFromAddressFromEnv({})).toBeNull();
    expect(
      shipFromAddressFromEnv({
        EBAY_LOCATION_CITY: "Springfield",
        EBAY_LOCATION_POSTAL_CODE: "  ",
      }),
    ).toBeNull();
  });

  it("read the address, trimming spaces and defaulting the country to US", () => {
    expect(
      shipFromAddressFromEnv({
        EBAY_LOCATION_ADDRESS: " 100 Main St ",
        EBAY_LOCATION_CITY: "Springfield",
        EBAY_LOCATION_STATE: "IL",
        EBAY_LOCATION_POSTAL_CODE: "62701 ",
        EBAY_LOCATION_COUNTRY: "",
      }),
    ).toEqual(address);
    expect(
      shipFromAddressFromEnv({
        EBAY_LOCATION_POSTAL_CODE: "SW1A 1AA",
        EBAY_LOCATION_COUNTRY: "gb",
      }),
    ).toEqual({ postalCode: "SW1A 1AA", country: "GB" });
  });

  it("describe an enabled warehouse location", () => {
    expect(shipFromLocationBody(address)).toEqual({
      location: { address },
      locationTypes: ["WAREHOUSE"],
      merchantLocationStatus: "ENABLED",
      name: "Ship-from address",
    });
  });
});

describe("creating the eBay shipping location", () => {
  it("leaves accounts that already have a location alone", async () => {
    const calls = fakeEbay();
    const options = {
      ...noLocation,
      locations: [{ id: "home", name: "Home" }],
    };
    expect(await ensureShipFromLocation("token", options, address)).toBe(
      options,
    );
    expect(calls).toEqual([]);
  });

  it("does nothing until an address is configured", async () => {
    const calls = fakeEbay();
    expect(await ensureShipFromLocation("token", noLocation, null)).toBe(
      noLocation,
    );
    expect(calls).toEqual([]);
  });

  it("creates the location from the address and offers it", async () => {
    const calls = fakeEbay([204]);
    const result = await ensureShipFromLocation("token", noLocation, address);
    expect(calls).toEqual([
      { method: "POST", url: locationUrl, body: shipFromLocationBody(address) },
    ]);
    expect(result.locations).toEqual([
      { id: SHIP_FROM_LOCATION_KEY, name: "Ship-from address · 62701 · US" },
    ]);
    expect(result.fulfillment).toEqual(noLocation.fulfillment);
    expect(result.locationNote).toBeUndefined();
  });

  it("re-enables the location when it exists but was disabled", async () => {
    const calls = fakeEbay(
      [409, { errors: [{ message: "Location already exists." }] }],
      [200, {}],
    );
    const result = await ensureShipFromLocation("token", noLocation, address);
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      `POST ${locationUrl}`,
      `POST ${locationUrl}/enable`,
    ]);
    expect(result.locations.map((l) => l.id)).toEqual([SHIP_FROM_LOCATION_KEY]);
  });

  it("keeps the policies and explains why when eBay refuses", async () => {
    fakeEbay([400, { errors: [{ longMessage: "Invalid postal code." }] }]);
    const result = await ensureShipFromLocation("token", noLocation, address);
    expect(result.locations).toEqual([]);
    expect(result.fulfillment).toEqual(noLocation.fulfillment);
    expect(result.locationNote).toContain("Invalid postal code.");
  });
});
