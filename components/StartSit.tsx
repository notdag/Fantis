"use client";

import { useEffect, useState } from "react";
import { posChipStyle } from "@/lib/players";
import { isRankedAdp } from "@/lib/sleeper";
import { useProjections } from "@/lib/useProjections";
import { pointsForScoring, scoringLabel, summarizeRosterPositions } from "@/lib/scoring";
import { buildStartingSlots, eligiblePositions, type StartingSlot } from "@/lib/rosterSlots";
import type { LeagueBundle, SleeperLeague } from "@/lib/types";

interface RosterPlayer {
  id: string;
  name: string;
  pos: string;
  team: string;
}

interface Stat {
  adp: number | null;
  proj: number | null;
}

export default function StartSit({
  sel,
  myUserId,
  leagues,
  selLoading,
  onSelectLeague,
  onGoToLeagues,
}: {
  sel: LeagueBundle | null;
  myUserId: string | null;
  leagues: SleeperLeague[];
  selLoading: boolean;
  onSelectLeague: (lg: SleeperLeague) => void;
  onGoToLeagues: () => void;
}) {
  const { projections, week, loading, error } = useProjections();
  const [assign, setAssign] = useState<Record<string, string | null>>({});

  // Starting slots depend on which league is selected — drop stale picks
  // from a previous league instead of leaving them dangling.
  useEffect(() => {
    const id = setTimeout(() => setAssign({}), 0);
    return () => clearTimeout(id);
  }, [sel?.lg.league_id]);

  const picker = leagues.length > 0 && (
    <div className="ssleaguepicker">
      <label htmlFor="ss-league">League</label>
      <select
        id="ss-league"
        className="select"
        value={sel?.lg.league_id ?? ""}
        onChange={(e) => {
          const lg = leagues.find((l) => l.league_id === e.target.value);
          if (lg) onSelectLeague(lg);
        }}
      >
        {!sel && <option value="">Choose a league…</option>}
        {leagues.map((lg) => (
          <option key={lg.league_id} value={lg.league_id}>
            {lg.name}
          </option>
        ))}
      </select>
      {selLoading && <span className="spin" />}
    </div>
  );

  if (leagues.length === 0) {
    return (
      <section className="sec">
        <div className="sechead">
          <h2>Start / Sit</h2>
        </div>
        <p className="hint">
          Fill your real starting lineup with your own roster — sync your
          Sleeper username first.
        </p>
        <button className="btn ghost sm" onClick={onGoToLeagues} style={{ marginTop: 10 }}>
          Go to Leagues →
        </button>
      </section>
    );
  }

  if (!sel) {
    return (
      <section className="sec">
        <div className="sechead">
          <h2>Start / Sit</h2>
        </div>
        {picker}
        <p className="hint" style={{ marginTop: 10 }}>
          Pick a league above to fill its starting lineup from your roster.
        </p>
      </section>
    );
  }

  const myTeam = sel.teams.find((t) => t.ownerId === myUserId);

  if (!myTeam) {
    return (
      <section className="sec">
        <div className="sechead">
          <h2>Start / Sit</h2>
        </div>
        {picker}
        <p className="hint" style={{ marginTop: 10 }}>
          Couldn&rsquo;t find your team in {sel.lg.name}.
        </p>
      </section>
    );
  }

  const roster: RosterPlayer[] = myTeam.players
    .map((id) => {
      const p = sel.pmap[id];
      return p ? { id, name: p.n, pos: p.p, team: p.t } : null;
    })
    .filter((p): p is RosterPlayer => p !== null)
    .sort((a, b) => a.name.localeCompare(b.name));

  const statFor = (id: string | null): Stat | null => {
    if (!id || !projections) return null;
    const p = projections[id];
    if (!p) return null;
    return {
      adp: isRankedAdp(p.adp_dd_ppr) ? Math.round(p.adp_dd_ppr) : null,
      proj: pointsForScoring(p, sel.scoringRec),
    };
  };

  const slots = buildStartingSlots(sel.rosterPositions);
  const usedIds = new Set(Object.values(assign).filter((v): v is string => v != null));
  const lineupTotal = slots.reduce((sum, s) => sum + (statFor(assign[s.key] ?? null)?.proj ?? 0), 0);
  const filledCount = slots.filter((s) => assign[s.key]).length;

  return (
    <section className="sec">
      <div className="sechead">
        <h2>Start / Sit</h2>
        <span className="rt">
          {myTeam.name}
          {week != null && ` · Week ${week} proj. via Sleeper`}
        </span>
      </div>
      {picker}
      <p className="hint" style={{ marginTop: 8 }}>
        {sel.lg.name} starts {summarizeRosterPositions(sel.rosterPositions) || "no lineup data"} ·{" "}
        {scoringLabel(sel.scoringRec)} scoring — pick who starts at each spot below.
      </p>
      {loading && <p className="hint">Loading live projections…</p>}
      {error && <p className="hint">{error}</p>}

      <div className="sslist">
        {slots.map((slot) => (
          <SlotRow
            key={slot.key}
            slot={slot}
            roster={roster}
            usedIds={usedIds}
            selectedId={assign[slot.key] ?? null}
            onSelect={(id) => setAssign((a) => ({ ...a, [slot.key]: id }))}
            onClear={() => setAssign((a) => ({ ...a, [slot.key]: null }))}
            statFor={statFor}
          />
        ))}
      </div>

      {slots.length > 0 && (
        <div className="sslineuptotal">
          <span>
            {filledCount}/{slots.length} spots filled
          </span>
          <span>
            Projected lineup total <b>{lineupTotal.toFixed(1)}</b>
          </span>
        </div>
      )}
    </section>
  );
}

const headshot = (id: string) => `https://sleepercdn.com/content/nfl/players/${id}.jpg`;
const hideOnError = (e: React.SyntheticEvent<HTMLImageElement>) => {
  e.currentTarget.style.visibility = "hidden";
};

function SlotRow({
  slot,
  roster,
  usedIds,
  selectedId,
  onSelect,
  onClear,
  statFor,
}: {
  slot: StartingSlot;
  roster: RosterPlayer[];
  usedIds: Set<string>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onClear: () => void;
  statFor: (id: string | null) => Stat | null;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const selected = roster.find((p) => p.id === selectedId) || null;
  const eligible = eligiblePositions(slot.code);
  const stat = statFor(selectedId);

  const candidates = roster
    .filter((p) => eligible.includes(p.pos) && (!usedIds.has(p.id) || p.id === selectedId))
    .filter((p) => q.trim().length < 1 || p.name.toLowerCase().includes(q.toLowerCase()));

  const pick = (id: string) => {
    onSelect(id);
    setQ("");
    setOpen(false);
  };

  return (
    <div className="ssslot">
      <button className="ssslothead" onClick={() => setOpen((o) => !o)}>
        {selected ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="ssavatar" src={headshot(selected.id)} alt="" onError={hideOnError} />
        ) : (
          <span className="ssavatar ssavatar-empty" />
        )}
        <span className="ssslotmain">
          <span className="ssslotlabel">{slot.label}</span>
          {selected ? (
            <span className="sspill" style={posChipStyle(selected.pos)}>
              {selected.name}
            </span>
          ) : (
            <span className="ssslotstatus">Not Decided</span>
          )}
          {selected && stat?.proj != null && (
            <span className="ssprojinline">Proj {stat.proj.toFixed(1)}</span>
          )}
        </span>
        {selected && (
          <span
            className="x"
            onClick={(e) => {
              e.stopPropagation();
              onClear();
              setOpen(true);
            }}
          >
            ✕
          </span>
        )}
        <span className={`chev ${open ? "open" : ""}`}>▼</span>
      </button>

      {open && (
        <div className="sspicker">
          <input
            className="input"
            placeholder={`Search ${eligible.join("/")}…`}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <div className="sscandrow">
            {candidates.length === 0 && (
              <div className="ssempty">No eligible players left on your roster</div>
            )}
            {candidates.map((p) => (
              <button className="sscand" key={p.id} onClick={() => pick(p.id)}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="sscandphoto" src={headshot(p.id)} alt="" onError={hideOnError} />
                <span className="pos" style={posChipStyle(p.pos)}>
                  {p.pos}
                </span>
                <span className="sscandname">{p.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
