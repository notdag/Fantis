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

// A lone surname ("Pittman", "add Diggs") is now allowed as a mention — the
// index below also keys players by last name alone, and resolveName's
// existing ambiguity check (active.length >= 2 → ask, never guess) already
// covers a shared surname safely, the same way it already covers a shared
// full name. This guard is the other half of that: words that are common in
// how people TALK TO this app (its own command vocabulary, articles,
// pronouns, prepositions) can never be read as a player name even if some
// real NFL player happens to share the surname — a false "is this a player?"
// hit here would misfire on ordinary sentences, whereas a missed real
// surname just falls through to "I didn't understand that."
const STOPWORDS = new Set([
  "a", "an", "the", "i", "me", "my", "he", "him", "his", "she", "her", "it", "its", "we", "us", "our", "they", "them", "their",
  "is", "are", "was", "were", "be", "been", "being", "do", "does", "did", "done", "has", "have", "had",
  "and", "or", "but", "if", "then", "so", "for", "to", "of", "in", "on", "at", "by", "with", "from", "about", "not", "no", "yes",
  "this", "that", "these", "those", "who", "what", "where", "when", "why", "how", "all", "any", "some", "one", "now",
  "add", "drop", "claim", "submit", "execute", "approve", "confirm", "place", "send", "release", "cut", "move",
  "activate", "start", "bench", "week", "record", "help", "show", "find", "check", "fix", "improve", "upgrade",
  "scan", "waiver", "waivers", "roster", "rosters", "team", "teams", "league", "leagues", "sweep", "drops", "candidate", "candidates",
  "decision", "decisions", "standing", "standings", "playoff", "playoffs", "score", "scores", "win", "wins", "winning", "lose",
  "loses", "losing", "lost", "won", "reset", "clear", "filter", "filters", "player", "players", "lineup", "lineups", "flex",
  "ir", "taxi", "bye", "injured", "injury", "out", "questionable", "doubtful", "need", "needs", "want", "wants", "get", "gets",
]);

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
  const add = (key: string, id: string) => {
    const arr = byName.get(key);
    if (arr) {
      if (!arr.includes(id)) arr.push(id);
    } else byName.set(key, [id]);
  };
  for (const [id, e] of Object.entries(pmap)) {
    if (!e?.n || !FANTASY_POS.has(e.p)) continue;
    const key = normName(e.n);
    if (!key) continue;
    add(key, id);
    const parts = key.split(" ");
    maxTokens = Math.max(maxTokens, parts.length);
    // Also indexed by last name alone ("Pittman") — a shared surname is no
    // different from a shared full name to resolveName's ambiguity check, so
    // this is safe, not a guess. Not indexed by first name alone: those
    // collide far more (many "Josh"/"Michael"s) for little real benefit,
    // since "surname only" is how people actually refer to NFL players.
    if (parts.length > 1) add(parts[parts.length - 1], id);
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
// no "first substring hit" guessing. A single word only counts as a mention when
// it's a known nickname or a real surname in the index AND not one of this
// app's own stopwords — resolveName's ambiguity check still runs afterward, so
// a shared surname asks rather than guesses, same as a shared full name always has.
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
      if (slice.length === 1 && !aliasKey && STOPWORDS.has(key)) continue;
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
