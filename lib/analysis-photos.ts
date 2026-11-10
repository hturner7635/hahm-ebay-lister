// Writing or preparing a listing sends all of an item's photos in one request,
// and Vercel rejects request bodies over 4.5 MB. Photo-heavy items (lots of
// tag and detail shots) can pass that at the normal 1024px analysis size, so
// before sending, the photos are re-encoded a step smaller, but only when
// they would not fit.

export type AnalysisImage = { mediaType: string; data: string }; // raw base64

/** The analysis reads at most this many photos per item. */
export const MAX_ANALYSIS_PHOTOS = 24;

/** Server-side cap on one request's photo data, in base64 characters. */
export const MAX_ANALYSIS_REQUEST_CHARS = 3_800_000;

// What the browser aims for: a little under the server's cap, which itself
// leaves room under Vercel's 4.5 MB limit for the rest of the request.
export const ANALYSIS_TARGET_CHARS = 3_600_000;

// Smaller encodings to try, largest first. 640px still keeps close-up tag
// text readable; below that, it's better to send fewer photos.
export const ANALYSIS_SIZE_STEPS = [
  { maxDim: 896, quality: 0.8 },
  { maxDim: 768, quality: 0.76 },
  { maxDim: 640, quality: 0.72 },
] as const;

export type ShrinkPhoto = (
  image: AnalysisImage,
  maxDim: number,
  quality: number,
) => Promise<AnalysisImage>;

const totalChars = (images: AnalysisImage[]) =>
  images.reduce((n, image) => n + image.data.length, 0);

/**
 * The item's photos, ready to send in one request: the first
 * MAX_ANALYSIS_PHOTOS as they are when they fit, otherwise all of them at the
 * largest smaller size that fits.
 */
export async function fitPhotosForAnalysis(
  images: AnalysisImage[],
  shrink: ShrinkPhoto,
  targetChars: number = ANALYSIS_TARGET_CHARS,
): Promise<AnalysisImage[]> {
  const kept = images.slice(0, MAX_ANALYSIS_PHOTOS);
  if (totalChars(kept) <= targetChars) return kept;
  for (const { maxDim, quality } of ANALYSIS_SIZE_STEPS) {
    // Always shrink from the full-size photos, so quality loss never compounds.
    const smaller = await Promise.all(
      kept.map((image) => shrink(image, maxDim, quality)),
    );
    if (totalChars(smaller) <= targetChars) return smaller;
  }
  throw new Error(
    "This item's photos are too large to send together, even after shrinking them. Move a few photos out of this item on the review screen, then try again.",
  );
}
