// Strict player resolution. A name typed by the user is NEVER trusted to be
// "the first string match": every candidate is shown with position/team/status,
// and anything meaningfully ambiguous stops and asks. Pure — takes the Sleeper
// player map, does no fetching.
import type { PlayerMap } from "../types";
import type { PlayerCard } from "./types";

const FANTASY_POS = new Set(["QB", "RB", "WR", "TE", "K", "DEF"]);

// A deliberately tiny, obvious nickname table. An alias only *expands to a
// name to look up* — the lookup still goes through the same strict candidate
// check, so a nickname can never bypass the ambiguity prompt.
const ALIASES: Record<string, string> = {
  cmc: "christian mccaffrey",
  jsn: "jaxon smith njigba",
  "amon ra": "amon ra st brown",
  "cee dee": "ceedee lamb",
  "gibby": "jahmyr gibbs",
};

export function normName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[.'’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export interface PlayerIndex {
  byName: Map<string, string[]>; // normalized full name → player ids
  pmap: PlayerMap;
  maxTokens: number;
}

export function buildPlayerIndex(pmap: PlayerMap): PlayerIndex {
  const byName = new Map<string, string[]>();
  let maxTokens = 2;
  for (const [id, e] of Object.entries(pmap)) {
    if (!e?.n || !FANTASY_POS.has(e.p)) continue;
    const key = normName(e.n);
    if (!key) continue;
    const arr = byName.get(key);
    if (arr) arr.push(id);
    else byName.set(key, [id]);
    maxTokens = Math.max(maxTokens, key.split(" ").length);
  }
  return { byName, pmap, maxTokens: Math.min(maxTokens, 5) };
}

export function cardOf(pmap: PlayerMap, id: string): PlayerCard | null {
  const e = pmap[id];
  if (!e) return null;
  return { id, name: e.n, pos: e.p, team: e.t || "", injury: e.inj ?? null, active: !!e.t };
}

export type Resolution =
  | { status: "resolved"; player: PlayerCard; ignored: PlayerCard[] }
  | { status: "ambiguous"; options: PlayerCard[]; reason: string }
  | { status: "none" };

// `query` is a name as the user typed it (or an alias).
export function resolveName(query: string, index: PlayerIndex): Resolution {
  const norm0 = normName(query);
  const norm = ALIASES[norm0] ?? norm0;
  const ids = index.byName.get(norm) ?? [];
  const cards = ids.map((id) => cardOf(index.pmap, id)).filter((c): c is PlayerCard => !!c);
  if (cards.length === 0) return { status: "none" };
  const active = cards.filter((c) => c.active);
  if (active.length === 1) {
    return { status: "resolved", player: active[0], ignored: cards.filter((c) => !c.active) };
  }
  if (active.length >= 2) {
    return { status: "ambiguous", options: active, reason: `${active.length} current players are named "${query.trim()}".` };
  }
  // Only players with no current NFL team match — never auto-pick those.
  return {
    status: "ambiguous",
    options: cards,
    reason: `"${query.trim()}" only matches players with no current NFL team — please confirm which one you mean.`,
  };
}

export interface Mention {
  text: string; // the phrase as typed
  start: number;
  end: number; // token indexes [start, end)
}

// Finds player-name mentions inside a free-form sentence by matching token
// n-grams (longest first) against the known name dictionary — no LLM needed and
// no "first substring hit" guessing. Single-word names are only accepted as
// known nicknames, because a lone surname is far too ambiguous to trust.
export function findMentions(text: string, index: PlayerIndex): Mention[] {
  const tokens = text.split(/\s+/).filter(Boolean);
  const norm = tokens.map((t) => normName(t));
  const out: Mention[] = [];
  let i = 0;
  while (i < tokens.length) {
    let hit: Mention | null = null;
    for (let n = Math.min(index.maxTokens + 1, tokens.length - i); n >= 1; n--) {
      const slice = norm.slice(i, i + n).filter(Boolean);
      if (slice.length === 0) continue;
      const key = slice.join(" ");
      const aliasKey = ALIASES[key];
      const known = aliasKey ? true : index.byName.has(key);
      if (!known) continue;
      if (slice.length === 1 && !aliasKey) continue; // lone surname/first name: too ambiguous
      hit = { text: tokens.slice(i, i + n).join(" ").replace(/[?,.!]+$/g, ""), start: i, end: i + n };
      break;
    }
    if (hit) {
      out.push(hit);
      i = hit.end;
    } else i++;
  }
  return out;
}

export const describeCard = (c: PlayerCard) =>
  `${c.name} — ${c.pos || "?"} — ${c.team || "no NFL team"}${c.injury ? ` — ${c.injury}` : ""}`;
