"use client";

import { useState } from "react";
import { useAudioLab } from "@/context/AudioLabContext";
import { buildTestSignal, type SignalType } from "@/lib/dsp/signals";

const SAMPLE_RATE = 16000;

const SIGNAL_OPTIONS: { value: SignalType; label: string }[] = [
  {
    value: "harmonic_sweep",
    label: "Rising tone sweep",
  },
  {
    value: "step_pattern",
    label: "Stepped notes",
  },
];

export function TestSignalGenerator() {
  const { setAudio } = useAudioLab();
  const [signalType, setSignalType] = useState<SignalType>("harmonic_sweep");
  const [duration, setDuration] = useState(5);

  function handleGenerate() {
    const samples = buildTestSignal(signalType, {
      sampleRate: SAMPLE_RATE,
      durationSeconds: duration,
    });
    setAudio({
      samples,
      sampleRate: SAMPLE_RATE,
      durationSeconds: samples.length / SAMPLE_RATE,
    });
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="rounded-lg border border-[var(--ui-border)] bg-[var(--ui-surface)] px-3 py-2">
          <span className="block text-[11px] uppercase tracking-[0.11em] text-[var(--ui-muted)]">
            Demo signal
          </span>
          <select
            value={signalType}
            onChange={(e) => setSignalType(e.target.value as SignalType)}
            className="mt-1 w-full bg-transparent text-sm text-[var(--ui-ink)] outline-none"
          >
            {SIGNAL_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        <label className="rounded-lg border border-[var(--ui-border)] bg-[var(--ui-surface)] px-3 py-2">
          <span className="block text-[11px] uppercase tracking-[0.11em] text-[var(--ui-muted)]">
            Duration (seconds)
          </span>
          <input
            type="number"
            min={0.5}
            max={30}
            step={0.5}
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
            className="mt-1 w-full bg-transparent text-sm text-[var(--ui-ink)] outline-none"
          />
        </label>
      </div>

      <button
        type="button"
        onClick={handleGenerate}
        className="rounded-md bg-[var(--ui-accent)] px-3.5 py-2 text-sm font-semibold text-white transition hover:brightness-105"
      >
        Generate Signal
      </button>
    </div>
  );
}
