"use client";

import { useCallback, useState } from "react";
import {
  SEASONS,
  avatar,
  getLeagueDetail,
  getLeagues,
  getLeagueUsers,
  getPlayers,
  getRosters,
  getUser,
} from "@/lib/sleeper";
import type { LeagueBundle, PlayerMap, SleeperLeague, Team } from "@/lib/types";
import { PLAYERS, posChipStyle } from "@/lib/players";
import LeagueView from "@/components/LeagueView";
import TeamHub from "@/components/TeamHub";
import Rankings from "@/components/Rankings";
import Trade from "@/components/Trade";
import StartSit from "@/components/StartSit";
import WaiverWire from "@/components/WaiverWire";
import Portfolio from "@/components/Portfolio";

type Tab = "leagues" | "rankings" | "trade" | "startsit" | "portfolio";

export default function FantisApp() {
  const [tab, setTab] = useState<Tab>("leagues");
  const [username, setUsername] = useState("");
  const [season, setSeason] = useState("2026");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [leagues, setLeagues] = useState<SleeperLeague[]>([]);
  const [players, setPlayers] = useState<PlayerMap | null>(null);
  const [sel, setSel] = useState<LeagueBundle | null>(null);
  const [selLoading, setSelLoading] = useState(false);
  const [myUserId, setMyUserId] = useState<string | null>(null);

  const sync = useCallback(async () => {
    const u = username.trim();
    if (!u) {
      setError("Enter your Sleeper username first.");
      return;
    }
    setError("");
    setLoading(true);
    setLeagues([]);
    setSel(null);
    try {
      const user = await getUser(u);
      if (!user || !user.user_id) throw new Error("not found");
      setMyUserId(user.user_id);
      let lgs = await getLeagues(user.user_id, season);
      if ((!lgs || !lgs.length) && season === "2026") {
        lgs = await getLeagues(user.user_id, "2025");
      }
      if (!lgs || !lgs.length) {
        setError(`No NFL leagues found for ${u} in ${season}. Try another season.`);
      }
      setLeagues(lgs || []);
    } catch {
      setError(`Couldn't reach Sleeper for "${u}". Check the username and try again.`);
    } finally {
      setLoading(false);
    }
  }, [username, season]);

  const openLeague = useCallback(
    async (lg: SleeperLeague) => {
      setSelLoading(true);
      setError("");
      try {
        const [rosters, users, pmap, detail] = await Promise.all([
          getRosters(lg.league_id),
          getLeagueUsers(lg.league_id),
          players ? Promise.resolve(players) : getPlayers(),
          getLeagueDetail(lg.league_id),
        ]);
        if (!players) setPlayers(pmap);
        const uById: Record<string, (typeof users)[number]> = {};
        users.forEach((x) => (uById[x.user_id] = x));
        const teams: Team[] = rosters
          .map((r) => {
            const owner = uById[r.owner_id] || ({} as (typeof users)[number]);
            const meta = owner.metadata || {};
            const s = r.settings || {};
            return {
              rid: r.roster_id,
              ownerId: r.owner_id,
              name: meta.team_name || owner.display_name || `Team ${r.roster_id}`,
              avatar: avatar(owner.avatar),
              w: s.wins || 0,
              l: s.losses || 0,
              t: s.ties || 0,
              pf: (s.fpts || 0) + (s.fpts_decimal || 0) / 100,
              pa: (s.fpts_against || 0) + (s.fpts_against_decimal || 0) / 100,
              starters: (r.starters || []).filter(Boolean),
              players: r.players || [],
            };
          })
          .sort((a, b) => b.w - a.w || b.pf - a.pf);
        setSel({
          lg,
          teams,
          pmap: players || pmap,
          rosterPositions: detail.roster_positions || [],
          scoringRec: detail.scoring_settings?.rec ?? 0,
        });
      } catch {
        setError("Couldn't load that league's rosters. Try again in a moment.");
      } finally {
        setSelLoading(false);
      }
    },
    [players]
  );

  return (
    <div className="fantis">
      <div className="wrap">
        <nav className="nav">
          <div className="brand">
            <div className="mark">F</div>
            <b>Fantis</b>
          </div>
          <div className="tabs">
            {(
              [
                ["leagues", "Leagues"],
                ["rankings", "Rankings"],
                ["trade", "Trade"],
                ["startsit", "Start/Sit"],
                ["portfolio", "Portfolio"],
              ] as [Tab, string][]
            ).map(([k, l]) => (
              <button
                key={k}
                className={`tab ${tab === k ? "on" : ""}`}
                onClick={() => setTab(k)}
              >
                {l}
              </button>
            ))}
          </div>
        </nav>

        {tab === "leagues" && (
          <>
            {!sel && (
              <section className="hero">
                <div className="herobanner">
                  <h1 className="big">
                    Win your <span>fantasy</span>
                    <br />
                    league.
                  </h1>
                  <p className="sub">
                    Rankings, rosters, standings and a trade calculator — synced live
                    from your real league. Built for Fantis.
                  </p>
                  <div className="card sync">
                    <div className="field">
                      <input
                        className="input"
                        placeholder="Sleeper username"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && sync()}
                      />
                      <select
                        className="select"
                        value={season}
                        onChange={(e) => setSeason(e.target.value)}
                      >
                        {SEASONS.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                      <button className="btn" onClick={sync} disabled={loading}>
                        {loading ? (
                          <>
                            <span className="spin" />
                            Syncing
                          </>
                        ) : (
                          "Sync league"
                        )}
                      </button>
                    </div>
                    <div className="plat">
                      <span className="chip live">
                        <span className="dot" /> Sleeper — live
                      </span>
                      <span className="chip">ESPN — coming soon</span>
                      <span className="chip">Yahoo — coming soon</span>
                    </div>
                    {error && <div className="err">{error}</div>}
                    <div className="hint">
                      Uses Sleeper&rsquo;s public API — no password, ~60 seconds.
                    </div>
                  </div>
                </div>
                <button className="proof" onClick={() => setTab("rankings")}>
                  <span className="prooflabel">Real rankings, right now</span>
                  <span className="proofplayers">
                    {PLAYERS.slice(0, 4).map((p) => (
                      <span className="proofpl" key={p.name} style={posChipStyle(p.pos)}>
                        {p.pos}
                        {p.posRank} {p.name}
                      </span>
                    ))}
                  </span>
                  <span className="proofgo">See full board →</span>
                </button>
              </section>
            )}

            {leagues.length > 0 && !sel && (
              <section className="sec">
                <div className="sechead">
                  <h2>Your leagues</h2>
                  <span className="rt">{leagues.length} found</span>
                </div>
                <div className="leagues">
                  {leagues.map((lg) => (
                    <button key={lg.league_id} className="lg" onClick={() => openLeague(lg)}>
                      <h3>{lg.name}</h3>
                      <small>
                        {lg.season} · {lg.total_rosters} teams · {lg.status}
                      </small>
                    </button>
                  ))}
                </div>
                {selLoading && (
                  <p className="hint">
                    <span className="spin" />
                    Loading rosters…
                  </p>
                )}
              </section>
            )}

            {sel && (
              <>
                <TeamHub bundle={sel} myUserId={myUserId} onNavigate={setTab} />
                <LeagueView bundle={sel} myUserId={myUserId} onBack={() => setSel(null)} />
                <div id="waivers-section">
                  <WaiverWire sel={sel} onGoToLeagues={() => setTab("leagues")} />
                </div>
              </>
            )}
            {selLoading && sel && (
              <p className="hint">
                <span className="spin" />
                Loading…
              </p>
            )}
          </>
        )}

        {tab === "rankings" && <Rankings />}
        {tab === "trade" && <Trade sel={sel} myUserId={myUserId} onNavigate={setTab} />}
        {tab === "startsit" && (
          <StartSit
            sel={sel}
            myUserId={myUserId}
            leagues={leagues}
            selLoading={selLoading}
            onSelectLeague={openLeague}
            onGoToLeagues={() => setTab("leagues")}
          />
        )}
        {tab === "portfolio" && (
          <Portfolio
            leagues={leagues}
            myUserId={myUserId}
            onGoToLeagues={() => setTab("leagues")}
            onOpenLeague={(lg) => {
              setTab("leagues");
              openLeague(lg);
            }}
          />
        )}
        <footer className="footer">
          Fantis MVP · league data via the Sleeper public API · rankings & values
          are an editable starter set, not investment advice. Swap them for your
          own feed anytime. Not affiliated with Sleeper, ESPN, or Yahoo.
        </footer>
      </div>
    </div>
  );
}
