// Pure helpers behind the /admin tier board's "Needs ranking" panel, injury
// badges, and team-drift sync (components/TierBoard.tsx). No React, no I/O —
// everything takes the Sleeper player map and the current board as plain
// arguments so scripts/testRankingsHelpers.ts can exercise it directly.
import type { PlayerMap, PlayerMapEntry } from "./types";

// Local copy of lib/playerIdMap.ts's stripSuffix: that module is a "use
// client" hook file (imports react), not something a pure helper should drag
// in. One regex; kept identical on purpose.
const stripSuffix = (name: string) => name.replace(/\s+(Jr\.?|Sr\.?|II|III|IV)$/i, "").trim();

export const RANKABLE_POSITIONS = ["QB", "RB", "WR", "TE"] as const;

// Sleeper's `injury_status` values that mean "hurt" — suspension ("Sus") is a
// real status too but isn't an injury, so it's deliberately not here.
// Ordered worst-first: this is also the sort order used for severity.
export const INJURY_ORDER = ["IR", "PUP", "Out", "DNR", "Doubtful", "Questionable"] as const;

export function isInjured(inj: string | null | undefined): boolean {
  return !!inj && (INJURY_ORDER as readonly string[]).includes(inj);
}

// Lower = worse. Unknown/healthy sorts last.
export function injurySeverity(inj: string | null | undefined): number {
  const i = inj ? (INJURY_ORDER as readonly string[]).indexOf(inj) : -1;
  return i === -1 ? INJURY_ORDER.length : i;
}

interface BoardPlayer {
  name: string;
  pos: string;
  team: string;
}

const normName = (n: string) => stripSuffix(n).toLowerCase();

// Forgiving name key for pasted text: case, punctuation ("St." vs "St",
// "Ja'Marr" vs "JaMarr" via apostrophe removal, hyphens → spaces) and
// Jr/Sr/II/III don't matter.
export function looseKey(n: string): string {
  return n
    .toLowerCase()
    .replace(/[.'’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+(jr|sr|ii|iii|iv|v)$/, "")
    .trim();
}

// Common first-name variants, so "Kenneth Gainwell" finds Sleeper's "Kenny
// Gainwell" (and Mike/Michael, Josh/Joshua …). Used ONLY as a fallback after an
// exact name match fails, and a fuzzy match is accepted only when it is unique
// (and the position agrees when one is given) — otherwise it is left unmatched.
const NICK_GROUPS = [
  ["kenneth", "kenny", "ken"], ["michael", "mike"], ["joshua", "josh"], ["matthew", "matt"],
  ["christopher", "chris"], ["anthony", "tony"], ["william", "will", "bill", "billy"],
  ["robert", "rob", "bob", "bobby"], ["richard", "rich", "rick", "ricky"], ["jonathan", "jon", "jonny"],
  ["nicholas", "nick"], ["alexander", "alex"], ["benjamin", "ben"], ["daniel", "dan", "danny"],
  ["joseph", "joe", "joey"], ["thomas", "tom", "tommy"], ["timothy", "tim"], ["zachary", "zach", "zack"],
  ["jeffrey", "jeff"], ["samuel", "sam"], ["theodore", "theo", "ted"], ["andrew", "andy", "drew"],
  ["gabriel", "gabe"], ["cameron", "cam"], ["jerome", "jerry"], ["gregory", "greg"], ["patrick", "pat"],
  ["david", "dave"], ["james", "jim", "jimmy"], ["donald", "don"], ["charles", "charlie", "chuck"],
  ["edward", "ed", "eddie"], ["frederick", "fred", "freddie"], ["lawrence", "larry"], ["raymond", "ray"],
];
const NICK_ROOT = new Map<string, string>();
for (const g of NICK_GROUPS) for (const n of g) NICK_ROOT.set(n, g[0]);

export function fuzzyKey(n: string): string {
  const parts = looseKey(n).split(" ");
  if (parts.length < 2) return parts.join(" ");
  return [NICK_ROOT.get(parts[0]) ?? parts[0], ...parts.slice(1)].join(" ");
}

// name|pos → Sleeper entry, with the same suffix-stripped fallback the rest of
// the app uses ("Brian Thomas" vs "Brian Thomas Jr."). When Sleeper's ~11k
// dump holds several entries with one name+position (retired/inactive
// namesakes), prefer the one that's currently on a team — that's the one that
// has live injury data.
export function buildSleeperIndex(pmap: PlayerMap) {
  const exact = new Map<string, { id: string; e: PlayerMapEntry }>();
  const base = new Map<string, { id: string; e: PlayerMapEntry }>();
  const put = (m: Map<string, { id: string; e: PlayerMapEntry }>, key: string, id: string, e: PlayerMapEntry) => {
    const cur = m.get(key);
    if (!cur || (!cur.e.t && e.t)) m.set(key, { id, e });
  };
  for (const id in pmap) {
    const e = pmap[id];
    put(exact, `${e.n}|${e.p}`, id, e);
    put(base, `${normName(e.n)}|${e.p}`, id, e);
  }
  // Name-only candidates (current NFL QB/RB/WR/TE only) for matching a pasted
  // list that has no position column. >1 entry = a real namesake collision.
  const byLooseName = new Map<string, { id: string; e: PlayerMapEntry }[]>();
  for (const id in pmap) {
    const e = pmap[id];
    if (!e.t || !(RANKABLE_POSITIONS as readonly string[]).includes(e.p)) continue;
    const k = looseKey(e.n);
    (byLooseName.get(k) ?? byLooseName.set(k, []).get(k)!).push({ id, e });
  }
  const byFuzzyName = new Map<string, { id: string; e: PlayerMapEntry }[]>();
  for (const id in pmap) {
    const e = pmap[id];
    if (!e.t || !(RANKABLE_POSITIONS as readonly string[]).includes(e.p)) continue;
    const k = fuzzyKey(e.n);
    (byFuzzyName.get(k) ?? byFuzzyName.set(k, []).get(k)!).push({ id, e });
  }
  return {
    candidatesByFuzzyName(name: string): { id: string; e: PlayerMapEntry }[] {
      return byFuzzyName.get(fuzzyKey(name)) ?? [];
    },
    candidatesByName(name: string): { id: string; e: PlayerMapEntry }[] {
      return byLooseName.get(looseKey(name)) ?? [];
    },
    lookup(p: { name: string; pos: string }): { id: string; e: PlayerMapEntry } | null {
      return exact.get(`${p.name}|${p.pos}`) ?? base.get(`${normName(p.name)}|${p.pos}`) ?? null;
    },
  };
}

export interface UnrankedCandidate {
  id: string; // Sleeper player_id
  name: string;
  pos: string;
  team: string;
  inj: string | null;
  leagues: number; // how many of the owner's in-season leagues roster him
}

// Offensive players the owner actually has to make decisions about but who
// aren't on the board yet. "Relevant" means rostered in at least `minLeagues`
// of the owner's own leagues (exposure comes from the synced Roster table) —
// without that filter, "every injured QB/RB/WR/TE in the NFL" is several
// hundred irrelevant names. Sorted most-rostered first, so the injured
// player sitting on 40 of your teams outranks a deep reserve on one.
export function findUnranked(
  pmap: PlayerMap,
  board: BoardPlayer[],
  exposure: Record<string, number>,
  minLeagues = 1
): UnrankedCandidate[] {
  // A candidate counts as already ranked if ANY board player shares his
  // suffix-insensitive name — slightly over-excludes a same-name namesake at
  // another position, which is the safe direction (the board keys cards by
  // name, so adding a second "same name" card would collide anyway).
  const ranked = new Set(board.map((p) => normName(p.name)));
  const out: UnrankedCandidate[] = [];
  for (const id in exposure) {
    const leagues = exposure[id];
    if (leagues < minLeagues) continue;
    const e = pmap[id];
    if (!e || !e.t) continue; // not on an NFL team right now
    if (!(RANKABLE_POSITIONS as readonly string[]).includes(e.p)) continue;
    if (ranked.has(normName(e.n))) continue;
    out.push({ id, name: e.n, pos: e.p, team: e.t, inj: e.inj ?? null, leagues });
  }
  out.sort((a, b) => b.leagues - a.leagues || a.name.localeCompare(b.name));
  return out;
}

export interface TeamDrift {
  name: string;
  pos: string;
  from: string; // team on the board
  to: string; // team on Sleeper now ("" = no team: released / retired)
}

// Ranked players whose team no longer matches Sleeper's. The board's team
// text is hand-maintained (and was seeded from a past dump), so trades and
// releases silently make it stale — nothing else in the app would ever flag
// it. Only reports players Sleeper can actually identify.
export function findTeamDrift(index: ReturnType<typeof buildSleeperIndex>, board: BoardPlayer[]): TeamDrift[] {
  const out: TeamDrift[] = [];
  for (const p of board) {
    const hit = index.lookup(p);
    if (!hit) continue;
    if (hit.e.t.toUpperCase() !== p.team.toUpperCase()) {
      out.push({ name: p.name, pos: p.pos, from: p.team, to: hit.e.t });
    }
  }
  return out;
}

// ── Auto-sort a tier by ADP ──
// Reorders ONE tier's players by Sleeper ADP (lower = drafted earlier).
// Players with no ranked ADP keep their current relative order after every
// player that has one — never shuffled randomly, never dropped. Stable.
export function sortByAdp<T extends { name: string }>(players: T[], adpOf: (p: T) => number | undefined): T[] {
  const keyed = players.map((p, i) => ({ p, i, adp: adpOf(p) }));
  keyed.sort((a, b) => {
    const A = a.adp === undefined ? Infinity : a.adp;
    const B = b.adp === undefined ? Infinity : b.adp;
    if (A !== B) return A < B ? -1 : 1;
    return a.i - b.i;
  });
  return keyed.map((k) => k.p);
}

// ── Save history (browser-local snapshots of the board) ──
export interface RankSnapshot {
  at: string; // ISO time the snapshot was taken (= when the save replaced it)
  players: { name: string; pos: string; team: string; tier: number }[];
}
export const HISTORY_LIMIT = 20;

const snapSig = (s: RankSnapshot["players"]) => s.map((p) => `${p.tier}|${p.name}|${p.pos}|${p.team}`).join(";");

// Newest first, capped, and a snapshot identical to the newest is skipped
// (saving twice with no changes shouldn't burn a history slot).
export function pushSnapshot(history: RankSnapshot[], snap: RankSnapshot): RankSnapshot[] {
  if (snap.players.length === 0) return history;
  if (history[0] && snapSig(history[0].players) === snapSig(snap.players)) return history;
  return [snap, ...history].slice(0, HISTORY_LIMIT);
}

// Defensive parse of whatever is in localStorage — never trust it.
export function parseHistory(raw: string | null): RankSnapshot[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v
      .filter(
        (s) =>
          s &&
          typeof s.at === "string" &&
          Array.isArray(s.players) &&
          s.players.every(
            (p: unknown) =>
              !!p && typeof (p as { name?: unknown }).name === "string" && typeof (p as { tier?: unknown }).tier === "number"
          )
      )
      .slice(0, HISTORY_LIMIT);
  } catch {
    return [];
  }
}



// ── Paste-in rank list ──
// The owner pastes their own ordered list (from their notes, a spreadsheet,
// another site — they do the copying; nothing is fetched). Accepts one name
// per line, optionally numbered ("1.", "2)", "#3", "4 -"), or CSV/TSV rows
// ("1,Ja'Marr Chase,WR,CIN"), with trailing position/team tokens tolerated.
export interface PastedMatch {
  raw: string;
  status: "board" | "add" | "ambiguous" | "unmatched";
  name?: string; // board name (status "board") or Sleeper name (status "add")
  pos?: string;
  team?: string;
  note?: string;
  fuzzy?: boolean; // matched via a first-name variant (Kenneth → Kenny)
}

const LEADING_RANK = /^\s*(?:#\s*)?\d{1,4}\s*(?:[.):\-–—]\s*|\s+(?=[A-Za-z]))/;

export function parsePastedLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^tier\b/i.test(l) && !/^[-=#*]+$/.test(l));
}

export function matchPastedList(
  text: string,
  board: { name: string; pos: string; team: string }[],
  index: ReturnType<typeof buildSleeperIndex>
): PastedMatch[] {
  const boardByKey = new Map<string, { name: string; pos: string }[]>();
  for (const p of board) {
    const k = looseKey(p.name);
    (boardByKey.get(k) ?? boardByKey.set(k, []).get(k)!).push(p);
  }

  const resolve = (candidate: string): PastedMatch | null => {
    const k = looseKey(candidate);
    if (!k) return null;
    const onBoard = boardByKey.get(k);
    if (onBoard) {
      return onBoard.length === 1
        ? { raw: "", status: "board", name: onBoard[0].name, pos: onBoard[0].pos }
        : { raw: "", status: "ambiguous", note: "two players with that name are on your board" };
    }
    const c = index.candidatesByName(candidate);
    if (c.length === 1) return { raw: "", status: "add", name: c[0].e.n, pos: c[0].e.p, team: c[0].e.t };
    if (c.length > 1) return { raw: "", status: "ambiguous", note: c.map((x) => `${x.e.p} ${x.e.t}`).join(" or ") };
    // Fallback: first-name variants (unique only).
    const fk = fuzzyKey(candidate);
    const fb = board.filter((p) => fuzzyKey(p.name) === fk);
    if (fb.length === 1) return { raw: "", status: "board", name: fb[0].name, pos: fb[0].pos, fuzzy: true, note: `matched as ${fb[0].name}` };
    const fc = index.candidatesByFuzzyName(candidate);
    if (fb.length === 0 && fc.length === 1) return { raw: "", status: "add", name: fc[0].e.n, pos: fc[0].e.p, team: fc[0].e.t, fuzzy: true, note: `matched as ${fc[0].e.n}` };
    return null;
  };

  const out: PastedMatch[] = [];
  const seen = new Set<string>();
  for (const raw of parsePastedLines(text)) {
    // Each delimited field is a candidate (CSV rows); within one, peel
    // leading rank numbers, then trailing POS/TEAM tokens until a match.
    const fields = raw.split(/[\t,|]/).map((f) => f.trim()).filter((f) => /[A-Za-z]{2}/.test(f));
    let hit: PastedMatch | null = null;
    for (const f of fields) {
      const tokens = f.replace(LEADING_RANK, "").trim().split(/\s+/);
      for (let drop = 0; drop <= 2 && tokens.length - drop >= 2 && !hit; drop++) {
        hit = resolve(tokens.slice(0, tokens.length - drop).join(" "));
      }
      if (hit) break;
    }
    const m: PastedMatch = hit ? { ...hit, raw } : { raw, status: "unmatched", note: "no player with that name" };
    // The same player twice: keep the first (higher) placement.
    const key = m.name ? looseKey(m.name) : "";
    if (key && seen.has(key)) {
      out.push({ raw, status: "unmatched", note: "duplicate of an earlier line" });
      continue;
    }
    if (key) seen.add(key);
    out.push(m);
  }
  return out;
}

// ── Pasted TABLE with a header row (Rank, Name, Team, Position, Tier, Expert Rank, Mason Rank) ──
// Used when the first line looks like a header. Delimiter is tab (pasted from a
// spreadsheet) or comma (CSV, quotes supported). The owner supplies the data;
// nothing is fetched. Expert / Mason ranks are "reference ranks" shown next to
// the owner's own rankings — they never change the board by themselves.
export interface TableRow {
  rank?: number;
  name: string;
  team?: string;
  pos?: string;
  tier?: number; // 1-8 (S..G); letters S-G are converted
  expert?: number;
  mason?: number;
}
export interface ParsedTable {
  columns: { rank: boolean; team: boolean; pos: boolean; tier: boolean; expert: boolean; mason: boolean };
  rows: TableRow[];
}

function splitDelimited(line: string, delim: string): string[] {
  if (delim === "\t") return line.split("\t").map((c) => c.trim());
  const sep = delim === ";" ? ";" : ",";
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

const TIER_LETTERS = ["S", "A", "B", "C", "D", "E", "F", "G"];
const toNum = (v: string | undefined): number | undefined => {
  if (v == null) return undefined;
  const n = Number(v.replace(/^#/, "").trim());
  return v.trim() !== "" && Number.isFinite(n) ? n : undefined;
};
const toTier = (v: string | undefined): number | undefined => {
  if (!v) return undefined;
  const t = v.trim();
  const n = Number(t);
  if (Number.isInteger(n) && n >= 1 && n <= 8) return n;
  const i = TIER_LETTERS.indexOf(t.toUpperCase());
  return i >= 0 && t.length === 1 ? i + 1 : undefined;
};

// Tolerates what spreadsheets actually export: a UTF-8 BOM, tab / comma /
// semicolon delimiters, quoted cells, and a few title lines above the header.
// Returns null when no line in the first few is a header with a Name column
// (so the caller falls back to the plain name-list parser).
export function parseRankTable(raw: string): ParsedTable | null {
  const text = raw.replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return null;
  const pickDelim = (l: string) => {
    const counts: [string, number][] = [["\t", l.split("\t").length], [",", l.split(",").length], [";", l.split(";").length]];
    counts.sort((x, y) => y[1] - x[1]);
    return counts[0][0];
  };
  for (let h = 0; h < Math.min(6, lines.length - 1); h++) {
    const delim = pickDelim(lines[h]);
    const head = splitDelimited(lines[h], delim).map((c) => c.replace(/^\uFEFF/, "").toLowerCase().trim());
    const find = (test: (x: string) => boolean) => head.findIndex(test);
    // Order matters: "Flock Mason Rank" also contains "flock"/"rank".
    const mason = find((x) => x.includes("mason"));
    const expert = find((x) => (x.includes("expert") || x.includes("flock")) && !x.includes("mason"));
    const name = find((x) => x === "name" || x === "player" || x === "player name" || x === "full name");
    const rank = find((x) => x === "rank" || x === "#" || x === "my rank" || x === "overall" || x === "overall rank");
    const team = find((x) => x === "team");
    const pos = find((x) => x === "pos" || x === "position");
    const tier = find((x) => x === "tier");
    // A real rank table has at least one rank-type column; Name+Team alone is just a roster list.
    if (name < 0 || [rank, tier, expert, mason].every((i) => i < 0)) continue;

    const rows: TableRow[] = [];
    for (const line of lines.slice(h + 1)) {
      const c = splitDelimited(line, delim);
      const nm = c[name]?.trim();
      if (!nm) continue;
      rows.push({
        name: nm,
        rank: rank >= 0 ? toNum(c[rank]) : undefined,
        team: team >= 0 ? c[team]?.trim() || undefined : undefined,
        pos: pos >= 0 ? c[pos]?.trim().toUpperCase() || undefined : undefined,
        tier: tier >= 0 ? toTier(c[tier]) : undefined,
        expert: expert >= 0 ? toNum(c[expert]) : undefined,
        mason: mason >= 0 ? toNum(c[mason]) : undefined,
      });
    }
    return {
      columns: { rank: rank >= 0, team: team >= 0, pos: pos >= 0, tier: tier >= 0, expert: expert >= 0, mason: mason >= 0 },
      rows,
    };
  }
  return null;
}

// What the first line looks like, for an honest "couldn't find a Name column" message.
export function describeFirstLine(raw: string): string[] {
  const line = raw.replace(/^\uFEFF/, "").split(/\r?\n/).find((l) => l.trim());
  if (!line) return [];
  const delim = line.includes("\t") ? "\t" : line.split(";").length > line.split(",").length ? ";" : ",";
  return splitDelimited(line, delim).filter(Boolean).slice(0, 12);
}

export interface TableMatch extends PastedMatch {
  row: TableRow;
}

// Same resolution rules as matchPastedList, but the Position column (when
// present) disambiguates namesakes, and a row whose position contradicts
// every candidate is reported rather than forced.
export function matchTableRows(
  rows: TableRow[],
  board: { name: string; pos: string; team: string }[],
  index: ReturnType<typeof buildSleeperIndex>
): TableMatch[] {
  const out: TableMatch[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const k = looseKey(row.name);
    const wantPos = row.pos && (RANKABLE_POSITIONS as readonly string[]).includes(row.pos) ? row.pos : undefined;
    let m: PastedMatch;
    const onBoard = board.filter((p) => looseKey(p.name) === k && (!wantPos || p.pos === wantPos));
    if (onBoard.length === 1) m = { raw: row.name, status: "board", name: onBoard[0].name, pos: onBoard[0].pos };
    else if (onBoard.length > 1) m = { raw: row.name, status: "ambiguous", note: "two players with that name on your board" };
    else {
      const c = index.candidatesByName(row.name).filter((x) => !wantPos || x.e.p === wantPos);
      if (c.length === 1) m = { raw: row.name, status: "add", name: c[0].e.n, pos: c[0].e.p, team: c[0].e.t };
      else if (c.length > 1) m = { raw: row.name, status: "ambiguous", note: c.map((x) => `${x.e.p} ${x.e.t}`).join(" or ") };
      else {
        const fk = fuzzyKey(row.name);
        const fb = board.filter((p) => fuzzyKey(p.name) === fk && (!wantPos || p.pos === wantPos));
        const fc = index.candidatesByFuzzyName(row.name).filter((x) => !wantPos || x.e.p === wantPos);
        if (fb.length === 1) m = { raw: row.name, status: "board", name: fb[0].name, pos: fb[0].pos, fuzzy: true, note: `matched as ${fb[0].name}` };
        else if (fb.length === 0 && fc.length === 1) m = { raw: row.name, status: "add", name: fc[0].e.n, pos: fc[0].e.p, team: fc[0].e.t, fuzzy: true, note: `matched as ${fc[0].e.n}` };
        else m = { raw: row.name, status: "unmatched", note: "no player with that name" };
      }
    }
    // Keyed on name+position: the QB and TE named Josh Allen are two players.
    const key = m.name ? `${looseKey(m.name)}|${m.pos ?? ""}` : "";
    if (key && seen.has(key)) {
      out.push({ raw: row.name, status: "unmatched", note: "duplicate of an earlier row", row });
      continue;
    }
    if (key) seen.add(key);
    out.push({ ...m, row });
  }
  return out;
}
