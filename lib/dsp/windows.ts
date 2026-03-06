/**
 * Window functions for STFT.
 * All return a new Float32Array of length size.
 */

export type WindowType = "hann" | "hamming" | "rect";

export function createWindow(type: WindowType, size: number): Float32Array {
  const w = new Float32Array(size);
  switch (type) {
    case "hann":
      for (let i = 0; i < size; i++)
        w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)));
      break;
    case "hamming":
      for (let i = 0; i < size; i++)
        w[i] = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (size - 1));
      break;
    case "rect":
      w.fill(1);
      break;
    default:
      w.fill(1);
  }
  return w;
}


