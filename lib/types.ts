// Shared types for Sleeper data and rankings/trade values.

export interface Player {
  name: string;
  pos: string;
  team: string;
  tier: number;
  posRank: number;
}

export interface SleeperUser {
  user_id: string;
  username?: string;
  display_name?: string;
}

export interface SleeperLeague {
  league_id: string;
  name: string;
  season: string;
  total_rosters: number;
  status: string;
}

export interface SleeperRosterSettings {
  wins?: number;
  losses?: number;
  ties?: number;
  fpts?: number;
  fpts_decimal?: number;
  fpts_against?: number;
  fpts_against_decimal?: number;
}

export interface SleeperRoster {
  roster_id: number;
  owner_id: string;
  starters: string[] | null;
  players: string[] | null;
  settings?: SleeperRosterSettings;
}

export interface SleeperLeagueUser {
  user_id: string;
  display_name?: string;
  avatar?: string | null;
  metadata?: { team_name?: string };
}

export interface SleeperPlayerRaw {
  full_name?: string;
  first_name?: string;
  last_name?: string;
  position?: string;
  team?: string;
  age?: number;
  years_exp?: number;
  college?: string;
  injury_status?: string | null;
}

export interface SleeperState {
  week: number;
  season: string;
  season_type: string; // "pre" | "regular" | "post"
}

export interface SleeperProjectionEntry {
  adp_dd_ppr?: number;
  pts_ppr?: number;
  pts_half_ppr?: number;
  pts_std?: number;
}

export type ProjectionMap = Record<string, SleeperProjectionEntry>;

// Summed across every week of the regular season (see getSeasonProjectionTotals).
export interface SeasonProjectionTotal {
  pts: number;
  rushYd: number;
  recYd: number;
  passYd: number;
  rushTd: number;
  recTd: number;
  passTd: number;
  weeksCounted: number;
}

export interface PlayerMapEntry {
  n: string; // name
  p: string; // position
  t: string; // team
  age?: number;
  exp?: number; // years_exp
  college?: string;
  inj?: string | null; // injury_status
}

export type PlayerMap = Record<string, PlayerMapEntry>;

export interface Team {
  rid: number;
  ownerId: string;
  name: string;
  avatar: string | null;
  w: number;
  l: number;
  t: number;
  pf: number;
  pa: number;
  starters: string[];
  players: string[];
}

// Just the fields Start/Sit needs from the full league object: the real
// starting lineup shape and the real reception scoring, so recommendations
// match this league's actual rules instead of a generic full-PPR guess.
export interface SleeperLeagueDetail {
  roster_positions: string[];
  scoring_settings: Record<string, number>;
}

export interface LeagueBundle {
  lg: SleeperLeague;
  teams: Team[];
  pmap: PlayerMap;
  rosterPositions: string[];
  scoringRec: number; // scoring_settings.rec — 0 standard, 0.5 half, 1 full PPR
}
