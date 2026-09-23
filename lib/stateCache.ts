import { getState } from "@/lib/sleeper";
import type { SleeperState } from "@/lib/types";

// Sleeper's current-week state changes at most once a day, but every
// /manager page load used to make its own live call for it. Keep the last
// answer in memory for a minute on the server (warm serverless instances
// reuse it), and fall back to the last known value if Sleeper is slow or
// down rather than failing the page.
let cached: { at: number; value: SleeperState } | null = null;
const TTL_MS = 60_000;

export async function getStateCached(): Promise<SleeperState | null> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;
  try {
    const value = await getState();
    cached = { at: Date.now(), value };
    return value;
  } catch {
    return cached?.value ?? null;
  }
}
