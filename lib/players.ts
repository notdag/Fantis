// Starter rankings / trade values (edit or replace freely).
// value = 0-100 redraft-ish PPR scale. Swap in your own numbers or feed.
// This is the single most important thing to replace with a real data
// source down the line — see CLAUDE.md "Known limitations to fix".
import type { Player } from "./types";

type PlayerTuple = [name: string, pos: string, team: string, value: number, tier: number];

const RAW: PlayerTuple[] = [
  ["Ja'Marr Chase","WR","CIN",99,1],["Bijan Robinson","RB","ATL",97,1],["CeeDee Lamb","WR","DAL",95,1],
  ["Saquon Barkley","RB","PHI",95,1],["Jahmyr Gibbs","RB","DET",94,1],["Justin Jefferson","WR","MIN",93,1],
  ["Amon-Ra St. Brown","WR","DET",91,1],["Christian McCaffrey","RB","SF",90,1],["Puka Nacua","WR","LAR",89,1],
  ["Malik Nabers","WR","NYG",88,2],["De'Von Achane","RB","MIA",87,2],["Nico Collins","WR","HOU",86,2],
  ["Ashton Jeanty","RB","LV",85,2],["Brian Thomas Jr.","WR","JAX",84,2],["Derrick Henry","RB","BAL",83,2],
  ["Drake London","WR","ATL",82,2],["A.J. Brown","WR","PHI",81,2],["Josh Jacobs","RB","GB",80,2],
  ["Jonathan Taylor","RB","IND",79,2],["Brock Bowers","TE","LV",79,2],["Bucky Irving","RB","TB",78,3],
  ["Ladd McConkey","WR","LAC",77,3],["Kyren Williams","RB","LAR",76,3],["Tee Higgins","WR","CIN",76,3],
  ["Chase Brown","RB","CIN",75,3],["Garrett Wilson","WR","NYJ",75,3],["Marvin Harrison Jr.","WR","ARI",74,3],
  ["Jaxon Smith-Njigba","WR","SEA",74,3],["Kenneth Walker III","RB","SEA",73,3],["Davante Adams","WR","LAR",72,3],
  ["Terry McLaurin","WR","WAS",72,3],["Trey McBride","TE","ARI",71,3],["George Kittle","TE","SF",70,3],
  ["James Cook","RB","BUF",70,3],["Mike Evans","WR","TB",69,4],["DK Metcalf","WR","PIT",68,4],
  ["DJ Moore","WR","CHI",67,4],["Breece Hall","RB","NYJ",67,4],["Josh Allen","QB","BUF",95,1],
  ["Lamar Jackson","QB","BAL",94,1],["Jayden Daniels","QB","WAS",90,1],["Jalen Hurts","QB","PHI",88,2],
  ["Joe Burrow","QB","CIN",87,2],["Patrick Mahomes","QB","KC",84,2],["Baker Mayfield","QB","TB",80,3],
  ["Bo Nix","QB","DEN",78,3],["Kyler Murray","QB","ARI",76,3],["Brock Purdy","QB","SF",73,3],
  ["Caleb Williams","QB","CHI",70,3],["Jordan Love","QB","GB",72,3],["Justin Herbert","QB","LAC",71,3],
  ["Alvin Kamara","RB","NO",66,4],["Chuba Hubbard","RB","CAR",65,4],["Aaron Jones","RB","MIN",63,4],
  ["Joe Mixon","RB","HOU",63,4],["David Montgomery","RB","DET",62,4],["Tony Pollard","RB","TEN",60,4],
  ["Rhamondre Stevenson","RB","NE",56,5],["Zamir White","RB","LV",50,5],["Najee Harris","RB","LAC",58,5],
  ["Jaylen Waddle","WR","MIA",66,4],["Amari Cooper","WR","BUF",58,5],["Chris Olave","WR","NO",64,4],
  ["Zay Flowers","WR","BAL",65,4],["Courtland Sutton","WR","DEN",63,4],["Jordan Addison","WR","MIN",62,4],
  ["Jerry Jeudy","WR","CLE",60,4],["Rome Odunze","WR","CHI",59,5],["Xavier Worthy","WR","KC",61,4],
  ["Keon Coleman","WR","BUF",52,5],["Jameson Williams","WR","DET",60,4],["Calvin Ridley","WR","TEN",55,5],
  ["Stefon Diggs","WR","NE",53,5],["Cooper Kupp","WR","SEA",57,5],["Deebo Samuel","WR","WAS",56,5],
  ["Sam LaPorta","TE","DET",64,4],["Mark Andrews","TE","BAL",58,5],["Travis Kelce","TE","KC",57,5],
  ["T.J. Hockenson","TE","MIN",55,5],["David Njoku","TE","CLE",54,5],["Dallas Goedert","TE","PHI",48,6],
  ["Jonnu Smith","TE","MIA",46,6],["Evan Engram","TE","DEN",47,6],["Dalton Kincaid","TE","BUF",50,5],
  ["Jayden Reed","WR","GB",54,5],["Khalil Shakir","WR","BUF",52,5],["Jakobi Meyers","WR","LV",50,5],
  ["Jauan Jennings","WR","SF",47,6],["DeVonta Smith","WR","PHI",61,4],["Tank Bigsby","RB","JAX",44,6],
  ["Tyrone Tracy Jr.","RB","NYG",48,6],["Jaylen Warren","RB","PIT",49,6],["Brian Robinson Jr.","RB","WAS",50,5],
  ["Isiah Pacheco","RB","KC",58,5],["Travis Etienne Jr.","RB","JAX",52,5],["D'Andre Swift","RB","CHI",51,5],
  ["Rachaad White","RB","TB",50,5],["Javonte Williams","RB","DAL",42,6],["Jordan Mason","RB","MIN",45,6],
  ["Tyreek Hill","WR","MIA",70,3],["Ricky Pearsall","WR","SF",46,6],["Jayden Higgins","WR","HOU",44,6],
  ["Travis Hunter","WR","JAX",56,5],["Tetairoa McMillan","WR","CAR",55,5],["Matthew Golden","WR","GB",48,6],
  ["Omarion Hampton","RB","LAC",62,4],["TreVeyon Henderson","RB","NE",58,5],["Quinshon Judkins","RB","CLE",57,5],
  ["Kaleb Johnson","RB","PIT",50,5],["RJ Harvey","RB","DEN",49,6],["Cam Ward","QB","TEN",55,5],
  ["Dak Prescott","QB","DAL",68,4],["Trevor Lawrence","QB","JAX",60,4],["Drake Maye","QB","NE",62,4],
  ["C.J. Stroud","QB","HOU",66,4],["Anthony Richardson","QB","IND",55,5],["Michael Penix Jr.","QB","ATL",54,5],
];

export const PLAYERS: Player[] = RAW.map(([name, pos, team, value, tier]) => ({
  name,
  pos,
  team,
  value,
  tier,
  posRank: 0, // filled in below, per-position rank by value (1 = best)
}));

const byPosition: Record<string, Player[]> = {};
for (const p of PLAYERS) {
  (byPosition[p.pos] ||= []).push(p);
}
for (const group of Object.values(byPosition)) {
  group
    .sort((a, b) => b.value - a.value)
    .forEach((p, i) => {
      p.posRank = i + 1;
    });
}

export const POS_COLOR: Record<string, string> = {
  QB: "var(--qb)",
  RB: "var(--rb)",
  WR: "var(--wr)",
  TE: "var(--te)",
  K: "var(--oth)",
  DEF: "var(--oth)",
};

// Soft "chip" treatment for position badges: tinted background + border
// derived from the position's own color via color-mix, text in the full hue.
// Keeps position legible at a glance without a solid saturated fill.
export function posChipStyle(pos: string) {
  const c = POS_COLOR[pos] || POS_COLOR.DEF;
  return {
    color: c,
    background: `color-mix(in srgb, ${c} 16%, transparent)`,
    borderColor: `color-mix(in srgb, ${c} 40%, transparent)`,
  };
}

export const TIER_COLOR = [
  "#37E0B0",
  "#FFB020",
  "#35B6F0",
  "#F5A742",
  "#B18CFF",
  "#8A9BB5",
];
