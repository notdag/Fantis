// Sample data for the landing page's Command Center demo. Made up for illustration — sample league names, sample
// records, sample projections — and labelled "Sample leagues" wherever it appears. Real NFL player names are used only
// so the demo reads naturally; nothing here is anyone's real roster.

export type DemoDay = "WAIVERS" | "THU" | "SUN_EARLY" | "SUN_LATE" | "MON";

export interface DemoDecision {
  id: string;
  day: DemoDay;
  kind: "Injured starter" | "Bye-week starter" | "Empty slot" | "Open roster spot";
  player: string;
  team: string;
  pos: "QB" | "RB" | "WR" | "TE";
  league: string;
  fix: string;
}

export const DEMO_LEAGUES = [
  "Sunday Scaries",
  "Waiver Wire Warriors",
  "The Gridiron Syndicate",
  "Fourth & Long",
  "Bench Mob",
  "Red Zone Regulars",
  "Two-Minute Drill",
  "Hail Mary Club",
];

export const DEMO_DECISIONS: DemoDecision[] = [
  { id: "d1", day: "WAIVERS", kind: "Open roster spot", player: "Jaylen Warren", team: "PIT", pos: "RB", league: "Bench Mob", fix: "Claim — suggested $4 from this league's bids" },
  { id: "d2", day: "WAIVERS", kind: "Open roster spot", player: "Jalen Coker", team: "CAR", pos: "WR", league: "Hail Mary Club", fix: "Claim — no drop needed" },
  { id: "d3", day: "THU", kind: "Injured starter", player: "Jayden Daniels", team: "WAS", pos: "QB", league: "Sunday Scaries", fix: "Start Sam Darnold (19.1 proj)" },
  { id: "d4", day: "THU", kind: "Empty slot", player: "FLEX", team: "—", pos: "WR", league: "Fourth & Long", fix: "Fill with Tetairoa McMillan" },
  { id: "d5", day: "SUN_EARLY", kind: "Bye-week starter", player: "Rashee Rice", team: "KC", pos: "WR", league: "The Gridiron Syndicate", fix: "Swap in Zay Flowers" },
  { id: "d6", day: "SUN_EARLY", kind: "Injured starter", player: "Saquon Barkley", team: "PHI", pos: "RB", league: "Waiver Wire Warriors", fix: "Questionable — keep, or start Chase Brown" },
  { id: "d7", day: "SUN_EARLY", kind: "Bye-week starter", player: "Travis Kelce", team: "KC", pos: "TE", league: "Red Zone Regulars", fix: "Start Dallas Goedert" },
  { id: "d8", day: "SUN_LATE", kind: "Injured starter", player: "Puka Nacua", team: "LAR", pos: "WR", league: "Two-Minute Drill", fix: "Doubtful — start Terry McLaurin" },
  { id: "d9", day: "MON", kind: "Bye-week starter", player: "Darren Waller", team: "CAR", pos: "TE", league: "Bench Mob", fix: "Start Juwan Johnson" },
];

export const DEMO_MATCHUPS = [
  { league: "Sunday Scaries", opp: "GridironGurus", mine: 131.4, theirs: 112.8 },
  { league: "Waiver Wire Warriors", opp: "TDmachine", mine: 118.2, theirs: 121.6 },
  { league: "The Gridiron Syndicate", opp: "pancakeblock", mine: 126.9, theirs: 125.4 },
  { league: "Fourth & Long", opp: "Bills Mafia 4L", mine: 104.7, theirs: 129.3 },
  { league: "Bench Mob", opp: "QBwhisperer", mine: 139.0, theirs: 108.1 },
  { league: "Red Zone Regulars", opp: "Steelcity88", mine: 122.4, theirs: 119.9 },
  { league: "Two-Minute Drill", opp: "MooseKnuckles", mine: 115.6, theirs: 117.2 },
  { league: "Hail Mary Club", opp: "TheDynasty", mine: 133.3, theirs: 120.0 },
];

export const DEMO_WAIVERS = [
  { league: "Bench Mob", best: "Jaylen Warren", pos: "RB", ppg: 11.8, drop: "Kendre Miller", dropPpg: 5.1, faab: 64 },
  { league: "Fourth & Long", best: "Jalen Coker", pos: "WR", ppg: 10.9, drop: "open spot", dropPpg: 0, faab: 81 },
  { league: "Sunday Scaries", best: "Tyler Warren", pos: "TE", ppg: 9.6, drop: "Cade Otton", dropPpg: 6.2, faab: 37 },
  { league: "Hail Mary Club", best: "Bo Nix", pos: "QB", ppg: 17.4, drop: "Bryce Young", dropPpg: 13.9, faab: 55 },
  { league: "Red Zone Regulars", best: "Rhamondre Stevenson", pos: "RB", ppg: 10.7, drop: "Tank Bigsby", dropPpg: 6.8, faab: 22 },
];
