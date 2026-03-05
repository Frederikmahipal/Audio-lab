"use client";

import { useRef, useEffect } from "react";

interface WaveformCanvasProps {
  samples: Float32Array;
  width: number;
  height: number;
  className?: string;
}

export function WaveformCanvas({
  samples,
  width,
  height,
  className = "",
}: WaveformCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || samples.length === 0) return;

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

    const padding = 2;
    const w = drawWidth - 2 * padding;
    const h = drawHeight - 2 * padding;
    const midY = padding + h / 2;

    ctx.fillStyle = "rgb(244 248 253)";
    ctx.fillRect(0, 0, drawWidth, drawHeight);

    ctx.strokeStyle = "rgba(100, 111, 133, 0.45)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padding, midY);
    ctx.lineTo(drawWidth - padding, midY);
    ctx.stroke();

    const frameCount = Math.max(1, Math.floor(w));
    const rmsVals = new Float32Array(frameCount);
    let maxRms = 0;
    for (let x = 0; x < frameCount; x++) {
      const start = Math.floor((x / frameCount) * samples.length);
      const end = Math.max(start + 1, Math.floor(((x + 1) / frameCount) * samples.length));
      let sumSq = 0;
      for (let i = start; i < end; i++) {
        const v = samples[i] ?? 0;
        sumSq += v * v;
      }
      const rms = Math.sqrt(sumSq / (end - start));
      rmsVals[x] = rms;
      if (rms > maxRms) maxRms = rms;
    }

    const safeRms = Math.max(maxRms, 1e-3);
    const ampScale = (h * 0.42) / safeRms;

    ctx.strokeStyle = "rgba(72, 94, 142, 0.82)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x < frameCount; x++) {
      const px = padding + x;
      const y = midY - rmsVals[x] * ampScale;
      if (x === 0) ctx.moveTo(px, y);
      else ctx.lineTo(px, y);
    }
    ctx.stroke();

    ctx.strokeStyle = "rgba(72, 94, 142, 0.82)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x < frameCount; x++) {
      const px = padding + x;
      const y = midY + rmsVals[x] * ampScale;
      if (x === 0) ctx.moveTo(px, y);
      else ctx.lineTo(px, y);
    }
    ctx.stroke();
  }, [samples, width, height]);

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
