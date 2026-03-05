"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";

export interface AudioState {
  samples: Float32Array;
  sampleRate: number;
  durationSeconds: number;
}

interface AudioLabContextValue {
  audio: AudioState | null;
  setAudio: (state: AudioState) => void;
  clearAudio: () => void;
}

const AudioLabContext = createContext<AudioLabContextValue | null>(null);

export function AudioLabProvider({ children }: { children: ReactNode }) {
  const [audio, setAudioState] = useState<AudioState | null>(null);

  const setAudio = useCallback((state: AudioState) => {
    setAudioState(state);
  }, []);

  const clearAudio = useCallback(() => {
    setAudioState(null);
  }, []);

  return (
    <AudioLabContext.Provider value={{ audio, setAudio, clearAudio }}>
      {children}
    </AudioLabContext.Provider>
  );
}

export function useAudioLab() {
  const ctx = useContext(AudioLabContext);
  if (!ctx) throw new Error("useAudioLab must be used within AudioLabProvider");
  return ctx;
}
