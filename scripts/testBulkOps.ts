// Shared bulk-operation framework. Run: npx tsx scripts/testBulkOps.ts
import { planBulkOps, classifyError, sanitizeLogEntry, runBulkOps, type BulkOp } from "../lib/bulkOps";
import { SleeperGraphQLError } from "../lib/sleeperWrite";

let pass = 0;
let fail = 0;
const ok = (c: unknown, name: string, extra = "") => (c ? pass++ : (fail++, console.log(`  FAIL  ${name} ${extra}`)));

const op = (k: string, league: string, uses: string[] = [], excluded?: string): BulkOp => ({
  opKey: k,
  tool: "mass_add",
  leagueId: league,
  leagueName: `L${league}`,
  action: k,
  uses,
  excluded,
});

// ---- planning: eligibility, duplicates, conflicts
const p = planBulkOps([
  op("a", "1", ["add:x", "drop:y"]),
  op("a", "1", ["add:x", "drop:y"]), // exact duplicate
  op("b", "1", ["add:z", "drop:y"]), // conflicts: drops y again in league 1
  op("c", "2", ["add:z", "drop:y"]), // different league → fine
  op("d", "3", [], "not rostered here"), // ineligible
]);
ok(p.run.map((o) => o.opKey).join() === "a,c", "first wins; duplicate + conflict + ineligible are excluded", p.run.map((o) => o.opKey).join());
ok(p.excluded.length === 3, "every excluded op is reported, none silently dropped");
ok(/duplicate/.test(p.excluded[0].reason) && /conflicts/.test(p.excluded[1].reason) && p.excluded[2].reason === "not rostered here", "each exclusion says why");

// ---- error classification
ok(classifyError(new Error("Request timed out")) === "uncertain", "timeout → uncertain");
ok(classifyError(new TypeError("Failed to fetch")) === "uncertain", "network drop → uncertain");
ok(classifyError(new Error("503 Service Unavailable")) === "uncertain", "5xx gateway → uncertain");
ok(classifyError(new Error("Player is not on waivers")) === "failed", "a clear refusal → failed");

// ---- log sanitizing (server input)
ok(sanitizeLogEntry({ kind: "execute", tool: "mass_add", status: "ok", action: "add X" }) !== null, "a valid entry passes");
ok(sanitizeLogEntry({ kind: "hack", tool: "x", status: "ok", action: "a" }) === null, "unknown kind rejected");
ok(sanitizeLogEntry({ kind: "execute", tool: "x", status: "done!", action: "a" }) === null, "unknown status rejected");
ok((sanitizeLogEntry({ kind: "execute", tool: "x", status: "ok", action: "a".repeat(999) })?.action.length ?? 0) === 300, "long text truncated");

// ---- running: dedup across reloads, uncertain never retried, verification, logging
type Posted = { kind: string; status: string; opKey: string }[];
const posted: Posted = [];
let recent: string[] = [];
(globalThis as { fetch: unknown }).fetch = async (url: string, init?: { method?: string; body?: string }) => {
  if (init?.method === "POST") {
    posted.push(...(JSON.parse(init.body!).entries as Posted));
    return { ok: true, json: async () => ({ saved: 1 }) };
  }
  return { ok: true, json: async () => ({ sent: recent.filter((k) => decodeURIComponent(url).includes(k)) }) };
};

async function main() {
  recent = ["k2"];
  const calls: string[] = [];
  const st: Record<string, string> = {};
  const res = await runBulkOps([op("k1", "1"), op("k2", "1"), op("k3", "2"), op("k4", "3"), op("k5", "4")], {
    concurrency: 1,
    signal: { aborted: false },
    onStatus: (k, s) => (st[k] = s.kind),
    run: async (o) => {
      calls.push(o.opKey);
      if (o.opKey === "k3") throw new Error("Request timed out");
      if (o.opKey === "k4") throw new Error("Roster is full");
      if (o.opKey === "k5") return "claim placed ($3)";
      return "added";
    },
    verify: async (o) => (o.opKey === "k1" ? true : false),
  });
  ok(!calls.includes("k2"), "a change already sent in the last 30 min is NOT sent again (survives reloads)");
  ok(calls.filter((c) => c === "k3").length === 1, "an uncertain outcome is never retried");
  ok(res.done === 2 && res.uncertain === 1 && res.failed === 1 && res.skipped === 1, "counts: done k1+k5, uncertain k3, failed k4, skipped k2", JSON.stringify(res));
  ok(st.k3 === "failed" && st.k2 === "failed", "uncertain / duplicate rows are flagged on screen (not shown as success)");
  const byKey = Object.fromEntries(posted.map((e) => [e.opKey, e.status]));
  ok(byKey.k1 === "ok" && byKey.k3 === "uncertain" && byKey.k4 === "failed" && byKey.k2 === "skipped" && byKey.k5 === "submitted", "every outcome is written to the activity log", JSON.stringify(byKey));
  ok(res.dedupChecked, "the duplicate check ran");

  // verification failure → unverified, never "ok"
  posted.length = 0;
  recent = [];
  const r2 = await runBulkOps([op("v1", "1")], { signal: { aborted: false }, onStatus: () => {}, run: async () => "dropped", verify: async () => false });
  ok(r2.unverified === 1 && posted[0]?.status === "unverified", "a change a re-read doesn't confirm is logged unverified, not ok");

  // partial failure + an expired login: everything after the auth error is NOT sent, and each outcome is still logged
  posted.length = 0;
  const sent3: string[] = [];
  const r3 = await runBulkOps([op("a1", "1"), op("a2", "2"), op("a3", "3"), op("a4", "4")], {
    concurrency: 1,
    signal: { aborted: false },
    onStatus: () => {},
    run: async (o) => {
      sent3.push(o.opKey);
      if (o.opKey === "a1") throw new Error("Player is not on waivers");
      if (o.opKey === "a2") throw new SleeperGraphQLError([{ code: "unauthorized", message: "token expired" }]);
      return "added";
    },
  });
  ok(r3.stoppedForAuth && !sent3.includes("a3") && !sent3.includes("a4"), "an expired login stops the batch — nothing after it is sent", sent3.join());
  ok(r3.failed === 2 && r3.done === 0 && r3.skipped === 2, "partial failure counts: 2 failed, 2 not run", JSON.stringify(r3));
  ok(posted.filter((e) => e.status === "failed").length === 2 && posted.filter((e) => e.status === "skipped").length === 2, "failed and not-run ops are both in the activity log");

  // duplicate guard unavailable (activity log unreachable): still runs, but reports the check didn't happen
  const realFetch = (globalThis as { fetch: unknown }).fetch;
  (globalThis as { fetch: unknown }).fetch = async (_u: string, init?: { method?: string }) => (init?.method === "POST" ? { ok: true, json: async () => ({}) } : { ok: false, json: async () => ({}) });
  const r4 = await runBulkOps([op("d1", "1")], { signal: { aborted: false }, onStatus: () => {}, run: async () => "added" });
  ok(r4.done === 1 && !r4.dedupChecked, "when the duplicate check can't run, the result says so (dedupChecked=false)");
  (globalThis as { fetch: unknown }).fetch = realFetch;

  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main();
