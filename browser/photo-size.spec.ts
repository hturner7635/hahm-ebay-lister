import { test, expect, type Page, type Route } from "@playwright/test";

// Vercel rejects request bodies over 4.5 MB.
const VERCEL_BODY_LIMIT = 4_500_000;

// Detailed, photo-like JPEGs made in the page: smooth colour fields plus
// sensor-style grain, like real product shots. Each seed makes a different photo.
async function detailedPhotos(page: Page, count: number): Promise<string[]> {
  return page.evaluate((count) => {
    const photos: string[] = [];
    for (let seed = 1; seed <= count; seed++) {
      let s = seed;
      const rand = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
      const small = document.createElement("canvas");
      small.width = 40;
      small.height = 30;
      const sctx = small.getContext("2d")!;
      const colours = sctx.createImageData(40, 30);
      for (let i = 0; i < colours.data.length; i += 4) {
        colours.data[i] = 60 + rand() * 120;
        colours.data[i + 1] = 60 + rand() * 120;
        colours.data[i + 2] = 80 + rand() * 140;
        colours.data[i + 3] = 255;
      }
      sctx.putImageData(colours, 0, 0);
      const canvas = document.createElement("canvas");
      canvas.width = 1600;
      canvas.height = 1200;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(small, 0, 0, canvas.width, canvas.height);
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
      for (let i = 0; i < pixels.data.length; i += 4) {
        const grain = (rand() - 0.5) * 56;
        pixels.data[i] += grain;
        pixels.data[i + 1] += grain;
        pixels.data[i + 2] += grain;
      }
      ctx.putImageData(pixels, 0, 0);
      photos.push(canvas.toDataURL("image/jpeg", 0.92).split(",")[1]);
    }
    return photos;
  }, count);
}

// Base64 size of the photos at the app's normal analysis size (1024px, 0.82).
async function analysisSize(page: Page, photos: string[]): Promise<number> {
  return page.evaluate(async (photos) => {
    let total = 0;
    for (const data of photos) {
      const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(
        new Blob([bytes], { type: "image/jpeg" }),
      );
      const ratio = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bitmap.width * ratio);
      canvas.height = Math.round(bitmap.height * ratio);
      canvas
        .getContext("2d")!
        .drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      total += canvas.toDataURL("image/jpeg", 0.82).split(",")[1].length;
    }
    return total;
  }, photos);
}

test("a photo-heavy item is shrunk to fit the request size limit", async ({
  page,
}) => {
  const requests: { path: string; chars: number; photos: number }[] = [];
  const record = (route: Route) => {
    const body = route.request().postData() ?? "";
    requests.push({
      path: new URL(route.request().url()).pathname,
      chars: body.length,
      photos: JSON.parse(body).images?.length ?? 0,
    });
  };
  await page.route("**/api/ebay/status", (r) =>
    r.fulfill({ json: { connected: true } }),
  );
  await page.route("**/api/models", (r) =>
    r.fulfill({ json: { sortModels: [], analysisModels: [] } }),
  );
  await page.route("**/api/analyze", (r) => {
    record(r);
    return r.fulfill({
      json: {
        ok: true,
        listing: {
          title: "Levi's 501 Jeans",
          description: "Light fading.",
          brand: "Levi's",
          item_type: "Jeans",
          condition: "GOOD",
          suggested_price: 30,
          item_specifics: { Brand: "Levi's" },
        },
        usage: [],
      },
    });
  });
  await page.route("**/api/ebay/prepare", (r) => {
    record(r);
    const listing = r.request().postDataJSON().listing;
    return r.fulfill({
      json: {
        ok: true,
        listing: { ...listing, category_id: "11483", ebay_condition: "" },
        preparation: {
          categoryId: "11483",
          categoryName: "Jeans",
          aspects: [],
          conditions: [{ value: "USED_EXCELLENT", label: "Used" }],
          expiresAt: Date.now() + 3600000,
          signature: "test",
          issues: [],
        },
      },
    });
  });
  await page.route("**/api/ebay/comps", (r) =>
    r.fulfill({ json: { ok: false, error: "Research unavailable" } }),
  );
  await page.goto("/");
  await expect(page.getByText("Restoring saved work…")).toBeHidden();

  const photos = await detailedPhotos(page, 20);
  // At the normal size, these photos together would be rejected by Vercel.
  expect(await analysisSize(page, photos)).toBeGreaterThan(VERCEL_BODY_LIMIT);

  await page.locator("input[type=file]").setInputFiles(
    photos.map((data, i) => ({
      name: `jeans-${i + 1}.jpg`,
      mimeType: "image/jpeg",
      buffer: Buffer.from(data, "base64"),
    })),
  );
  await expect(page.locator(".thumb")).toHaveCount(20);
  await page.getByRole("button", { name: "These photos are one item" }).click();
  await page.getByRole("button", { name: /Write.*listing/i }).click();
  await expect(page.getByText("Jeans", { exact: true })).toBeVisible();

  expect(requests.map((r) => r.path)).toEqual([
    "/api/analyze",
    "/api/ebay/prepare",
  ]);
  for (const request of requests) {
    expect(request.photos).toBe(20);
    expect(request.chars).toBeLessThan(VERCEL_BODY_LIMIT);
  }
});
