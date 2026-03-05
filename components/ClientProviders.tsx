"use client";

import { AudioLabProvider } from "@/context/AudioLabContext";
import type { ReactNode } from "react";

export function ClientProviders({ children }: { children: ReactNode }) {
  return <AudioLabProvider>{children}</AudioLabProvider>;
}
