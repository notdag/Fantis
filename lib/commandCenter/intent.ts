// Natural-language → intent. Deterministic (no LLM): phrase patterns plus the
// strict name dictionary in resolve.ts. The result is only ever a request for a
// READ workflow; a message that sounds like an instruction to change something
// becomes `execute_request`, which the engine answers with a refusal + preview —
// it can never turn into a write (there is no write path in this module tree).
import { findMentions, type Mention, type PlayerIndex } from "./resolve";
import type { AvailState } from "./types";

export interface ViewFilter {
  states?: AvailState[];
  needsDrop?: boolean; // true = only leagues that need a drop; false = only open-spot leagues
}

export type MatchupVerdictFilter = "WIN" | "LOSS" | "TOSS_UP" | "INCOMPLETE";

export type Intent =
  | { kind: "win_projection"; verdict?: MatchupVerdictFilter; fresh: boolean }
  | { kind: "choice"; n: number }
  | { kind: "scan_player"; mentions: Mention[]; filter: ViewFilter; wantDrops: boolean }
  | { kind: "scan_leagues" }
  | { kind: "filter"; filter: ViewFilter }
  | { kind: "clear_filter" }
  | { kind: "drops"; count: number; mentions: Mention[] }
  | { kind: "aggregate_drops" }
  | { kind: "candidate_leagues"; text: string; countOnly: boolean }
  | { kind: "waiver_opps" }
  | { kind: "ir_opps" }
  | { kind: "roster_decisions" }
  | { kind: "execute_request"; verb: string; mentions: Mention[] }
  | { kind: "reset" }
  | { kind: "help" }
  | { kind: "unknown" };

const WORD_NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, ten: 10 };

function numberIn(t: string, fallback: number): number {
  const d = t.match(/\b(\d{1,2})\b/);
  if (d) return Math.min(10, Math.max(1, Number(d[1])));
  for (const [w, n] of Object.entries(WORD_NUM)) if (new RegExp(`\\b${w}\\b`).test(t)) return n;
  return fallback;
}

export function parseFilter(t: string): ViewFilter {
  const f: ViewFilter = {};
  const states = new Set<AvailState>();
  if (/\bactionable\b/.test(t)) {
    states.add("AVAILABLE");
    states.add("WAIVER");
  }
  if (/\b(waivers?|claims?|claimable)\b/.test(t)) states.add("WAIVER");
  if (/\b(free agents?|available|open|addable)\b/.test(t) || /\b(can|could) (i )?add\b/.test(t)) states.add("AVAILABLE");
  if (/\b(already (rostered|on my)|on my roster|i (already )?(have|own))\b/.test(t)) states.add("ON_MY_ROSTER");
  if (/\b(other (teams?|rosters?)|someone else|rostered by)\b/.test(t)) states.add("ON_OTHER_ROSTER");
  if (/\bunknown\b/.test(t)) states.add("UNKNOWN");
  if (/\b(failed|couldn'?t (be )?scan)\b/.test(t)) states.add("SCAN_FAILED");
  if (/\bnot eligible\b|\bineligible\b/.test(t)) states.add("NOT_ELIGIBLE");
  if (states.size) f.states = [...states];
  if (/(without|no)\s+(having to\s+)?(dropping|a drop|drops?)|don'?t (need|have) to drop|open (roster )?spots?|roster spots? (is |are )?open|no drop (required|needed)/.test(t)) f.needsDrop = false;
  else if (/(need|needs|require|requires|requiring)\s+(me to\s+)?(a\s+)?drops?|(would )?need to drop|have to drop|full roster|roster (is )?full|drop (is )?required/.test(t)) f.needsDrop = true;
  return f;
}

const hasFilter = (f: ViewFilter) => !!(f.states?.length || f.needsDrop !== undefined);

export function parseIntent(raw: string, index: PlayerIndex, ctx: { hasScan: boolean; hasDrops: boolean; pending: boolean; hasMatchups?: boolean }): Intent {
  const text = raw.trim();
  const t = text.toLowerCase().replace(/[?!]+$/g, "").trim();
  if (!t) return { kind: "unknown" };

  if (ctx.pending) {
    const m = t.match(/^(?:option|number|#|the)?\s*(\d{1,2})\.?$/);
    if (m) return { kind: "choice", n: Number(m[1]) };
    const ord = t.match(/^(?:the\s+)?(first|second|third|fourth|fifth)(?:\s+one)?$/);
    if (ord) return { kind: "choice", n: ["first", "second", "third", "fourth", "fifth"].indexOf(ord[1]) + 1 };
  }

  if (/^(reset|start over|new (search|scan)|clear( everything| all)?|forget (that|it))$/.test(t)) return { kind: "reset" };
  if (/^(help|what can you do|examples?|\?)$/.test(t)) return { kind: "help" };
  if (/^(show )?(all|everything)$|^(clear|remove|reset) (the )?filters?$|^show all( leagues)?$/.test(t)) return { kind: "clear_filter" };

  const mentions = findMentions(text, index);

  // Imperative "do it" phrasing → never executed; the engine refuses + previews.
  const verb = t.match(/^(?:please\s+|now\s+|then\s+|ok(?:ay)?,?\s+)?(add|drop|claim|submit|execute|approve|confirm|place|send|release|cut|pick up|put|move|activate|start|bench)\b/);
  if (verb || /\b(go ahead|do it|make (it|the (move|claim|change)s?) happen|execute (it|them|all)|confirm (it|all|them)|apply (it|them)|submit (it|them|all))\b/.test(t)) {
    return { kind: "execute_request", verb: verb?.[1] ?? "execute", mentions };
  }

  // "How many leagues am I projected to win this week?" and follow-ups on that result.
  const verdictWord: MatchupVerdictFilter | undefined = /\b(los(e|ing|es|s)|behind|projected losses)\b/.test(t)
    ? "LOSS"
    : /\b(close|toss[- ]?ups?|tight|coin ?flip|too close)\b/.test(t)
      ? "TOSS_UP"
      : /\b(incomplete|empty (slot|spot)s?|missing starters?)\b/.test(t)
        ? "INCOMPLETE"
        : /\b(win|wins|winning|won)\b/.test(t)
          ? "WIN"
          : undefined;
  const freshWin =
    /(how many|which|what|show|find|list)\b.*\bleagues?\b.*\b(win|winning|lose|losing|projected|predicted|expected|favou?red)\b/.test(t) ||
    /\b(projected|predicted|expected|forecast(ed)?)\b.*\b(win|wins|winning|lose|losing|record)\b/.test(t) ||
    /\b(am i|will i|do i|are we) (going to |gonna )?(win|winning|lose|losing)\b/.test(t) ||
    /\bwin(ning)? this week\b|\bmy matchups?\b|\bmatchup (projections?|preview|forecast)\b|\bthis week'?s? matchups?\b/.test(t);
  // With a result already on screen, "show me the ones I'm losing" filters it; only an explicit
  // count question or "refresh/again" re-reads the leagues.
  const asksAgain = /\b(refresh|again|re-?check|re-?scan|update|latest)\b|how many/.test(t);
  if (freshWin) {
    const followUp = !!ctx.hasMatchups && !!verdictWord && verdictWord !== "WIN" && !asksAgain;
    return { kind: "win_projection", verdict: verdictWord === "WIN" ? undefined : verdictWord, fresh: !followUp };
  }
  if (ctx.hasMatchups && verdictWord && mentions.length === 0 && !/\b(bottom|weakest|drops?)\b/.test(t)) {
    return { kind: "win_projection", verdict: verdictWord, fresh: false };
  }

  // Cross-league drop aggregation drill-downs.
  if (/how many leagues.*(candidate|bottom|drop)|(leagues?|which).*(where|with).*(bottom|candidate|one of the (bottom|worst|weakest))|how many.*(bottom|candidate)/.test(t) && ctx.hasDrops) {
    return { kind: "candidate_leagues", text, countOnly: /^how many|how many leagues/.test(t) };
  }
  if (/most common|show up (the )?most|appears? (the )?most|repeat(ed)? (drop|candidate)|which (players|drops).*(most|often|common)|aggregate|patterns?/.test(t) && ctx.hasDrops) {
    return { kind: "aggregate_drops" };
  }

  // Drop workflows.
  if (
    /\b(bottom|worst|weakest|lowest)\b.*\b(\d+|one|two|three|four|five)?\b.*\b(players?|drops?|guys|candidates?)?\b|\bwho can i drop\b|\bwho should i drop\b|\bdrop candidates?\b|\b(give me|show me|find me)?\s*(\d+|one|two|three|four|five)\s+drops?\b|\bdrops? for\b|\bmy (weakest|worst)\b|\bcompare my rosters\b/.test(t) &&
    !/\bwhich (leagues?)\b/.test(t)
  ) {
    return { kind: "drops", count: numberIn(t, 3), mentions };
  }

  if (/\b(waiver|add) (opportunit\w*|targets?)\b|\bbest (waiver )?(adds?|available|pickups?)\b|\bwho should i (add|pick up|claim)\b|\bwaiver opportunit/.test(t)) return { kind: "waiver_opps" };
  if (/\b(roster decisions?|decision to make|need(s)? (my )?attention|needs? a decision)\b/.test(t)) return { kind: "roster_decisions" };
  if (/\bir\b|injur/.test(t) && /\b(league|leagues|player|players|roster)\b/.test(t) && mentions.length === 0) return { kind: "ir_opps" };

  const f = parseFilter(t);

  if (mentions.length > 0) {
    // A lone "available"/"add" in a first question ("is he available?", "where can I add him") means
    // "tell me everything", not "hide the waiver leagues" — only real restrictions narrow the view.
    const scanFilter: ViewFilter = { ...f };
    if (scanFilter.needsDrop === undefined && scanFilter.states?.length === 1 && scanFilter.states[0] === "AVAILABLE") delete scanFilter.states;
    return { kind: "scan_player", mentions, filter: scanFilter, wantDrops: /\bdrops?\b|\bwho (can|do) i drop\b/.test(t) };
  }

  // Follow-up filter on the previous result ("only waiver leagues", "the rest").
  if (ctx.hasScan && hasFilter(f)) return { kind: "filter", filter: f };

  if (/\b(scan|check|search|look (at|through)|find|show)\b.*\b(all|every|my)\b.*\bleagues?\b|\bscan (everything|all)\b/.test(t)) return { kind: "scan_leagues" };

  return { kind: "unknown" };
}
