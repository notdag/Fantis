"use client";

import { useMemo, useState, type ReactNode } from "react";
import { posChipStyle } from "@/lib/players";
import { savePrefs, type PlayerPrefs } from "@/lib/playerPrefs";
import type { PlayerMap } from "@/lib/types";
import { PlayerAvatar } from "./Avatar";
import { SectionHead } from "./PageHead";
import { DataTable, TableRow } from "./DataRow";

// The owner's own ranking, used by the Optimize tab: priority players start
// ahead of everyone else whenever healthy and eligible; avoid players only
// start if nobody else can fill the slot. Saved to the Fantis database so it
// follows the owner across browsers.
export default function PlayerPreferences({
  prefs,
  onChange,
  savedJson,
  onSaved,
  pmap,
}: {
  prefs: PlayerPrefs;
  onChange: (next: PlayerPrefs) => void;
  savedJson: string;
  onSaved: (json: string) => void;
  pmap: PlayerMap | null;
}) {
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const dirty = JSON.stringify(prefs) !== savedJson;

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!pmap || q.length < 2) return [];
    const out: { id: string; n: string; p: string; t: string }[] = [];
    for (const [id, e] of Object.entries(pmap)) {
      if (!e.t || !["QB", "RB", "WR", "TE", "K", "DEF"].includes(e.p)) continue;
      if (e.n.toLowerCase().includes(q)) out.push({ id, n: e.n, p: e.p, t: e.t });
      if (out.length >= 8) break;
    }
    return out;
  }, [pmap, query]);

  const nameOf = (id: string) => pmap?.[id]?.n ?? id;
  const posOf = (id: string) => pmap?.[id]?.p;

  const addPriority = (id: string) =>
    onChange({ priority: [...prefs.priority.filter((x) => x !== id), id], avoid: prefs.avoid.filter((x) => x !== id) });
  const addAvoid = (id: string) =>
    onChange({ priority: prefs.priority.filter((x) => x !== id), avoid: [...prefs.avoid.filter((x) => x !== id), id] });
  const move = (i: number, delta: number) => {
    const next = [...prefs.priority];
    const j = i + delta;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    onChange({ ...prefs, priority: next });
  };

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      await savePrefs(prefs);
      onSaved(JSON.stringify(prefs));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save.");
    } finally {
      setSaving(false);
    }
  };

  const row = (id: string, actions: ReactNode, prefix?: string) => (
    <TableRow key={id}>
      {prefix && <span className="portmeta" style={{ minWidth: 26 }}>{prefix}</span>}
      <PlayerAvatar playerId={id} pos={posOf(id)} size={24} />
      <span className="tname" style={{ flex: 1 }}>{nameOf(id)}</span>
      {posOf(id) && <span className="pos" style={posChipStyle(posOf(id)!)}>{posOf(id)}</span>}
      {actions}
    </TableRow>
  );

  if (!pmap) return <p className="hint">Loading players…</p>;

  return (
    <>
      <p className="hint" style={{ margin: "0 0 12px" }}>
        Rank the players you always want in your lineup, and list any you&rsquo;d rather keep on the
        bench. The <strong>Optimize</strong> tab follows this over raw projections: a healthy
        priority player starts ahead of a lower-ranked or unlisted one in any slot he&rsquo;s
        eligible for; an avoid player only starts if nobody else can fill the slot. Injured,
        bye-week and already-started players are never forced in. This applies to every league.
      </p>

      <div className="field" style={{ marginBottom: 8, alignItems: "center" }}>
        <input
          className="input"
          placeholder="Search a player to add…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ maxWidth: 280 }}
        />
        <span style={{ flex: 1 }} />
        {dirty && <span className="portmeta" style={{ color: "var(--amber)" }}>unsaved changes</span>}
        <button className="btn" disabled={!dirty || saving} onClick={save}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
      {error && <div className="err">{error}</div>}

      {results.length > 0 && (
        <DataTable>
          {results.map((p) => (
            <TableRow key={p.id}>
              <PlayerAvatar playerId={p.id} pos={p.p} size={24} />
              <span className="tname" style={{ flex: 1 }}>{p.n}</span>
              <span className="pos" style={posChipStyle(p.p)}>{p.p}</span>
              <span className="portmeta">{p.t}</span>
              <button className="btn ghost sm" onClick={() => { addPriority(p.id); setQuery(""); }}>+ Priority</button>
              <button className="btn ghost sm" onClick={() => { addAvoid(p.id); setQuery(""); }}>+ Avoid</button>
            </TableRow>
          ))}
        </DataTable>
      )}

      <div style={{ marginTop: 16 }}>
        <SectionHead level={3} title="Priority (start these first)" right={`${prefs.priority.length}`} style={{ marginBottom: 8 }} />
        {prefs.priority.length === 0 ? (
          <p className="hint">No priority players yet — search above to add some.</p>
        ) : (
          <DataTable>
            {prefs.priority.map((id, i) =>
              row(
                id,
                <>
                  <button className="btn ghost sm" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">↑</button>
                  <button className="btn ghost sm" disabled={i === prefs.priority.length - 1} onClick={() => move(i, 1)} aria-label="Move down">↓</button>
                  <button className="btn ghost sm" onClick={() => onChange({ ...prefs, priority: prefs.priority.filter((x) => x !== id) })}>Remove</button>
                </>,
                `${i + 1}.`
              )
            )}
          </DataTable>
        )}
      </div>

      <div style={{ marginTop: 16 }}>
        <SectionHead level={3} title="Avoid (bench unless nobody else can play)" right={`${prefs.avoid.length}`} style={{ marginBottom: 8 }} />
        {prefs.avoid.length === 0 ? (
          <p className="hint">Nobody on your avoid list.</p>
        ) : (
          <DataTable>
            {prefs.avoid.map((id) =>
              row(
                id,
                <button className="btn ghost sm" onClick={() => onChange({ ...prefs, avoid: prefs.avoid.filter((x) => x !== id) })}>Remove</button>
              )
            )}
          </DataTable>
        )}
      </div>
    </>
  );
}
