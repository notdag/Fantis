// Server-side sync of FantasyCalc data into Postgres. SERVER ONLY.
//
// FantasyCalc's API docs (fantasycalc.com/api-docs) set the rules this follows:
//   • ONLY the two documented endpoints are ever called: GET /players and
//     GET /values/current. Anything else risks a permanent IP ban — never add another.
//   • /values/current: cache, refresh at most once per hour (per format).
//   • /players: cache, refresh at most once per day.
//   • Any place this data is shown needs a visible attribution + link to fantasycalc.com.
// The hour/day limits are enforced in the DATABASE (FantasyCalcFetch), not in memory,
// because serverless instances don't share memory: an attempt is "claimed" atomically
// before the request, and failures back off for the same interval as successes.
import { db } from "./db";
import { formatKey, leagueFormat, parseFormatKey, valuesQuery, type FcFormat } from "./fantasyCalcFormat";

const BASE = "https://api.fantasycalc.com";
export const VALUES_MAX_AGE_MS = 60 * 60 * 1000; // their limit: at most hourly
export const PLAYERS_MAX_AGE_MS = 24 * 60 * 60 * 1000; // their limit: at most daily
const HEADERS = { accept: "application/json", "user-agent": "Fantis/1.0 (personal fantasy-football tool; fantasycalc.com data, attributed)" };

interface FcPlayerJson {
  id?: number;
  name?: string;
  position?: string;
  maybeTeam?: string | null;
  maybeAge?: number | null;
  maybeBirthday?: string | null;
  maybeCollege?: string | null;
  maybeDraftInfo?: unknown;
  sleeperId?: string | null;
  mflId?: string | null;
  espnId?: string | null;
  fleaflickerId?: string | null;
}
interface FcValueJson {
  player?: FcPlayerJson;
  value?: number;
  overallRank?: number;
  positionRank?: number;
  trend30Day?: number | null;
  starter?: boolean;
  redraftValue?: number | null;
  combinedValue?: number | null;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

// Take the right to call FantasyCalc for `key`, or refuse. Atomic in the DB so two
// requests at once can't both fire.
async function claim(key: string, maxAgeMs: number): Promise<boolean> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - maxAgeMs);
  const existing = await db.fantasyCalcFetch.findUnique({ where: { key } });
  if (!existing) {
    try {
      await db.fantasyCalcFetch.create({ data: { key, fetchedAt: now, ok: false, count: 0, error: "in progress" } });
      return true;
    } catch {
      return false; // someone else created it a moment ago
    }
  }
  const r = await db.fantasyCalcFetch.updateMany({ where: { key, fetchedAt: { lt: cutoff } }, data: { fetchedAt: now, ok: false, error: "in progress" } });
  return r.count === 1;
}

const finish = (key: string, ok: boolean, count: number, error?: string) =>
  db.fantasyCalcFetch.update({ where: { key }, data: { ok, count, error: error ?? null } });

async function getJson(path: string): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, { headers: HEADERS, cache: "no-store" });
  if (!res.ok) throw new Error(`FantasyCalc returned ${res.status}`);
  return res.json();
}

export type RefreshResult = { key: string; status: "refreshed" | "fresh" | "failed"; count?: number; error?: string };

export async function refreshPlayers(): Promise<RefreshResult> {
  if (!(await claim("players", PLAYERS_MAX_AGE_MS))) return { key: "players", status: "fresh" };
  try {
    const json = (await getJson("/players")) as FcPlayerJson[];
    if (!Array.isArray(json)) throw new Error("unexpected response shape");
    const rows = json
      .filter((p) => typeof p.id === "number" && str(p.name) && str(p.position))
      .map((p) => ({
        fcId: p.id as number,
        name: str(p.name) as string,
        position: str(p.position) as string,
        team: str(p.maybeTeam),
        age: num(p.maybeAge),
        birthday: str(p.maybeBirthday),
        college: str(p.maybeCollege),
        draftInfo: p.maybeDraftInfo && typeof p.maybeDraftInfo === "object" ? (p.maybeDraftInfo as object) : undefined,
        sleeperId: str(p.sleeperId),
        mflId: str(p.mflId),
        espnId: str(p.espnId),
        fleaflickerId: str(p.fleaflickerId),
      }));
    if (rows.length === 0) throw new Error("no players returned");
    await db.$transaction([db.fantasyCalcPlayer.deleteMany({}), db.fantasyCalcPlayer.createMany({ data: rows })]);
    await finish("players", true, rows.length);
    return { key: "players", status: "refreshed", count: rows.length };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await finish("players", false, 0, error).catch(() => undefined);
    return { key: "players", status: "failed", error };
  }
}

export async function refreshValues(fmt: FcFormat): Promise<RefreshResult> {
  const key = formatKey(fmt);
  if (!(await claim(key, VALUES_MAX_AGE_MS))) return { key, status: "fresh" };
  try {
    const json = (await getJson(`/values/current?${valuesQuery(fmt)}`)) as FcValueJson[];
    if (!Array.isArray(json)) throw new Error("unexpected response shape");
    const seen = new Set<number>();
    const rows = [];
    for (const e of json) {
      const p = e.player;
      const value = num(e.value);
      const fcId = typeof p?.id === "number" ? p.id : null;
      if (!p || fcId == null || !str(p.name) || !str(p.position) || value == null || seen.has(fcId)) continue;
      seen.add(fcId);
      rows.push({
        formatKey: key,
        fcId,
        sleeperId: str(p.sleeperId),
        name: str(p.name) as string,
        position: str(p.position) as string,
        team: str(p.maybeTeam),
        value: Math.round(value),
        overallRank: Math.round(num(e.overallRank) ?? 0),
        positionRank: Math.round(num(e.positionRank) ?? 0),
        trend30Day: num(e.trend30Day) == null ? null : Math.round(num(e.trend30Day) as number),
        starter: e.starter === true,
        redraftValue: num(e.redraftValue) == null ? null : Math.round(num(e.redraftValue) as number),
        combinedValue: num(e.combinedValue) == null ? null : Math.round(num(e.combinedValue) as number),
      });
    }
    if (rows.length === 0) throw new Error("no values returned");
    // Full replace in one transaction — readers never see a half-written format.
    await db.$transaction([db.fantasyCalcValue.deleteMany({ where: { formatKey: key } }), db.fantasyCalcValue.createMany({ data: rows })]);
    await finish(key, true, rows.length);
    return { key, status: "refreshed", count: rows.length };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await finish(key, false, 0, error).catch(() => undefined);
    return { key, status: "failed", error };
  }
}

// Every distinct format the owner's leagues use, and which league uses which.
export async function leagueFormats(): Promise<{ byLeague: Record<string, string>; keys: string[] }> {
  const rows = await db.league.findMany({ select: { id: true, settings: true, totalRosters: true } });
  const byLeague: Record<string, string> = {};
  for (const r of rows) byLeague[r.id] = formatKey(leagueFormat(r.settings, r.totalRosters));
  return { byLeague, keys: [...new Set(Object.values(byLeague))] };
}

// Refresh whatever is due, politely: sequential with a pause between real calls.
export async function ensureFresh(keys: string[], opts: { players?: boolean } = {}): Promise<RefreshResult[]> {
  const out: RefreshResult[] = [];
  const pause = () => new Promise((r) => setTimeout(r, 1000));
  if (opts.players !== false) {
    const p = await refreshPlayers();
    out.push(p);
    if (p.status !== "fresh") await pause();
  }
  for (const key of keys) {
    const fmt = parseFormatKey(key);
    if (!fmt) continue; // never build a request from anything but a validated format
    const r = await refreshValues(fmt);
    out.push(r);
    if (r.status !== "fresh") await pause();
  }
  return out;
}
