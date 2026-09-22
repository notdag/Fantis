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

export type MatchupVerdictFilter = "WIN" | "LOSS" | "TOSS_UP" | "WON" | "LOST" | "LEADING" | "TRAILING";

export type Intent =
  | { kind: "win_projection"; verdict?: MatchupVerdictFilter; fresh: boolean }
  | { kind: "lineup_improvements" }
  | { kind: "weekly_sweep" }
  | { kind: "week_record"; week: number | null; relative?: "last" | "this" }
  | { kind: "activate_ir"; mentions: Mention[] }
  | { kind: "send_to_ir"; mentions: Mention[] }
  | { kind: "force_start"; mentions: Mention[] }
  | { kind: "standings"; filter?: "IN" | "BUBBLE" | "OUT"; fresh: boolean }
  | { kind: "choice"; n: number }
  | { kind: "scan_player"; mentions: Mention[]; filter: ViewFilter; wantDrops: boolean }
  | { kind: "scan_leagues" }
  | { kind: "filter"; filter: ViewFilter }
  | { kind: "clear_filter" }
  | { kind: "drops"; count: number; mentions: Mention[] }
  | { kind: "drop_preferences"; mentions: Mention[] }
  | { kind: "aggregate_drops" }
  | { kind: "candidate_leagues"; text: string; countOnly: boolean }
  | { kind: "waiver_opps" }
  | { kind: "ir_opps" }
  | { kind: "roster_decisions" }
  | { kind: "execute_request"; verb: string; mentions: Mention[]; filter: ViewFilter; dropOrder?: Mention[] }
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

export const hasFilter = (f: ViewFilter) => !!(f.states?.length || f.needsDrop !== undefined);

// Splits an "add X, Y, drop A, B if needed" style sentence at the FIRST
// standalone "drop"/"dropping" token (not part of another word, e.g. never
// matches inside "Dropbox"), so the mentions before it are the add targets
// and the mentions after it are the owner's own drop order — same split the
// two-message drop_preferences follow-up applies, just in one sentence.
// Returns null if there's no such keyword, or no real player mentions after
// it (a bare "...drop him if needed" has nothing to extract).
function splitAtDropKeyword(text: string, mentions: Mention[]): { before: Mention[]; after: Mention[] } | null {
  const tokens = text.split(/\s+/).filter(Boolean);
  const idx = tokens.findIndex((tok) => /^drop(ping)?[.,!?]?$/i.test(tok));
  if (idx < 0) return null;
  const after = mentions.filter((m) => m.start > idx);
  if (after.length === 0) return null;
  const before = mentions.filter((m) => m.end <= idx);
  return { before, after };
}

export function parseIntent(raw: string, index: PlayerIndex, ctx: { hasScan: boolean; hasDrops: boolean; pending: boolean; hasMatchups?: boolean; hasStandings?: boolean }): Intent {
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

  // Playoff position + roster strength. With a result on screen, "only the ones I'm out of" filters it.
  const standingsWord = /\b(where (do )?i stand|standings?|playoff (picture|outlook|position|chances|spot|race|line)|in (a )?playoff (spot|position)|make (the )?playoffs|power rankings?|team strength|how (strong|good) (are|is) my (teams?|rosters?)|roster strength|bubble)\b/.test(t);
  if (standingsWord && mentions.length === 0) {
    const filter = /\b(out|missing|behind|outside|below)\b.*\b(playoff|line|cut)/.test(t) || /\bout of (the )?playoffs?\b/.test(t) ? "OUT" : /\bbubble\b/.test(t) ? "BUBBLE" : /\b(in|making|inside)\b.*\bplayoff/.test(t) && !/how many|where/.test(t) ? "IN" : undefined;
    return { kind: "standings", filter, fresh: !(ctx.hasStandings && filter) };
  }
  if (ctx.hasStandings && mentions.length === 0 && /^(only |just |show |now )?(the )?(leagues )?(i'?m |i am )?(in|out|on the bubble|bubble)\b/.test(t)) {
    return { kind: "standings", filter: /\bout\b/.test(t) ? "OUT" : /\bbubble\b/.test(t) ? "BUBBLE" : "IN", fresh: false };
  }

  // "What was my record for week 2" / "how did I do week 3" — a real PAST-week
  // question, distinct from "where do I stand" (current standings) and "how many
  // am I winning" (this week, live). Needs an actual week number; without one
  // it's ambiguous, so it falls through rather than guessing which week.
  const recordWord = /\b(my )?(overall )?record\b.*\bweek\b|\bweek\b.*\brecord\b|\bhow did i do\b.*\bweek\b|\bweek\b.*\bhow did i do\b|\bmy (score|results?)\b.*\bweek\b|\bweek\b.*\b(results?|scores?)\b/.test(t);
  if (recordWord) {
    const wm = t.match(/\bweek\s*#?\s*(\d{1,2})\b/);
    if (wm) return { kind: "week_record", week: Math.min(25, Math.max(1, Number(wm[1]))) };
    // "last/this week" — no number was given, so the engine resolves it against
    // the real current week rather than this pure function guessing at one.
    if (/\blast week\b/.test(t)) return { kind: "week_record", week: null, relative: "last" };
    if (/\bthis week\b/.test(t)) return { kind: "week_record", week: null, relative: "this" };
  }

  // "Move <player> off IR to the bench" — checked before the generic execute_request
  // verb match below (its own trigger words overlap: move/activate/get/take).
  if (
    mentions.length > 0 &&
    /\b(activate|move|get|take|bring)\b.*\b(off|from)\s+(ir|reserve)\b|\bactivate\b.*\b(ir|reserve)\b|\bun-?ir\b|\boff (ir|reserve)\b.*\bbench\b/.test(t)
  ) {
    return { kind: "activate_ir", mentions };
  }

  // "Put <player> on IR" / "move <player> to IR" — the opposite direction from
  // activate_ir above; that regex only ever matches "off"/"from" IR, this one
  // only "on"/"to"/"in" IR, so the two can never collide on the same sentence.
  if (
    mentions.length > 0 &&
    /\b(put|place|move|send|get)\b.*\b(on|to|onto|into|in)\s+(the\s+)?(ir|injured reserve)\b|\bir\s+(him|her|them)\b/.test(t)
  ) {
    return { kind: "send_to_ir", mentions };
  }

  // "Make sure <player> starts" / "start <player> in my lineups" — a forced single-
  // player override of the optimizer, distinct from lineup_improvements (which has
  // no player mention and picks the whole lineup on its own).
  if (
    mentions.length > 0 &&
    (/\bmake sure\b.*\bstart/.test(t) ||
      /\bstart\b.*\b(everywhere|in (my )?(starting )?lineups?|(in|across) (all |every )?(of )?my leagues|in every league)\b/.test(t) ||
      /\b(i want|need)\b.*\bto start\b/.test(t) ||
      /\bneeds? to (be )?start(ing)?\b/.test(t) ||
      /\bget\b.*\b(in(to)? )?(my )?(starting )?lineups?\b/.test(t) ||
      /^start\b/.test(t))
  ) {
    return { kind: "force_start", mentions };
  }

  if (/\bweekly sweep\b|\bsweep (the week|my leagues)\b|\brun (my )?(weekly )?sweep\b|\bdo my weekly (check|sweep)\b/.test(t) && mentions.length === 0) {
    return { kind: "weekly_sweep" };
  }

  if (/\b(optimi[sz]e|fix|improve|upgrade|check|find)\b.*\blineups?\b|\blineup (improvements?|changes?|suggestions?|issues?)\b|\bwho should i start\b|\b(bench(ed)?|sitting) (a )?better\b/.test(t) && mentions.length === 0) {
    return { kind: "lineup_improvements" };
  }

  // A follow-up drop order for the "add"/waiver scan still on screen — "drop
  // Tank Bigsby, then Mike Washington, then Woody Marks" after "add X and Y
  // everywhere". Only makes sense as a follow-up (ctx.hasScan): a bare "drop
  // X" with no scan on screen is the ordinary drop-verb execute_request
  // below, not this. Excludes phrasing that clearly starts a NEW scan
  // ("everywhere"/"in my leagues") so a fresh multi-target drop request
  // still reaches execute_request as usual.
  if (
    ctx.hasScan &&
    mentions.length > 0 &&
    /^(?:then\s+)?drop(?:ping)?\b/.test(t) &&
    !/\beverywhere\b|\bin (my |all my )?leagues?\b|\bacross (my |all my )?leagues?\b/.test(t)
  ) {
    return { kind: "drop_preferences", mentions };
  }

  // Imperative "do it" phrasing → never executed; the engine refuses + previews.
  // Any condition in the SAME sentence ("...if he's on waivers", "...only where I
  // don't need to drop anyone") is parsed and applied to the preview, same as a
  // plain scan below — it was silently dropped here before, which is why a
  // compound "add X if Y" request used to just show every league regardless of Y.
  const verb = t.match(/^(?:please\s+|now\s+|then\s+|ok(?:ay)?,?\s+)?(add|drop|claim|submit|execute|approve|confirm|place|send|release|cut|pick up|put|move|activate|start|bench)\b/);
  if (verb || /\b(go ahead|do it|make (it|the (move|claim|change)s?) happen|execute (it|them|all)|confirm (it|all|them)|apply (it|them)|submit (it|them|all))\b/.test(t)) {
    const ef = parseFilter(t);
    if (ef.needsDrop === undefined && ef.states?.length === 1 && ef.states[0] === "AVAILABLE") delete ef.states;
    // "add X, Y, drop A, B if needed" in ONE message — same drop-order idea
    // as the two-message drop_preferences follow-up, just combined. Only
    // when the primary verb isn't itself "drop" (that's a plain drop
    // request, nothing to split).
    if (verb?.[1] !== "drop") {
      const split = splitAtDropKeyword(text, mentions);
      if (split) return { kind: "execute_request", verb: verb?.[1] ?? "execute", mentions: split.before, filter: ef, dropOrder: split.after };
    }
    return { kind: "execute_request", verb: verb?.[1] ?? "execute", mentions, filter: ef };
  }

  // "How many leagues am I projected to win this week?" and follow-ups on that result.
  const verdictWord: MatchupVerdictFilter | undefined = /\b(already (lost|lose)|lost|clinched a loss)\b/.test(t)
    ? "LOST"
    : /\b(already (won|win)|won|clinched)\b/.test(t)
      ? "WON"
      : /\b(trailing|behind|down|losing right now|currently (losing|behind))\b/.test(t)
        ? "TRAILING"
        : /\b(leading|ahead|up|currently (winning|ahead)|winning right now)\b/.test(t)
          ? "LEADING"
          : /\b(los(e|ing|es|s)|projected losses)\b/.test(t)
            ? "LOSS"
            : /\b(close|toss[- ]?ups?|tight|coin ?flip|too close)\b/.test(t)
              ? "TOSS_UP"
              : /\b(win|wins|winning)\b/.test(t)
                ? "WIN"
                : undefined;
  const freshWin =
    /(how many|which|what|show|find|list)\b.*\bleagues?\b.*\b(win|winning|lose|losing|projected|predicted|expected|favou?red)\b/.test(t) ||
    /\b(projected|predicted|expected|forecast(ed)?)\b.*\b(win|wins|winning|lose|losing|record)\b/.test(t) ||
    /\b(scores?|score ?board|live|players? (left|played|remaining)|who'?s (winning|leading))\b.*\b(leagues?|matchups?|week)\b|\bleagues? (am i|i'?m) (winning|leading|losing|trailing|behind|ahead)\b/.test(t) ||
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
