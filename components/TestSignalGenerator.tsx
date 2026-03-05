"use client";

import { useState } from "react";
import { useAudioLab } from "@/context/AudioLabContext";
import {
  buildTestSignal,
  type SignalType,
} from "@/lib/dsp/signals";

const SAMPLE_RATE = 16000;

const SIGNAL_OPTIONS: { value: SignalType; label: string }[] = [
  { value: "sine", label: "Sine tone (440 Hz)" },
  { value: "chirp", label: "Chirp (200 → 4000 Hz sweep)" },
  { value: "tone_plus_noise", label: "Tone + white noise" },
  { value: "am_tone", label: "Amplitude-modulated tone (440 Hz)" },
];

export function TestSignalGenerator() {
  const { setAudio } = useAudioLab();
  const [signalType, setSignalType] = useState<SignalType>("sine");
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
    <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-zinc-50/50 p-4 dark:border-zinc-700 dark:bg-zinc-800/50">
      <h3 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
        Generate test signal
      </h3>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Reproducible synthetic signals for debugging spectrogram and MFCC (16 kHz).
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-zinc-500 dark:text-zinc-400">Type</span>
          <select
            value={signalType}
            onChange={(e) => setSignalType(e.target.value as SignalType)}
            className="rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
          >
            {SIGNAL_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            Duration (s)
          </span>
          <input
            type="number"
            min={0.5}
            max={30}
            step={0.5}
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
            className="w-20 rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
          />
        </label>
        <button
          type="button"
          onClick={handleGenerate}
          className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500"
        >
          Generate
        </button>
      </div>
    </div>
  );
}
