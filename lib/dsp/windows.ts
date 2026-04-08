/**
 * Window functions used before each FFT frame.
 * They taper the frame edges so the spectrum is cleaner.
 */

export type WindowType = "hann" | "hamming" | "rect";

/** Create one analysis window of the requested type and size. */
export function createWindow(type: WindowType, size: number): Float32Array {
  const w = new Float32Array(size);
  switch (type) {
    case "hann":
      // Smooth taper at both ends; good default for STFT.
      for (let i = 0; i < size; i++)
        w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)));
      break;
    case "hamming":
      // Similar to Hann, but keeps a little more energy near the edges.
      for (let i = 0; i < size; i++)
        w[i] = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (size - 1));
      break;
    case "rect":
      // No tapering; included for comparison.
      w.fill(1);
      break;
    default:
      w.fill(1);
  }
  return w;
}

