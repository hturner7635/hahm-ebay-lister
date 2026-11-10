import { describe, expect, it, vi } from "vitest";
import {
  ANALYSIS_SIZE_STEPS,
  ANALYSIS_TARGET_CHARS,
  MAX_ANALYSIS_PHOTOS,
  MAX_ANALYSIS_REQUEST_CHARS,
  fitPhotosForAnalysis,
  type AnalysisImage,
} from "@/lib/analysis-photos";
import { imagesSchema } from "@/lib/validation";

// A photo of `chars` base64 characters, labelled so shrunk copies can be told
// apart from the originals.
const photo = (chars: number, label = "p"): AnalysisImage => ({
  mediaType: "image/jpeg",
  data: label.padEnd(chars, "A"),
});

// Shrinks like JPEG roughly does: size follows pixel area relative to 1024px.
function fakeShrink() {
  const calls: { from: string; maxDim: number }[] = [];
  const shrink = vi.fn(
    async (image: AnalysisImage, maxDim: number): Promise<AnalysisImage> => {
      calls.push({ from: image.data.slice(0, 1), maxDim });
      const chars = Math.round(image.data.length * (maxDim / 1024) ** 2);
      return { mediaType: "image/jpeg", data: "s".padEnd(chars, "B") };
    },
  );
  return { shrink, calls };
}
const totalChars = (images: AnalysisImage[]) =>
  images.reduce((n, image) => n + image.data.length, 0);

describe("fitting an item's photos into one request", () => {
  it("sends photos that already fit exactly as they are", async () => {
    const { shrink } = fakeShrink();
    const photos = [photo(200_000, "a"), photo(300_000, "b")];
    expect(await fitPhotosForAnalysis(photos, shrink)).toEqual(photos);
    expect(shrink).not.toHaveBeenCalled();
  });

  it("sends no more photos than the analysis reads", async () => {
    const { shrink } = fakeShrink();
    const photos = Array.from({ length: 30 }, (_, i) => photo(1_000, `p${i}`));
    expect(await fitPhotosForAnalysis(photos, shrink)).toEqual(
      photos.slice(0, MAX_ANALYSIS_PHOTOS),
    );
  });

  it("shrinks photo-heavy items to the largest size that fits", async () => {
    const { shrink, calls } = fakeShrink();
    // 20 detailed photos: too big at full size and at 896px, fine at 768px.
    const photos = Array.from({ length: 20 }, () => photo(290_000));
    const result = await fitPhotosForAnalysis(photos, shrink);
    expect([...new Set(calls.map((c) => c.maxDim))]).toEqual([896, 768]);
    // Every step starts from the full-size photos, never a shrunk copy.
    expect(calls.every((c) => c.from === "p")).toBe(true);
    expect(result).toHaveLength(20);
    expect(totalChars(result)).toBeLessThanOrEqual(ANALYSIS_TARGET_CHARS);
  });

  it("asks the seller to move photos out when even the smallest size is too big", async () => {
    const { shrink } = fakeShrink();
    const photos = Array.from({ length: 24 }, () => photo(600_000));
    await expect(fitPhotosForAnalysis(photos, shrink)).rejects.toThrow(
      "Move a few photos out of this item",
    );
    expect(shrink).toHaveBeenCalledTimes(24 * ANALYSIS_SIZE_STEPS.length);
  });

  it("aims within what the server accepts", () => {
    expect(ANALYSIS_TARGET_CHARS).toBeLessThan(MAX_ANALYSIS_REQUEST_CHARS);
    const atTarget = Array.from({ length: MAX_ANALYSIS_PHOTOS }, () =>
      photo(Math.floor(ANALYSIS_TARGET_CHARS / MAX_ANALYSIS_PHOTOS)),
    );
    expect(imagesSchema.safeParse(atTarget).success).toBe(true);
  });
});
