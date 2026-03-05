"use client";

import { useRef, useEffect } from "react";

/**
 * Frames are dB magnitude: rows = time, each row has fftSize/2+1 bins (frequency).
 * Low freq at bottom, high at top (or flip to match convention).
 */
interface SpectrogramCanvasProps {
  dbFrames: Float32Array[];
  sampleRate: number;
  fftSize: number;
  hopLength: number;
  width: number;
  height: number;
  className?: string;
}

export function SpectrogramCanvas({
  dbFrames,
  sampleRate,
  fftSize,
  hopLength,
  width,
  height,
  className = "",
}: SpectrogramCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !dbFrames.length || !dbFrames[0].length) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = width;
    canvas.height = height;

    const numFrames = dbFrames.length;
    const numBins = dbFrames[0].length;

    // Find dB range for colormap
    let minDb = Infinity;
    let maxDb = -Infinity;
    for (let t = 0; t < numFrames; t++) {
      for (let f = 0; f < numBins; f++) {
        const v = dbFrames[t][f];
        if (v < minDb) minDb = v;
        if (v > maxDb) maxDb = v;
      }
    }
    const range = maxDb - minDb || 1;

    const imageData = ctx.createImageData(width, height);
    const data = imageData.data;

    for (let py = 0; py < height; py++) {
      const binIndex = Math.floor((1 - py / height) * numBins); // low freq at bottom
      const bin = Math.max(0, Math.min(binIndex, numBins - 1));
      for (let px = 0; px < width; px++) {
        const frameIndex = Math.floor((px / width) * numFrames);
        const frame = Math.max(0, Math.min(frameIndex, numFrames - 1));
        const db = dbFrames[frame][bin];
        const t = (db - minDb) / range;
        // Simple grayscale: 0 = black, 1 = white
        const gray = Math.round(255 * Math.max(0, Math.min(1, t)));
        const i = (py * width + px) * 4;
        data[i] = gray;
        data[i + 1] = gray;
        data[i + 2] = gray;
        data[i + 3] = 255;
      }
    }
    ctx.putImageData(imageData, 0, 0);
  }, [dbFrames, width, height, sampleRate, fftSize, hopLength]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className={className}
      style={{ maxWidth: "100%", height: "auto" }}
    />
  );
}
