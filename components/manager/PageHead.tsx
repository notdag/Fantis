import type { CSSProperties, ReactNode } from "react";

// Componentized .mgrhead (page-top) and .sechead (per-section) — real CSS
// unchanged. Two real .mgrhead shapes found in the audit: plain
// title+description (most pages), and title+inline-right-slot with no
// description (LeagueIdentityBar's status chip/group editor, sitting on
// the h1's own line) — `right` selects between them rather than always
// rendering both slots.
export function PageHead({
  title,
  description,
  right,
}: {
  title: ReactNode;
  description?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="mgrhead">
      <div className="mgraccentbar" />
      {right ? (
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <h1>{title}</h1>
          <span style={{ display: "flex", alignItems: "center", gap: 10 }}>{right}</span>
        </div>
      ) : (
        <h1>{title}</h1>
      )}
      {description != null && <p>{description}</p>}
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
