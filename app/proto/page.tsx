import Link from "next/link";

export default function ProtoIndex() {
  return (
    <main style={{ minHeight: "100vh", background: "#0b0d12", color: "#eef0f3", fontFamily: "system-ui, sans-serif", padding: "48px 24px" }}>
      <h1 style={{ fontSize: 22, margin: "0 0 6px" }}>Fantis redesign prototypes</h1>
      <p style={{ color: "#939aa6", margin: "0 0 24px" }}>Two directions on your real league data. Nothing here sends anything to Sleeper.</p>
      <ul style={{ display: "grid", gap: 12, padding: 0, listStyle: "none", maxWidth: 520 }}>
        <li><Link href="/proto/combo" style={{ color: "#ffb020", fontWeight: 700 }}>G — Command (StatChasers + This Week + Triage) →</Link></li>
        <li><Link href="/proto/statchasers" style={{ color: "#ffb020" }}>A — StatChasers style →</Link></li>
        <li><Link href="/proto/sports" style={{ color: "#ffb020" }}>C — The Sports Page (newspaper sports section) →</Link></li>
        <li><Link href="/proto/triage" style={{ color: "#ffb020" }}>D — Triage (one problem at a time) →</Link></li>
        <li><Link href="/proto/week" style={{ color: "#ffb020" }}>E — This Week (decisions by lock time) →</Link></li>
        <li><Link href="/proto/panels" style={{ color: "#ffb020" }}>F — Panels (one workspace, three panels) →</Link></li>
        <li><Link href="/manager" style={{ color: "#939aa6" }}>Back to the current Command Center</Link></li>
      </ul>
    </main>
  );
}
