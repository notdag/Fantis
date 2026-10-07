import type { CSSProperties, ReactNode } from "react";

// Page intro strip: description text only (2026-08b UI reset). Used to
// render a duplicate <h1> here — the real page title now lives once, in
// ManagerHeader's breadcrumb (promoted to a real <h1> there) — so this
// component no longer takes or renders a title at all. LeagueIdentityBar
// (the one real caller that also needed a `right` slot: status chip, team
// count, group editor) builds its own identity block directly instead of
// going through this component, since it now needs an avatar + team name
// too, not just a title-adjacent right-slot.
export function PageHead({ description }: { description?: ReactNode }) {
  if (description == null) return null;
  return (
    <div className="mgrhead">
      <p>{description}</p>
    </div>
  );
}

// Real usage never uses .sechead's own CSS default (24px) — every page
// already overrides to 18px (top-level) or 14px (ManagerDashboard's
// nested exception-group sub-headers) inline, so that's this component's
// real default rather than the unused CSS one. `right` as a plain string
// gets wrapped in the existing `.rt` meta-text class; pass a <Link>/
// <button> directly for the interactive right-slot cases (LeagueOverview's
// "View full X ->", ManagerDashboard's "Show N leagues" toggle).
export function SectionHead({
  title,
  right,
  level = 2,
  style,
}: {
  title: ReactNode;
  right?: ReactNode;
  level?: 2 | 3;
  style?: CSSProperties; // escape hatch — e.g. ManagerDashboard's nested exception-group headers use marginBottom:8 instead of .sechead's default 14px
}) {
  const Heading = level === 3 ? "h3" : "h2";
  const headingStyle = level === 3 ? { fontSize: 14, margin: 0 } : { fontSize: 18 };
  return (
    <div className="sechead" style={style}>
      <Heading style={headingStyle}>{title}</Heading>
      {right != null && (typeof right === "string" ? <span className="rt">{right}</span> : right)}
    </div>
  );
}
