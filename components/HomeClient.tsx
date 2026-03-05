"use client";

import { AudioInput } from "./AudioInput";
import { TestSignalGenerator } from "./TestSignalGenerator";

export function HomeClient() {
  return (
    <section className="panel p-5 sm:p-6">
      <h2 className="text-lg font-semibold">Load Clip</h2>
      <div className="mt-4">
        <AudioInput />
      </div>

      <details className="mt-4 rounded-lg border border-[var(--ui-border)] bg-[var(--ui-surface-strong)] p-3">
        <summary className="cursor-pointer text-sm font-medium text-[var(--ui-ink)]">
          Generate test signal (optional)
        </summary>
        <div className="mt-3">
          <TestSignalGenerator />
        </div>
      </details>
    </section>
  );
}
