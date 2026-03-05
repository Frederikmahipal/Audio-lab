"use client";

import { useRef, useState, useEffect } from "react";

interface AudioPlayerProps {
  samples: Float32Array;
  sampleRate: number;
  highCutFrac?: number;
  outputGain?: number;
  className?: string;
}

export function AudioPlayer({
  samples,
  sampleRate,
  highCutFrac = 0,
  outputGain = 1,
  className = "",
}: AudioPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const contextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const filterRef = useRef<BiquadFilterNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const startTimeRef = useRef(0);
  const startOffsetRef = useRef(0);
  const playingDurationRef = useRef(0);
  const rafRef = useRef<number>(0);
  const highCutRef = useRef(highCutFrac);
  const outputGainRef = useRef(outputGain);
  const lastSamplesRef = useRef<Float32Array | null>(null);

  const duration = samples.length > 0 ? samples.length / sampleRate : 0;

  // When samples change while playing (e.g. denoise on/off), switch buffer from current position.
  useEffect(() => {
    if (samples.length === 0) return;
    if (lastSamplesRef.current === samples) return;
    lastSamplesRef.current = samples;
    if (sourceRef.current == null || contextRef.current == null) return;

    const ctx = contextRef.current;
    const newDur = samples.length / sampleRate;
    const elapsed = ctx.currentTime - startTimeRef.current;
    const fromTime = Math.min(Math.max(0, startOffsetRef.current + elapsed), Math.max(0, newDur - 0.001));

    const oldSource = sourceRef.current;
    sourceRef.current = null;
    filterRef.current = null;
    gainRef.current = null;
    try {
      oldSource.stop();
    } catch {
    }
    // Keep RAF running with updated refs.

    const buf = ctx.createBuffer(1, samples.length, sampleRate);
    buf.getChannelData(0).set(samples);
    const src = ctx.createBufferSource();
    const lowPass = ctx.createBiquadFilter();
    const output = ctx.createGain();
    lowPass.type = "lowpass";
    lowPass.Q.value = 0.707;
    lowPass.frequency.value = highCutFracToCutoffHz(highCutRef.current, sampleRate);
    output.gain.value = sanitizeOutputGain(outputGainRef.current);
    src.buffer = buf;
    src.connect(lowPass);
    lowPass.connect(output);
    output.connect(ctx.destination);
    src.onended = () => {
      if (sourceRef.current !== src) return;
      sourceRef.current = null;
      filterRef.current = null;
      gainRef.current = null;
      cancelAnimationFrame(rafRef.current);
      setIsPlaying(false);
      setCurrentTime(newDur);
      playingDurationRef.current = newDur;
    };
    src.start(0, fromTime, newDur - fromTime);
    sourceRef.current = src;
    filterRef.current = lowPass;
    gainRef.current = output;
    startTimeRef.current = ctx.currentTime;
    startOffsetRef.current = fromTime;
    playingDurationRef.current = newDur;
    setCurrentTime(fromTime);
  }, [samples, sampleRate, duration]);

  useEffect(() => {
    highCutRef.current = highCutFrac;
  }, [highCutFrac]);

  useEffect(() => {
    outputGainRef.current = outputGain;
  }, [outputGain]);

  useEffect(() => {
    const ctx = contextRef.current;
    const filter = filterRef.current;
    if (!ctx || !filter) return;
    filter.frequency.setTargetAtTime(
      highCutFracToCutoffHz(highCutFrac, sampleRate),
      ctx.currentTime,
      0.01
    );
  }, [highCutFrac, sampleRate]);

  useEffect(() => {
    const ctx = contextRef.current;
    const gainNode = gainRef.current;
    if (!ctx || !gainNode) return;
    gainNode.gain.setTargetAtTime(
      sanitizeOutputGain(outputGain),
      ctx.currentTime,
      0.01
    );
  }, [outputGain]);

  // Display duration from current samples; processing keeps length stable.
  const effectiveDuration = duration;
  useEffect(() => {
    if (!isPlaying || playingDurationRef.current <= 0) return;

    const tick = () => {
      const ctx = contextRef.current;
      if (!ctx) return;
      const elapsed = ctx.currentTime - startTimeRef.current;
      const pos = startOffsetRef.current + elapsed;
      const end = playingDurationRef.current;
      if (pos >= end) {
        setCurrentTime(end);
        return;
      }
      setCurrentTime(pos);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [isPlaying, duration]);

  function stop() {
    const ctx = contextRef.current;
    if (ctx && playingDurationRef.current > 0) {
      const elapsed = ctx.currentTime - startTimeRef.current;
      const pos = Math.max(
        0,
        Math.min(startOffsetRef.current + elapsed, playingDurationRef.current)
      );
      setCurrentTime(pos);
    }
    const oldSource = sourceRef.current;
    sourceRef.current = null;
    filterRef.current = null;
    gainRef.current = null;
    try {
      oldSource?.stop();
    } catch {
      /* already stopped */
    }
    cancelAnimationFrame(rafRef.current);
    playingDurationRef.current = duration;
    setIsPlaying(false);
  }

  function start(fromTime: number, samplesToPlay?: Float32Array) {
    const s = samplesToPlay ?? samples;
    if (s.length === 0) return;
    const dur = s.length / sampleRate;
    if (dur <= 0) return;

    // Always stop any existing playback first so we never have two sources
    const oldSource = sourceRef.current;
    sourceRef.current = null;
    filterRef.current = null;
    gainRef.current = null;
    try {
      oldSource?.stop();
    } catch {
      /* already stopped */
    }
    cancelAnimationFrame(rafRef.current);

    const ctx = contextRef.current ?? new AudioContext();
    if (!contextRef.current) contextRef.current = ctx;
    if (ctx.state === "suspended") {
      void ctx.resume();
    }

    const buffer = ctx.createBuffer(1, s.length, sampleRate);
    buffer.getChannelData(0).set(s);

    const source = ctx.createBufferSource();
    const lowPass = ctx.createBiquadFilter();
    const output = ctx.createGain();
    lowPass.type = "lowpass";
    lowPass.Q.value = 0.707;
    lowPass.frequency.value = highCutFracToCutoffHz(highCutRef.current, sampleRate);
    output.gain.value = sanitizeOutputGain(outputGainRef.current);
    source.buffer = buffer;
    source.connect(lowPass);
    lowPass.connect(output);
    output.connect(ctx.destination);
    source.onended = () => {
      if (sourceRef.current !== source) return;
      sourceRef.current = null;
      filterRef.current = null;
      gainRef.current = null;
      cancelAnimationFrame(rafRef.current);
      setIsPlaying(false);
      setCurrentTime(dur);
      playingDurationRef.current = dur;
    };

    const startOffset = Math.max(0, Math.min(fromTime, dur - 0.001));
    source.start(0, startOffset, dur - startOffset);
    sourceRef.current = source;
    filterRef.current = lowPass;
    gainRef.current = output;
    startTimeRef.current = ctx.currentTime;
    startOffsetRef.current = startOffset;
    playingDurationRef.current = dur;
    setCurrentTime(startOffset);
    setIsPlaying(true);
  }

  function togglePlay() {
    if (isPlaying) {
      stop();
      return;
    }
    start(currentTime >= effectiveDuration ? 0 : currentTime, samples);
  }

  function handleSeek(e: React.MouseEvent<HTMLDivElement>) {
    if (effectiveDuration <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const t = ratio * effectiveDuration;
    setCurrentTime(t);
    if (isPlaying) {
      try {
        sourceRef.current?.stop();
      } catch {
        /* already stopped */
      }
      sourceRef.current = null;
      start(t, samples);
    }
  }

  const progress = effectiveDuration > 0 ? currentTime / effectiveDuration : 0;

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={togglePlay}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[var(--ui-border)] bg-[var(--ui-surface)] text-[var(--ui-ink)] shadow-sm transition hover:border-[var(--ui-accent)] hover:text-[var(--ui-accent)]"
          aria-label={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? (
            <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
              <rect x="6" y="4" width="4" height="16" rx="1" />
              <rect x="14" y="4" width="4" height="16" rx="1" />
            </svg>
          ) : (
            <svg className="ml-0.5 h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>
        <div
          className="relative h-2.5 flex-1 cursor-pointer rounded-full border border-[var(--ui-border)] bg-[var(--ui-surface)]"
          onClick={handleSeek}
          role="slider"
          aria-label="Playback position"
          aria-valuemin={0}
          aria-valuemax={effectiveDuration}
          aria-valuenow={currentTime}
          tabIndex={0}
          onKeyDown={(e) => {
            if (effectiveDuration <= 0) return;
            if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
              e.preventDefault();
              const step = e.key === "ArrowLeft" ? -0.5 : 0.5;
              const t = Math.max(0, Math.min(effectiveDuration, currentTime + step));
              setCurrentTime(t);
              if (isPlaying) {
                start(t, samples);
              }
            }
          }}
        >
          <div
            className="absolute left-0 top-0 h-full rounded-full bg-[linear-gradient(90deg,var(--ui-accent),var(--ui-accent-2))]"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
      </div>
      <div className="flex justify-between font-mono text-xs text-[var(--ui-muted)]">
        <span>{formatTime(currentTime)}</span>
        <span>{formatTime(effectiveDuration)}</span>
      </div>
    </div>
  );
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function highCutFracToCutoffHz(cutFrac: number, sampleRate: number): number {
  const nyquist = sampleRate / 2;
  const maxHz = Math.max(500, nyquist * 0.98);
  const minHz = 120;
  const clamped = Math.max(0, Math.min(1, cutFrac));
  const t = 1 - clamped;
  return minHz + (maxHz - minHz) * (t * t);
}

function sanitizeOutputGain(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(0.1, Math.min(4, value));
}
