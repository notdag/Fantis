"use client";

// Generic clickable column header for sortable tables (Rankings, Waiver Wire).
// Click toggles direction when already active, switches column otherwise.
export default function SortHeader<K extends string>({
  label,
  sortKey,
  active,
  dir,
  onClick,
}: {
  label: string;
  sortKey: K;
  active: K;
  dir: "asc" | "desc";
  onClick: (key: K) => void;
}) {
  const isOn = active === sortKey;
  return (
    <button className={`sorth ${isOn ? "on" : ""}`} onClick={() => onClick(sortKey)}>
      {label}
      {isOn && <span className="arrow">{dir === "asc" ? "↑" : "↓"}</span>}
    </button>
  );
}
