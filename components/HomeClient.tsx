"use client";

import { AudioInput } from "./AudioInput";
import { TestSignalGenerator } from "./TestSignalGenerator";

export function HomeClient() {
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
      <AudioInput />
      <div className="mt-6">
        <TestSignalGenerator />
      </div>
    </section>
  );
}
