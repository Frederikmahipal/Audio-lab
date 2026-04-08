/**
 * Simple denoise helpers based on spectral subtraction.
 * Good for teaching because the idea is easy to follow frame by frame.
 */

export interface DenoiseOptions {
  /** Number of frames to use for noise profile (from the start). */
  noiseFrames: number;
  /** Over-subtraction factor (1 = subtract once, 1.5 = subtract more aggressively). */
  alpha?: number;
  /** Floor as fraction of noise profile (e.g. 0.01 = don't go below 1% of noise per bin). */
  floorFrac?: number;
}

/** Median is used so a few loud outliers do not dominate the noise estimate. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Estimate one typical noise spectrum from the first frames of the clip. */
export function estimateNoiseProfile(
  magnitudeFrames: Float32Array[],
  noiseFrames: number
): Float32Array {
  const numBins = magnitudeFrames[0]!.length;
  const n = Math.min(noiseFrames, magnitudeFrames.length);
  const profile = new Float32Array(numBins);
  for (let k = 0; k < numBins; k++) {
    const vals: number[] = [];

    // Look at one frequency bin across several early frames.
    for (let t = 0; t < n; t++) vals.push(magnitudeFrames[t]![k]!);
    profile[k] = median(vals);
  }
  return profile;
}

/** Subtract the estimated noise from every frame, but keep a small floor. */
export function spectralSubtraction(
  magnitudeFrames: Float32Array[],
  noiseProfile: Float32Array,
  alpha: number = 1.2,
  floorFrac: number = 0.01
): Float32Array[] {
  return magnitudeFrames.map((mag) => {
    const out = new Float32Array(mag.length);
    for (let k = 0; k < mag.length; k++) {
      // The floor avoids negative values and reduces harsh reconstruction artifacts.
      const floor = floorFrac * noiseProfile[k]!;
      out[k] = Math.max(mag[k]! - alpha * noiseProfile[k]!, floor);
    }
    return out;
  });
}
