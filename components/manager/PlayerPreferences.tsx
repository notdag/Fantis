"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { posChipStyle } from "@/lib/players";
import { savePrefs, type PlayerPrefs } from "@/lib/playerPrefs";
import { loadNotes, saveNote, type PlayerNotes } from "@/lib/playerNotes";
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

  // Notes have their own save lifecycle (one player at a time, via a
  // separate API) rather than the full-list replace the four lists above
  // use, so they're loaded/edited independently of `prefs`/`onChange`.
  const [notes, setNotes] = useState<PlayerNotes>({});
  const [notesLoaded, setNotesLoaded] = useState(false);
  const [notesError, setNotesError] = useState("");
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [noteSaving, setNoteSaving] = useState<string | null>(null);
  const [noteQuery, setNoteQuery] = useState("");
  useEffect(() => {
    let cancelled = false;
    loadNotes()
      .then((n) => { if (!cancelled) { setNotes(n); setNotesLoaded(true); } })
      .catch((e) => { if (!cancelled) setNotesError(e instanceof Error ? e.message : "Couldn't load notes."); });
    return () => {
      cancelled = true;
    };
  }, []);
  const draftFor = (id: string) => (id in noteDrafts ? noteDrafts[id] : (notes[id] ?? ""));
  const noteDirty = (id: string) => draftFor(id) !== (notes[id] ?? "");
  const commitNote = async (id: string) => {
    const text = draftFor(id).trim();
    setNoteSaving(id);
    setNotesError("");
    try {
      await saveNote(id, text);
      setNotes((prev) => {
        const next = { ...prev };
        if (text) next[id] = text;
        else delete next[id];
        return next;
      });
      setNoteDrafts((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } catch (e) {
      setNotesError(e instanceof Error ? e.message : "Couldn't save that note.");
    } finally {
      setNoteSaving(null);
    }
  };

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
    onChange({ priority: [...prefs.priority.filter((x) => x !== id), id], avoid: prefs.avoid.filter((x) => x !== id), irRelease: prefs.irRelease.filter((x) => x !== id), neverStart: prefs.neverStart.filter((x) => x !== id) });
  const addAvoid = (id: string) =>
    onChange({ priority: prefs.priority.filter((x) => x !== id), avoid: [...prefs.avoid.filter((x) => x !== id), id], irRelease: prefs.irRelease.filter((x) => x !== id), neverStart: prefs.neverStart.filter((x) => x !== id) });
  const addIrRelease = (id: string) =>
    onChange({ priority: prefs.priority.filter((x) => x !== id), avoid: prefs.avoid.filter((x) => x !== id), irRelease: [...prefs.irRelease.filter((x) => x !== id), id], neverStart: prefs.neverStart.filter((x) => x !== id) });
  const addNeverStart = (id: string) =>
    onChange({ priority: prefs.priority.filter((x) => x !== id), avoid: prefs.avoid.filter((x) => x !== id), irRelease: prefs.irRelease.filter((x) => x !== id), neverStart: [...prefs.neverStart.filter((x) => x !== id), id] });
  const move = (i: number, delta: number) => {
    const next = [...prefs.priority];
    const j = i + delta;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    onChange({ ...prefs, priority: next });
  };
  const moveIrRelease = (i: number, delta: number) => {
    const next = [...prefs.irRelease];
    const j = i + delta;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    onChange({ ...prefs, irRelease: next });
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
              <button className="btn ghost sm" onClick={() => { addIrRelease(p.id); setQuery(""); }}>+ IR Release</button>
              <button className="btn ghost sm" onClick={() => { addNeverStart(p.id); setQuery(""); }}>+ Never Start</button>
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

      <div style={{ marginTop: 16 }}>
        <SectionHead level={3} title="IR Release (only these can be dropped to make room on IR)" right={`${prefs.irRelease.length}`} style={{ marginBottom: 8 }} />
        <p className="hint" style={{ margin: "0 0 8px" }}>
          When a league&rsquo;s IR is full, the IR-opportunities scan will only ever
          suggest releasing someone from this list, in this order — never any
          other IR occupant. Leave empty for no restriction (the default: ranks
          every real IR occupant by value, as before).
        </p>
        {prefs.irRelease.length === 0 ? (
          <p className="hint">No restriction — search above to add players.</p>
        ) : (
          <DataTable>
            {prefs.irRelease.map((id, i) =>
              row(
                id,
                <>
                  <button className="btn ghost sm" disabled={i === 0} onClick={() => moveIrRelease(i, -1)} aria-label="Move up">↑</button>
                  <button className="btn ghost sm" disabled={i === prefs.irRelease.length - 1} onClick={() => moveIrRelease(i, 1)} aria-label="Move down">↓</button>
                  <button className="btn ghost sm" onClick={() => onChange({ ...prefs, irRelease: prefs.irRelease.filter((x) => x !== id) })}>Remove</button>
                </>,
                `${i + 1}.`
              )
            )}
          </DataTable>
        )}
      </div>

      <div style={{ marginTop: 16 }}>
        <SectionHead level={3} title="Never Start (hard exclude, every league)" right={`${prefs.neverStart.length}`} style={{ marginBottom: 8 }} />
        <p className="hint" style={{ margin: "0 0 8px" }}>
          A real standing rule, not just a preference — a player here is never proposed as a
          starter by Fix my lineups/Optimize, anywhere, even if nobody else is available for the
          slot (unlike Avoid, which still starts him as a last resort). Use it for &ldquo;move X
          away from my lineup&rdquo;-type calls.
        </p>
        {prefs.neverStart.length === 0 ? (
          <p className="hint">Nobody hard-excluded — search above to add someone.</p>
        ) : (
          <DataTable>
            {prefs.neverStart.map((id) =>
              row(
                id,
                <button className="btn ghost sm" onClick={() => onChange({ ...prefs, neverStart: prefs.neverStart.filter((x) => x !== id) })}>Remove</button>
              )
            )}
          </DataTable>
        )}
      </div>

      <div style={{ marginTop: 16 }}>
        <SectionHead level={3} title="Notes (free text, informational)" right={`${Object.keys(notes).length}`} style={{ marginBottom: 8 }} />
        <p className="hint" style={{ margin: "0 0 8px" }}>
          Anything worth remembering about a player — chat surfaces this alongside its own
          rationale when he comes up (IR moves, force-start, drops, etc.). Read-only context, never
          parsed or acted on automatically; for an actually-enforced rule, use Never Start above.
        </p>
        {notesError && <div className="err">{notesError}</div>}
        <div className="field" style={{ marginBottom: 8, alignItems: "center" }}>
          <input
            className="input"
            placeholder="Search a player to note…"
            value={noteQuery}
            onChange={(e) => setNoteQuery(e.target.value)}
            style={{ maxWidth: 280 }}
          />
        </div>
        {noteQuery.trim().length >= 2 && pmap && (
          <DataTable>
            {Object.entries(pmap)
              .filter(([, e]) => e.t && ["QB", "RB", "WR", "TE", "K", "DEF"].includes(e.p) && e.n.toLowerCase().includes(noteQuery.trim().toLowerCase()))
              .slice(0, 8)
              .map(([id, e]) => (
                <TableRow key={id}>
                  <PlayerAvatar playerId={id} pos={e.p} size={24} />
                  <span className="tname" style={{ flex: 1 }}>{e.n}</span>
                  <span className="pos" style={posChipStyle(e.p)}>{e.p}</span>
                  <button
                    className="btn ghost sm"
                    onClick={() => { setNoteDrafts((prev) => ({ ...prev, [id]: prev[id] ?? notes[id] ?? "" })); setNoteQuery(""); }}
                  >
                    + Note
                  </button>
                </TableRow>
              ))}
          </DataTable>
        )}
        {!notesLoaded ? (
          <p className="hint">Loading notes…</p>
        ) : Object.keys(notes).length === 0 && Object.keys(noteDrafts).length === 0 ? (
          <p className="hint">No notes yet — search above to add one.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {[...new Set([...Object.keys(notes), ...Object.keys(noteDrafts)])].map((id) => (
              <div key={id} className="card sync" style={{ maxWidth: "none" }}>
                <div className="field" style={{ alignItems: "center", marginBottom: 6 }}>
                  <PlayerAvatar playerId={id} pos={posOf(id)} size={24} />
                  <span className="tname" style={{ flex: 1 }}>{nameOf(id)}</span>
                  {posOf(id) && <span className="pos" style={posChipStyle(posOf(id)!)}>{posOf(id)}</span>}
                  <button
                    className="btn"
                    disabled={noteSaving === id || !noteDirty(id)}
                    onClick={() => void commitNote(id)}
                  >
                    {noteSaving === id ? "Saving…" : "Save"}
                  </button>
                  <button
                    className="btn ghost sm"
                    disabled={noteSaving === id}
                    onClick={() => {
                      if (notes[id]) {
                        setNoteDrafts((prev) => ({ ...prev, [id]: "" }));
                        void commitNote(id);
                      } else {
                        setNoteDrafts((prev) => {
                          const next = { ...prev };
                          delete next[id];
                          return next;
                        });
                      }
                    }}
                  >
                    Remove
                  </button>
                </div>
                <textarea
                  className="input"
                  style={{ width: "100%", minHeight: 60, resize: "vertical" }}
                  placeholder="e.g. nagging injury, don't trust his Thursday snap counts, always start him vs weak run D…"
                  value={draftFor(id)}
                  onChange={(e) => setNoteDrafts((prev) => ({ ...prev, [id]: e.target.value }))}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
