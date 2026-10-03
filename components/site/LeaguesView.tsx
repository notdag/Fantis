"use client";

import Link from "next/link";
import { posChipStyle } from "@/lib/players";
import { usePlayers } from "@/lib/usePlayers";
import { useSite } from "@/components/SiteShell";
import LeagueView from "@/components/LeagueView";
import TeamHub from "@/components/TeamHub";
import WaiverWire from "@/components/WaiverWire";
import PixelLoader from "@/components/PixelLoader";

// The /leagues page (also the home page): sync a Sleeper username, pick a league, see its
// team hub, standings and waiver wire. All the state lives in <SiteShell> so it survives
// moving to the other tabs.
export default function LeaguesView() {
  const PLAYERS = usePlayers();
  const {
    username, setUsername, season, setSeason, seasons, loading, error, leagues,
    sel, setSel, selLoading, myUserId, sync, openLeague, go,
  } = useSite();

  return (
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
                <select className="select" value={season} onChange={(e) => setSeason(e.target.value)}>
                  {seasons.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <button className="btn" onClick={sync} disabled={loading}>
                  {loading ? <PixelLoader label="Syncing" tone="onAccent" /> : "Sync league"}
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
              <div className="hint">Uses Sleeper&rsquo;s public API — no password, ~60 seconds.</div>
            </div>
          </div>
          <Link href="/rankings" className="proof" style={{ textDecoration: "none", color: "inherit" }}>
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
          </Link>
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
          <TeamHub bundle={sel} myUserId={myUserId} onNavigate={go} />
          <LeagueView bundle={sel} myUserId={myUserId} onBack={() => setSel(null)} />
          <div id="waivers-section">
            <WaiverWire sel={sel} onGoToLeagues={() => go("leagues")} />
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
  );
}
