import { NextResponse } from "next/server";

// Server-side proxy for nflverse's public injury-report data. No API key —
// this exists purely because GitHub's release-asset URLs don't send
// Access-Control-Allow-Origin, so a direct client fetch fails with a CORS
// error even though the data itself is free and public (confirmed by
// testing: works fine from Node, fails from the browser). Fetches +
// joins server-side, returns just the compact result.
const S = "https://github.com/nflverse/nflverse-data/releases/download";

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

interface WeeklyInjuryStatus {
  week: number;
  status: string;
  bodyPart: string | null;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const season = searchParams.get("season");
  if (!season) {
    return NextResponse.json({ error: "season is required" }, { status: 400 });
  }

  let crosswalkRes: Response, injuriesRes: Response;
  try {
    [crosswalkRes, injuriesRes] = await Promise.all([
      // Player id crosswalk (gsis_id -> espn_id) rarely changes; cache a day.
      fetch(`${S}/players/players.csv`, { next: { revalidate: 86400 } }),
      fetch(`${S}/injuries/injuries_${season}.csv`, { next: { revalidate: 86400 } }),
    ]);
  } catch {
    return NextResponse.json({ error: "Couldn't reach nflverse" }, { status: 502 });
  }

  if (!crosswalkRes.ok || !injuriesRes.ok) {
    return NextResponse.json({ error: "nflverse returned an error" }, { status: 502 });
  }

  const [crosswalkText, injuriesText] = await Promise.all([crosswalkRes.text(), injuriesRes.text()]);

  const crosswalkLines = crosswalkText.split("\n");
  const cwHeader = parseCsvLine(crosswalkLines[0]);
  const gsisIdx = cwHeader.indexOf("gsis_id");
  const espnIdx = cwHeader.indexOf("espn_id");
  const gsisToEspn: Record<string, string> = {};
  for (let i = 1; i < crosswalkLines.length; i++) {
    if (!crosswalkLines[i]) continue;
    const cols = parseCsvLine(crosswalkLines[i]);
    const gsis = cols[gsisIdx];
    const espn = cols[espnIdx];
    if (gsis && espn) gsisToEspn[gsis] = espn;
  }

  const injLines = injuriesText.split("\n");
  const injHeader = parseCsvLine(injLines[0]);
  const weekIdx = injHeader.indexOf("week");
  const injGsisIdx = injHeader.indexOf("gsis_id");
  const statusIdx = injHeader.indexOf("report_status");
  const bodyPartIdx = injHeader.indexOf("report_primary_injury");

  const map: Record<string, WeeklyInjuryStatus[]> = {};
  for (let i = 1; i < injLines.length; i++) {
    if (!injLines[i]) continue;
    const cols = parseCsvLine(injLines[i]);
    const gsis = cols[injGsisIdx];
    const status = cols[statusIdx];
    const week = Number(cols[weekIdx]);
    if (!gsis || !status || !week) continue;
    const espnId = gsisToEspn[gsis];
    if (!espnId) continue;
    if (!map[espnId]) map[espnId] = [];
    map[espnId].push({ week, status, bodyPart: cols[bodyPartIdx] || null });
  }

  return NextResponse.json({ injuries: map });
}
