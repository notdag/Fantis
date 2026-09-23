import type { ComponentType, ReactNode, SVGProps } from "react";

// Componentized .mgrstat/.mgrherorow/.mgrstats — real CSS unchanged (see
// app/manager/manager.css), this only replaces the hand-written JSX that
// was previously repeated across ~15 files. Every real usage (audited
// across the whole Sleeper Manager section before designing this) computes
// an icon's background from its own color via color-mix(...16%...), never
// independently — so `color` alone drives both. Not every card has an
// icon (MyTeams.tsx, ActionQueue.tsx render icon-less) — omit `icon`
// entirely rather than passing a blank one.
export function StatCardGrid({
  variant,
  children,
}: {
  variant: "hero" | "grid";
  children: ReactNode;
}) {
  return <div className={variant === "hero" ? "mgrherorow" : "mgrstats"}>{children}</div>;
}

export function StatCard({
  icon: Icon,
  color = "var(--bone)",
  label,
  value,
  valueColor,
  sub,
}: {
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
  color?: string;
  label: string;
  value: ReactNode;
  valueColor?: string;
  sub?: ReactNode;
}) {
  return (
    <div className="mgrstat">
      {Icon && (
        <div
          className="mgrstaticon"
          style={{ color, background: `color-mix(in srgb, ${color} 16%, transparent)` }}
        >
          <Icon width={17} height={17} />
        </div>
      )}
      <div className="mgrstatbody">
        <p className="mgrstatlabel">{label}</p>
        <p className="mgrstatvalue" style={valueColor ? { color: valueColor } : undefined}>
          {value}
        </p>
        {sub != null && <p className="mgrstatsub">{sub}</p>}
      </div>
    </div>
  );
}
