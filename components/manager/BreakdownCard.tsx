import type { ComponentType, ReactNode, SVGProps } from "react";

// Larger sibling to StatCard — an icon + one-line real summary up top, then
// a divider and a label/value breakdown list underneath. Used by My
// Portfolio's three overview cards (Playoff Outlook, Record Snapshot,
// Positional Depth), each of which has real sub-counts worth showing at a
// glance rather than only in the tier-filter pills below.
export function BreakdownCardGrid({ children }: { children: ReactNode }) {
  return <div className="mgrbreakdowngrid">{children}</div>;
}

export function BreakdownCard({
  icon: Icon,
  color,
  label,
  description,
  rows,
}: {
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  color: string;
  label: string;
  description: ReactNode;
  rows: { label: string; value: ReactNode }[];
}) {
  return (
    <div className="mgrbreakdowncard">
      <div className="mgrbreakdownhead">
        <div
          className="mgrbreakdownicon"
          style={{ color, background: `color-mix(in srgb, ${color} 16%, transparent)` }}
        >
          <Icon width={19} height={19} />
        </div>
        <div className="mgrbreakdowntext">
          <p className="mgrbreakdownlabel">{label}</p>
          <p className="mgrbreakdowndesc">{description}</p>
        </div>
      </div>
      <div className="mgrbreakdownrows">
        {rows.map((r) => (
          <div className="mgrbreakdownrow" key={r.label}>
            <span>{r.label}</span>
            <span>{r.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
