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

    canvas.width = width;
    canvas.height = height;

    const padding = 2;
    const w = width - 2 * padding;
    const h = height - 2 * padding;
    const midY = padding + h / 2;

    ctx.fillStyle = "rgb(250 250 250)";
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = "rgb(24 24 27)";
    ctx.lineWidth = 1;
    ctx.beginPath();

    const step = Math.max(1, Math.floor(samples.length / w));
    for (let x = 0; x < w; x++) {
      const i = Math.min(Math.floor((x / w) * samples.length), samples.length - 1);
      const y = midY - (samples[i] ?? 0) * (h / 2);
      if (x === 0) ctx.moveTo(padding + x, y);
      else ctx.lineTo(padding + x, y);
    }

    ctx.stroke();
  }, [samples, width, height]);

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
