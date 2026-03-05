import Link from "next/link";

interface AppTopNavProps {
  active: "capture" | "analyze";
}

export function AppTopNav({ active }: AppTopNavProps) {
  return (
    <div className="mx-auto flex w-full max-w-6xl justify-center px-4 pt-4 sm:px-6">
      <nav className="inline-flex items-center gap-1 rounded-full border border-[var(--ui-border)] bg-[var(--ui-surface)] p-1 shadow-sm">
        <Link
          href="/"
          className={`rounded-full px-4 py-1.5 text-sm transition ${
            active === "capture"
              ? "bg-[var(--ui-accent)] text-white"
              : "text-[var(--ui-muted)] hover:text-[var(--ui-ink)]"
          }`}
        >
          Capture
        </Link>
        <Link
          href="/analyze"
          className={`rounded-full px-4 py-1.5 text-sm transition ${
            active === "analyze"
              ? "bg-[var(--ui-accent)] text-white"
              : "text-[var(--ui-muted)] hover:text-[var(--ui-ink)]"
          }`}
        >
          Analyze
        </Link>
      </nav>
    </div>
  );
}
