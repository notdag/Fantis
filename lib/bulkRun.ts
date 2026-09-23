// Runs a user-approved list of Sleeper writes with a small amount of
// concurrency. Deliberately conservative, because these are real,
// non-idempotent writes against an undocumented private API:
//  - never retries on its own (a retry of a "succeeded but response lost"
//    write could double-apply); the UI offers a manual "retry failed".
//  - low concurrency plus a short gap between calls (Sleeper's rate limits
//    on this endpoint are unknown).
//  - a fatal auth error (expired/invalid token) stops the whole run instead
//    of failing every remaining row one by one.
//  - Abort leaves already-finished rows as they are and skips the rest.
import { SleeperGraphQLError } from "@/lib/sleeperWrite";

export type TaskStatus =
  | { kind: "queued" }
  | { kind: "running" }
  | { kind: "done"; note?: string }
  | { kind: "failed"; message: string }
  | { kind: "skipped"; reason: string };

export interface BulkTask {
  key: string;
  run: () => Promise<string | void>; // resolve with an optional note ("claimed as waiver")
}

export function isAuthError(e: unknown): boolean {
  if (e instanceof SleeperGraphQLError) {
    return e.errors.some((x) => x.code === "unauthorized" || /unauthori[sz]ed|expired|not logged in/i.test(x.message ?? ""));
  }
  return false;
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export async function runBulk(
  tasks: BulkTask[],
  opts: {
    concurrency?: number;
    gapMs?: number;
    signal: { aborted: boolean };
    onStatus: (key: string, status: TaskStatus) => void;
  }
): Promise<{ done: number; failed: number; skipped: number; stoppedForAuth: boolean }> {
  const concurrency = opts.concurrency ?? 3;
  const gapMs = opts.gapMs ?? 150;
  let next = 0;
  let done = 0;
  let failed = 0;
  let skipped = 0;
  let stoppedForAuth = false;

  for (const t of tasks) opts.onStatus(t.key, { kind: "queued" });

  async function worker() {
    while (true) {
      const i = next++;
      if (i >= tasks.length) return;
      const task = tasks[i];
      if (opts.signal.aborted || stoppedForAuth) {
        skipped += 1;
        opts.onStatus(task.key, {
          kind: "skipped",
          reason: stoppedForAuth ? "Stopped: Sleeper rejected the login token" : "Aborted",
        });
        continue;
      }
      opts.onStatus(task.key, { kind: "running" });
      try {
        const note = await task.run();
        done += 1;
        opts.onStatus(task.key, { kind: "done", note: note || undefined });
      } catch (e) {
        failed += 1;
        if (isAuthError(e)) stoppedForAuth = true;
        opts.onStatus(task.key, { kind: "failed", message: errorMessage(e) });
      }
      if (gapMs > 0) await new Promise((r) => setTimeout(r, gapMs));
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  return { done, failed, skipped, stoppedForAuth };
}
