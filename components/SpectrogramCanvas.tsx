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

    const dpr = window.devicePixelRatio || 1;
    const targetWidth = Math.max(1, Math.floor((canvas.clientWidth || width) * dpr));
    const targetHeight = Math.max(
      1,
      Math.floor((canvas.clientHeight || height) * dpr)
    );
    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth;
      canvas.height = targetHeight;
    }
    const drawWidth = canvas.width;
    const drawHeight = canvas.height;
    ctx.clearRect(0, 0, drawWidth, drawHeight);

    const numFrames = dbFrames.length;
    const numBins = dbFrames[0].length;

    // Find robust dB range for colormap.
    let maxDb = -Infinity;
    let observedMinDb = Infinity;
    const ignoreLowBins = Math.min(2, numBins - 1);
    for (let t = 0; t < numFrames; t++) {
      for (let f = ignoreLowBins; f < numBins; f++) {
        const v = dbFrames[t][f];
        if (v > maxDb) maxDb = v;
        if (v < observedMinDb) observedMinDb = v;
      }
    }
    if (!Number.isFinite(maxDb) || !Number.isFinite(observedMinDb)) return;

    const minDb = Math.max(observedMinDb, maxDb - 90);
    const range = Math.max(30, maxDb - minDb);

    const imageData = ctx.createImageData(drawWidth, drawHeight);
    const data = imageData.data;

    const frameDenom = Math.max(1, drawWidth - 1);
    const binDenom = Math.max(1, drawHeight - 1);

    for (let py = 0; py < drawHeight; py++) {
      const binIndex = Math.floor(((drawHeight - 1 - py) / binDenom) * (numBins - 1));
      const bin = Math.max(0, Math.min(numBins - 1, binIndex)); // low at bottom
      for (let px = 0; px < drawWidth; px++) {
        const frameIndex = Math.floor((px / frameDenom) * (numFrames - 1));
        const frame = Math.max(0, Math.min(numFrames - 1, frameIndex));
        const db =
          bin < ignoreLowBins ? minDb : dbFrames[frame][bin];
        const normalized = Math.max(0, Math.min(1, (db - minDb) / range));
        const t = Math.pow(normalized, 0.78);
        const [r, g, b] = colorMap(t);
        const i = (py * drawWidth + px) * 4;
        data[i] = r;
        data[i + 1] = g;
        data[i + 2] = b;
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
      style={{ width: "100%", height: "100%", display: "block" }}
    />
  );
}

function colorMap(t: number): [number, number, number] {
  if (t < 0.42) {
    return lerpColor(t / 0.42, [236, 241, 249], [174, 192, 222]);
  }
  return lerpColor((t - 0.42) / 0.58, [174, 192, 222], [44, 70, 116]);
}

function lerpColor(
  t: number,
  a: [number, number, number],
  b: [number, number, number]
): [number, number, number] {
  const x = Math.max(0, Math.min(1, t));
  return [
    Math.round(a[0] + (b[0] - a[0]) * x),
    Math.round(a[1] + (b[1] - a[1]) * x),
    Math.round(a[2] + (b[2] - a[2]) * x),
  ];
}
