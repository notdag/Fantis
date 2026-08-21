import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

// Componentized .mgrtable/.mgrrow — real CSS unchanged. Row *content* stays
// exactly what each page already renders (avatars, chips, meta text); this
// only centralizes the outer element choice (real usages found: Link,
// button, label wrapping a real checkbox, and static div) and the
// highlight-the-current-user background that LeagueOverview/LeagueStandings
// both hand-rolled identically before this existed.
export function DataTable({ children }: { children: ReactNode }) {
  return <div className="mgrtable">{children}</div>;
}

const HIGHLIGHT_STYLE = { background: "color-mix(in srgb, var(--amber) 10%, transparent)" };

type TableRowBase = { highlight?: boolean; style?: CSSProperties; children: ReactNode };
type TableRowProps =
  | (TableRowBase & { as: "link"; href: string })
  | (TableRowBase & { as: "button"; onClick: () => void })
  | (TableRowBase & { as: "label" })
  | (TableRowBase & { as?: "static" });

export function TableRow(props: TableRowProps) {
  const style = props.highlight ? { ...HIGHLIGHT_STYLE, ...props.style } : props.style;

  if (props.as === "link") {
    return (
      <Link href={props.href} className="mgrrow" style={style}>
        {props.children}
      </Link>
    );
  }
  if (props.as === "button") {
    return (
      <button type="button" className="mgrrow" onClick={props.onClick} style={style}>
        {props.children}
      </button>
    );
  }
  if (props.as === "label") {
    return (
      <label className="mgrrow" style={style}>
        {props.children}
      </label>
    );
  }
  return (
    <div className="mgrrow static" style={style}>
      {props.children}
    </div>
  );
}
