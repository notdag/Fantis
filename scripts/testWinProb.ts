// Win chance formula. Run: npx tsx scripts/testWinProb.ts
import { normalCdf, outlook, winProb } from "../lib/winProb";

let pass = 0;
let fail = 0;
const ok = (c: unknown, name: string, extra = "") => (c ? pass++ : (fail++, console.log(`  FAIL  ${name} ${extra}`)));
const near = (a: number, b: number, tol = 0.005) => Math.abs(a - b) <= tol;

ok(near(normalCdf(0), 0.5), "Φ(0) = 0.5");
ok(near(normalCdf(1), 0.8413), "Φ(1) ≈ 0.841");
ok(near(normalCdf(-1.96), 0.025), "Φ(−1.96) ≈ 0.025");
ok(near(winProb(120, 120)!, 0.5), "equal projections → 50%");
const p = winProb(130, 120)!;
ok(p > 0.6 && p < 0.7, "10-point edge at ~125 → about 62%", String(p));
ok(near(winProb(130, 120)! + winProb(120, 130)!, 1), "symmetric: both sides add to 100%");
ok(winProb(160, 100)! > 0.9, "a 60-point edge is a near-lock");
ok(winProb(0, 120) === null && winProb(null, 120) === null && winProb(120, undefined) === null, "missing/zero projection → no number, never a fake 50%");
ok(outlook(0.65) === "favorite" && outlook(0.5) === "toss-up" && outlook(0.3) === "underdog", "favorite / toss-up / underdog thresholds");

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
