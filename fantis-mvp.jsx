import React, { useState, useEffect, useMemo, useCallback } from "react";

/* =========================================================================
   FLOCK — Fantasy Football MVP
   - Sleeper league sync (public API, no auth, works client-side)
   - League dashboard: scoreboard standings + rosters
   - Rankings table (editable starter dataset)
   - Trade calculator with a tilting "verdict" bar
   ESPN / Yahoo require a backend (OAuth), so they're marked "coming soon".
   ========================================================================= */

/* ---------- Design tokens (broadcast / scoreboard identity) ---------- */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700;800&family=Inter:wght@400;500;600;700&display=swap');

:root{
  --ink:#0B1220; --ink2:#111C30; --panel:#0F1A2B; --line:#22304A;
  --bone:#EAF0F7; --muted:#8A9BB5; --dim:#61718C;
  --amber:#FFB020; --mint:#37E0B0; --red:#FF5D5D; --sky:#35B6F0;
  --qb:#F2545B; --rb:#37C978; --wr:#35B6F0; --te:#F5A742; --oth:#7C8AA5;
}
*{box-sizing:border-box}
.flock{
  font-family:'Inter',system-ui,sans-serif; color:var(--bone);
  background:
    radial-gradient(1200px 600px at 80% -10%, rgba(255,176,32,.10), transparent 60%),
    radial-gradient(900px 500px at 0% 0%, rgba(55,224,176,.08), transparent 55%),
    var(--ink);
  min-height:100vh; letter-spacing:.005em;
}
.wrap{max-width:1120px;margin:0 auto;padding:0 20px}
.cond{font-family:'Barlow Condensed',system-ui,sans-serif;letter-spacing:.01em}
.num{font-variant-numeric:tabular-nums}

/* nav */
.nav{display:flex;align-items:center;justify-content:space-between;
  padding:18px 0;border-bottom:1px solid var(--line)}
.brand{display:flex;align-items:center;gap:10px}
.mark{width:34px;height:34px;border-radius:9px;display:grid;place-items:center;
  background:linear-gradient(135deg,var(--amber),#ff7a00);color:#1a1204;font-weight:800}
.brand b{font-family:'Barlow Condensed';font-size:24px;letter-spacing:.06em;text-transform:uppercase}
.tabs{display:flex;gap:4px;background:var(--ink2);padding:4px;border-radius:12px;border:1px solid var(--line)}
.tab{appearance:none;border:0;background:transparent;color:var(--muted);cursor:pointer;
  font-family:'Barlow Condensed';font-size:16px;text-transform:uppercase;letter-spacing:.05em;
  padding:8px 14px;border-radius:9px;font-weight:600}
.tab.on{background:var(--amber);color:#1a1204}
.tab:hover:not(.on){color:var(--bone)}

/* hero */
.hero{padding:64px 0 40px}
.eyebrow{display:inline-flex;align-items:center;gap:8px;color:var(--mint);
  font-family:'Barlow Condensed';font-size:15px;text-transform:uppercase;letter-spacing:.18em}
.dot{width:8px;height:8px;border-radius:50%;background:var(--mint);box-shadow:0 0 0 0 rgba(55,224,176,.6);animation:pulse 1.8s infinite}
@keyframes pulse{0%{box-shadow:0 0 0 0 rgba(55,224,176,.5)}70%{box-shadow:0 0 0 9px rgba(55,224,176,0)}100%{box-shadow:0 0 0 0 rgba(55,224,176,0)}}
h1.big{font-family:'Barlow Condensed';font-weight:800;font-size:clamp(44px,7vw,88px);
  line-height:.92;text-transform:uppercase;margin:16px 0 0}
h1.big span{color:var(--amber)}
.sub{color:var(--muted);font-size:18px;max-width:560px;margin:18px 0 28px;line-height:1.5}

/* sync card */
.card{background:linear-gradient(180deg,var(--ink2),var(--panel));
  border:1px solid var(--line);border-radius:16px}
.sync{padding:22px;max-width:560px}
.field{display:flex;gap:10px;flex-wrap:wrap}
.input{flex:1;min-width:180px;background:var(--ink);border:1px solid var(--line);color:var(--bone);
  border-radius:11px;padding:13px 14px;font-size:16px;outline:none}
.input:focus{border-color:var(--amber)}
.select{background:var(--ink);border:1px solid var(--line);color:var(--bone);border-radius:11px;padding:13px 12px;font-size:15px}
.btn{appearance:none;border:0;cursor:pointer;border-radius:11px;font-family:'Barlow Condensed';
  font-weight:700;font-size:17px;text-transform:uppercase;letter-spacing:.05em;padding:13px 22px;
  background:var(--amber);color:#1a1204}
.btn:hover{filter:brightness(1.06)}
.btn:disabled{opacity:.5;cursor:default}
.btn.ghost{background:transparent;color:var(--bone);border:1px solid var(--line)}
.btn.sm{padding:8px 12px;font-size:14px}
.plat{display:flex;gap:8px;margin-top:14px;flex-wrap:wrap}
.chip{font-size:12px;color:var(--muted);border:1px solid var(--line);border-radius:999px;padding:5px 11px}
.chip.live{color:var(--mint);border-color:rgba(55,224,176,.4)}
.err{color:var(--red);margin-top:12px;font-size:14px}
.hint{color:var(--dim);font-size:13px;margin-top:10px}

/* section */
.sec{padding:34px 0}
.sechead{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:16px;gap:12px;flex-wrap:wrap}
.sechead h2{font-family:'Barlow Condensed';font-weight:700;font-size:30px;text-transform:uppercase;margin:0;letter-spacing:.02em}
.sechead .rt{color:var(--muted);font-size:14px}

/* league list */
.leagues{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px}
.lg{background:var(--ink2);border:1px solid var(--line);border-radius:13px;padding:16px;cursor:pointer;text-align:left}
.lg:hover{border-color:var(--amber)}
.lg.on{border-color:var(--amber);box-shadow:0 0 0 1px var(--amber) inset}
.lg h3{margin:0 0 6px;font-size:16px}
.lg small{color:var(--muted)}

/* scoreboard table */
.board{background:var(--panel);border:1px solid var(--line);border-radius:14px;overflow:hidden}
.row{display:grid;align-items:center;border-top:1px solid var(--line)}
.stand{grid-template-columns:44px 1fr 70px 70px 92px}
.row.head{border-top:0;background:var(--ink2);color:var(--muted);font-family:'Barlow Condensed';
  text-transform:uppercase;letter-spacing:.08em;font-size:13px}
.cell{padding:13px 14px;font-size:15px}
.cell.r{text-align:right}
.rank{font-family:'Barlow Condensed';font-weight:800;font-size:20px;color:var(--dim);text-align:center}
.rank.top{color:var(--amber)}
.team{display:flex;align-items:center;gap:11px;min-width:0}
.ava{width:30px;height:30px;border-radius:8px;background:var(--ink);flex:none;object-fit:cover;border:1px solid var(--line)}
.tname{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:600}
.pts{font-family:'Barlow Condensed';font-weight:700}

/* roster grid */
.rosters{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px}
.rteam{background:var(--panel);border:1px solid var(--line);border-radius:14px;overflow:hidden}
.rteam header{display:flex;align-items:center;gap:10px;padding:12px 14px;background:var(--ink2);border-bottom:1px solid var(--line)}
.rteam header b{font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rteam header .rec{margin-left:auto;color:var(--muted);font-size:13px;font-family:'Barlow Condensed'}
.pl{display:flex;align-items:center;gap:10px;padding:9px 14px;border-top:1px solid rgba(34,48,74,.6);font-size:14px}
.pos{font-family:'Barlow Condensed';font-weight:800;font-size:12px;width:30px;text-align:center;
  border-radius:6px;padding:3px 0;color:#0b1220}
.plname{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.plteam{margin-left:auto;color:var(--dim);font-size:12px}
.divlbl{font-family:'Barlow Condensed';text-transform:uppercase;letter-spacing:.1em;font-size:11px;
  color:var(--dim);padding:8px 14px 2px}

/* rankings */
.filters{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px}
.rk{grid-template-columns:52px 1fr 64px 96px}
.tier{width:8px;height:8px;border-radius:50%;display:inline-block;margin-right:8px}
.val{font-family:'Barlow Condensed';font-weight:800;font-size:18px}

/* trade calculator */
.trade{display:grid;grid-template-columns:1fr auto 1fr;gap:16px;align-items:start}
@media(max-width:760px){.trade{grid-template-columns:1fr}}
.side{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:16px;min-height:120px}
.side h4{margin:0 0 12px;font-family:'Barlow Condensed';text-transform:uppercase;letter-spacing:.05em;font-size:18px}
.picked{display:flex;align-items:center;gap:8px;background:var(--ink2);border:1px solid var(--line);
  border-radius:9px;padding:8px 10px;margin-bottom:8px}
.picked .val{margin-left:auto;color:var(--mint)}
.x{cursor:pointer;color:var(--dim);border:0;background:0;font-size:16px;padding:0 2px}
.x:hover{color:var(--red)}
.search{position:relative}
.results{position:absolute;z-index:5;left:0;right:0;top:46px;background:var(--ink2);
  border:1px solid var(--line);border-radius:11px;max-height:230px;overflow:auto}
.res{display:flex;align-items:center;gap:8px;padding:9px 11px;cursor:pointer;font-size:14px}
.res:hover{background:var(--ink)}
.sum{font-family:'Barlow Condensed';font-weight:800;font-size:34px;margin-top:12px}
.verdict{margin:8px 0 0}
.vbar{height:14px;border-radius:999px;background:var(--ink2);border:1px solid var(--line);overflow:hidden;display:flex}
.vfill{height:100%;transition:width .5s cubic-bezier(.2,.8,.2,1)}
.vlabel{text-align:center;margin-top:14px;font-family:'Barlow Condensed';font-size:22px;text-transform:uppercase;letter-spacing:.03em}

.footer{border-top:1px solid var(--line);padding:26px 0 40px;color:var(--dim);font-size:13px;margin-top:20px}
.spin{width:18px;height:18px;border:2px solid rgba(255,255,255,.25);border-top-color:var(--amber);
  border-radius:50%;display:inline-block;animation:sp .7s linear infinite;vertical-align:-3px;margin-right:8px}
@keyframes sp{to{transform:rotate(360deg)}}
a.link{color:var(--amber);text-decoration:none}
a.link:hover{text-decoration:underline}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
`;

/* ---------- Starter rankings / trade values (edit or replace freely) ----------
   value = 0–100 redraft-ish PPR scale. Swap in your own numbers or feed. */
const PLAYERS = [
  ["Ja'Marr Chase","WR","CIN",99,1],["Bijan Robinson","RB","ATL",97,1],["CeeDee Lamb","WR","DAL",95,1],
  ["Saquon Barkley","RB","PHI",95,1],["Jahmyr Gibbs","RB","DET",94,1],["Justin Jefferson","WR","MIN",93,1],
  ["Amon-Ra St. Brown","WR","DET",91,1],["Christian McCaffrey","RB","SF",90,1],["Puka Nacua","WR","LAR",89,1],
  ["Malik Nabers","WR","NYG",88,2],["De'Von Achane","RB","MIA",87,2],["Nico Collins","WR","HOU",86,2],
  ["Ashton Jeanty","RB","LV",85,2],["Brian Thomas Jr.","WR","JAX",84,2],["Derrick Henry","RB","BAL",83,2],
  ["Drake London","WR","ATL",82,2],["A.J. Brown","WR","PHI",81,2],["Josh Jacobs","RB","GB",80,2],
  ["Jonathan Taylor","RB","IND",79,2],["Brock Bowers","TE","LV",79,2],["Bucky Irving","RB","TB",78,3],
  ["Ladd McConkey","WR","LAC",77,3],["Kyren Williams","RB","LAR",76,3],["Tee Higgins","WR","CIN",76,3],
  ["Chase Brown","RB","CIN",75,3],["Garrett Wilson","WR","NYJ",75,3],["Marvin Harrison Jr.","WR","ARI",74,3],
  ["Jaxon Smith-Njigba","WR","SEA",74,3],["Kenneth Walker III","RB","SEA",73,3],["Davante Adams","WR","LAR",72,3],
  ["Terry McLaurin","WR","WAS",72,3],["Trey McBride","TE","ARI",71,3],["George Kittle","TE","SF",70,3],
  ["James Cook","RB","BUF",70,3],["Mike Evans","WR","TB",69,4],["DK Metcalf","WR","PIT",68,4],
  ["DJ Moore","WR","CHI",67,4],["Breece Hall","RB","NYJ",67,4],["Josh Allen","QB","BUF",95,1],
  ["Lamar Jackson","QB","BAL",94,1],["Jayden Daniels","QB","WAS",90,1],["Jalen Hurts","QB","PHI",88,2],
  ["Joe Burrow","QB","CIN",87,2],["Patrick Mahomes","QB","KC",84,2],["Baker Mayfield","QB","TB",80,3],
  ["Bo Nix","QB","DEN",78,3],["Kyler Murray","QB","ARI",76,3],["Brock Purdy","QB","SF",73,3],
  ["Caleb Williams","QB","CHI",70,3],["Jordan Love","QB","GB",72,3],["Justin Herbert","QB","LAC",71,3],
  ["Alvin Kamara","RB","NO",66,4],["Chuba Hubbard","RB","CAR",65,4],["Aaron Jones","RB","MIN",63,4],
  ["Joe Mixon","RB","HOU",63,4],["David Montgomery","RB","DET",62,4],["Tony Pollard","RB","TEN",60,4],
  ["Rhamondre Stevenson","RB","NE",56,5],["Zamir White","RB","LV",50,5],["Najee Harris","RB","LAC",58,5],
  ["Jaylen Waddle","WR","MIA",66,4],["Amari Cooper","WR","BUF",58,5],["Chris Olave","WR","NO",64,4],
  ["Zay Flowers","WR","BAL",65,4],["Courtland Sutton","WR","DEN",63,4],["Jordan Addison","WR","MIN",62,4],
  ["Jerry Jeudy","WR","CLE",60,4],["Rome Odunze","WR","CHI",59,5],["Xavier Worthy","WR","KC",61,4],
  ["Keon Coleman","WR","BUF",52,5],["Jameson Williams","WR","DET",60,4],["Calvin Ridley","WR","TEN",55,5],
  ["Stefon Diggs","WR","NE",53,5],["Cooper Kupp","WR","SEA",57,5],["Deebo Samuel","WR","WAS",56,5],
  ["Sam LaPorta","TE","DET",64,4],["Mark Andrews","TE","BAL",58,5],["Travis Kelce","TE","KC",57,5],
  ["T.J. Hockenson","TE","MIN",55,5],["David Njoku","TE","CLE",54,5],["Dallas Goedert","TE","PHI",48,6],
  ["Jonnu Smith","TE","MIA",46,6],["Evan Engram","TE","DEN",47,6],["Dalton Kincaid","TE","BUF",50,5],
  ["Jayden Reed","WR","GB",54,5],["Khalil Shakir","WR","BUF",52,5],["Jakobi Meyers","WR","LV",50,5],
  ["Jauan Jennings","WR","SF",47,6],["DeVonta Smith","WR","PHI",61,4],["Tank Bigsby","RB","JAX",44,6],
  ["Tyrone Tracy Jr.","RB","NYG",48,6],["Jaylen Warren","RB","PIT",49,6],["Brian Robinson Jr.","RB","WAS",50,5],
  ["Isiah Pacheco","RB","KC",58,5],["Travis Etienne Jr.","RB","JAX",52,5],["D'Andre Swift","RB","CHI",51,5],
  ["Rachaad White","RB","TB",50,5],["Javonte Williams","RB","DAL",42,6],["Jordan Mason","RB","MIN",45,6],
  ["Tyreek Hill","WR","MIA",70,3],["Ricky Pearsall","WR","SF",46,6],["Jayden Higgins","WR","HOU",44,6],
  ["Travis Hunter","WR","JAX",56,5],["Tetairoa McMillan","WR","CAR",55,5],["Matthew Golden","WR","GB",48,6],
  ["Omarion Hampton","RB","LAC",62,4],["TreVeyon Henderson","RB","NE",58,5],["Quinshon Judkins","RB","CLE",57,5],
  ["Kaleb Johnson","RB","PIT",50,5],["RJ Harvey","RB","DEN",49,6],["Cam Ward","QB","TEN",55,5],
  ["Dak Prescott","QB","DAL",68,4],["Trevor Lawrence","QB","JAX",60,4],["Drake Maye","QB","NE",62,4],
  ["C.J. Stroud","QB","HOU",66,4],["Anthony Richardson","QB","IND",55,5],["Michael Penix Jr.","QB","ATL",54,5],
].map(([name,pos,team,value,tier])=>({name,pos,team,value,tier}));

const POS_COLOR={QB:"var(--qb)",RB:"var(--rb)",WR:"var(--wr)",TE:"var(--te)",K:"var(--oth)",DEF:"var(--oth)"};
const TIER_COLOR=["#37E0B0","#FFB020","#35B6F0","#F5A742","#B18CFF","#8A9BB5"];
const SEASONS=["2026","2025","2024"];

/* ---------- Sleeper API (public, read-only, CORS-open) ---------- */
const S="https://api.sleeper.app/v1";
async function jget(url){const r=await fetch(url);if(!r.ok)throw new Error(`${r.status}`);return r.json();}
const getUser=(u)=>jget(`${S}/user/${encodeURIComponent(u)}`);
const getLeagues=(id,season)=>jget(`${S}/user/${id}/leagues/nfl/${season}`);
const getLeague=(id)=>jget(`${S}/league/${id}`);
const getRosters=(id)=>jget(`${S}/league/${id}/rosters`);
const getLeagueUsers=(id)=>jget(`${S}/league/${id}/users`);

async function getPlayers(){
  const key="flock_players_nfl_v1";
  try{const c=await window.storage.get(key);if(c&&c.value){const d=JSON.parse(c.value);if(d.day===today())return d.map;}}catch(e){}
  const raw=await jget(`${S}/players/nfl`);
  const map={};
  for(const id in raw){const p=raw[id];if(!p)continue;
    map[id]={n:p.full_name||`${p.first_name||""} ${p.last_name||""}`.trim()||id,p:p.position||"",t:p.team||""};}
  try{await window.storage.set(key,JSON.stringify({day:today(),map}));}catch(e){}
  return map;
}
const today=()=>new Date().toISOString().slice(0,10);
const avatar=(id)=>id?`https://sleepercdn.com/avatars/thumbs/${id}`:null;

/* ================================ APP ================================ */
export default function App(){
  const [tab,setTab]=useState("leagues");
  const [username,setUsername]=useState("");
  const [season,setSeason]=useState("2026");
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState("");
  const [leagues,setLeagues]=useState([]);
  const [players,setPlayers]=useState(null);
  const [sel,setSel]=useState(null);        // selected league detail bundle
  const [selLoading,setSelLoading]=useState(false);

  const sync=useCallback(async()=>{
    const u=username.trim();
    if(!u){setError("Enter your Sleeper username first.");return;}
    setError("");setLoading(true);setLeagues([]);setSel(null);
    try{
      const user=await getUser(u);
      if(!user||!user.user_id)throw new Error("not found");
      let lgs=await getLeagues(user.user_id,season);
      if((!lgs||!lgs.length)&&season==="2026"){lgs=await getLeagues(user.user_id,"2025");}
      if(!lgs||!lgs.length){setError(`No NFL leagues found for ${u} in ${season}. Try another season.`);}
      setLeagues(lgs||[]);
    }catch(e){
      setError(`Couldn't reach Sleeper for "${u}". Check the username and try again.`);
    }finally{setLoading(false);}
  },[username,season]);

  const openLeague=useCallback(async(lg)=>{
    setSelLoading(true);setError("");
    try{
      const [rosters,users,pmap]=await Promise.all([
        getRosters(lg.league_id),getLeagueUsers(lg.league_id),players?Promise.resolve(players):getPlayers()
      ]);
      if(!players)setPlayers(pmap);
      const uById={};users.forEach(x=>uById[x.user_id]=x);
      const teams=rosters.map(r=>{
        const owner=uById[r.owner_id]||{};
        const meta=owner.metadata||{};
        const s=r.settings||{};
        return {
          rid:r.roster_id,
          name:meta.team_name||owner.display_name||`Team ${r.roster_id}`,
          avatar:avatar(owner.avatar),
          w:s.wins||0,l:s.losses||0,t:s.ties||0,
          pf:(s.fpts||0)+((s.fpts_decimal||0)/100),
          starters:r.starters||[],players:r.players||[],
        };
      }).sort((a,b)=> b.w-a.w || b.pf-a.pf);
      setSel({lg,teams,pmap:players||pmap});
      setTab("leagues");
    }catch(e){setError("Couldn't load that league's rosters. Try again in a moment.");}
    finally{setSelLoading(false);}
  },[players]);

  return (
    <div className="flock">
      <style>{CSS}</style>
      <div className="wrap">

        <nav className="nav">
          <div className="brand"><div className="mark">F</div><b>Flock</b></div>
          <div className="tabs">
            {[["leagues","Leagues"],["rankings","Rankings"],["trade","Trade"]].map(([k,l])=>(
              <button key={k} className={`tab ${tab===k?"on":""}`} onClick={()=>setTab(k)}>{l}</button>
            ))}
          </div>
        </nav>

        {tab==="leagues" && (
          <>
            {!sel && (
              <section className="hero">
                <span className="eyebrow"><span className="dot"/> Link your league in 60 seconds</span>
                <h1 className="big">Win your <span>fantasy</span><br/>league.</h1>
                <p className="sub">Rankings, rosters, standings and a trade calculator — synced live from your real league. Built for the Flock.</p>
                <div className="card sync">
                  <div className="field">
                    <input className="input" placeholder="Sleeper username"
                      value={username} onChange={e=>setUsername(e.target.value)}
                      onKeyDown={e=>e.key==="Enter"&&sync()} />
                    <select className="select" value={season} onChange={e=>setSeason(e.target.value)}>
                      {SEASONS.map(s=><option key={s} value={s}>{s}</option>)}
                    </select>
                    <button className="btn" onClick={sync} disabled={loading}>
                      {loading?<><span className="spin"/>Syncing</>:"Sync league"}
                    </button>
                  </div>
                  <div className="plat">
                    <span className="chip live">● Sleeper — live</span>
                    <span className="chip">ESPN — coming soon</span>
                    <span className="chip">Yahoo — coming soon</span>
                  </div>
                  {error && <div className="err">{error}</div>}
                  <div className="hint">Uses Sleeper's public API. No password needed — just your username.</div>
                </div>
              </section>
            )}

            {leagues.length>0 && !sel && (
              <section className="sec">
                <div className="sechead"><h2>Your leagues</h2><span className="rt">{leagues.length} found</span></div>
                <div className="leagues">
                  {leagues.map(lg=>(
                    <button key={lg.league_id} className="lg" onClick={()=>openLeague(lg)}>
                      <h3>{lg.name}</h3>
                      <small>{lg.season} · {lg.total_rosters} teams · {lg.status}</small>
                    </button>
                  ))}
                </div>
                {selLoading && <p className="hint"><span className="spin"/>Loading rosters…</p>}
              </section>
            )}

            {sel && <LeagueView bundle={sel} onBack={()=>setSel(null)} />}
            {selLoading && sel && <p className="hint"><span className="spin"/>Loading…</p>}
          </>
        )}

        {tab==="rankings" && <Rankings/>}
        {tab==="trade" && <Trade/>}

        <footer className="footer">
          Flock MVP · league data via the Sleeper public API · rankings & values are an editable starter set, not investment advice.
          Swap them for your own feed anytime. Not affiliated with Sleeper, ESPN, or Yahoo.
        </footer>
      </div>
    </div>
  );
}

/* ---------- League dashboard: standings + rosters ---------- */
function LeagueView({bundle,onBack}){
  const {lg,teams,pmap}=bundle;
  const name=(id)=>{const p=pmap[id];return p?p.n:id;};
  const posOf=(id)=>{const p=pmap[id];return p?p.p:"";};
  const teamOf=(id)=>{const p=pmap[id];return p?p.t:"";};
  return (
    <>
      <section className="sec">
        <div className="sechead">
          <h2>{lg.name}</h2>
          <button className="btn ghost sm" onClick={onBack}>← All leagues</button>
        </div>
        <div className="board">
          <div className="row stand head">
            <div className="cell">#</div><div className="cell">Team</div>
            <div className="cell r">W-L</div><div className="cell r">PF</div><div className="cell r">Record</div>
          </div>
          {teams.map((t,i)=>(
            <div className="row stand" key={t.rid}>
              <div className={`cell rank ${i<1?"top":""}`}>{i+1}</div>
              <div className="cell team">
                {t.avatar?<img className="ava" src={t.avatar} alt=""/>:<div className="ava"/>}
                <span className="tname">{t.name}</span>
              </div>
              <div className="cell r num">{t.w}-{t.l}{t.t?`-${t.t}`:""}</div>
              <div className="cell r num pts">{t.pf.toFixed(1)}</div>
              <div className="cell r num" style={{color:"var(--muted)"}}>
                {(t.w+t.l+t.t)>0?`${Math.round(100*t.w/(t.w+t.l+t.t))}%`:"—"}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="sec">
        <div className="sechead"><h2>Rosters</h2><span className="rt">starters listed first</span></div>
        <div className="rosters">
          {teams.map(t=>{
            const bench=t.players.filter(p=>!t.starters.includes(p));
            const Line=({id})=>(
              <div className="pl">
                <span className="pos" style={{background:POS_COLOR[posOf(id)]||"var(--oth)"}}>{posOf(id)||"—"}</span>
                <span className="plname">{name(id)}</span>
                <span className="plteam">{teamOf(id)}</span>
              </div>
            );
            return (
              <div className="rteam" key={t.rid}>
                <header>
                  {t.avatar?<img className="ava" src={t.avatar} alt=""/>:<div className="ava"/>}
                  <b>{t.name}</b><span className="rec">{t.w}-{t.l}</span>
                </header>
                <div className="divlbl">Starters</div>
                {t.starters.filter(Boolean).map((id,k)=><Line key={"s"+k} id={id}/>)}
                {bench.length>0 && <div className="divlbl">Bench</div>}
                {bench.map((id,k)=><Line key={"b"+k} id={id}/>)}
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}

/* ---------- Rankings ---------- */
function Rankings(){
  const [pos,setPos]=useState("ALL");
  const positions=["ALL","QB","RB","WR","TE"];
  const list=useMemo(()=>PLAYERS
    .filter(p=>pos==="ALL"||p.pos===pos)
    .sort((a,b)=>b.value-a.value),[pos]);
  return (
    <section className="sec">
      <div className="sechead"><h2>Rankings</h2><span className="rt">starter set · edit in code</span></div>
      <div className="filters">
        {positions.map(p=>(
          <button key={p} className={`btn sm ${pos===p?"":"ghost"}`} onClick={()=>setPos(p)}>{p}</button>
        ))}
      </div>
      <div className="board">
        <div className="row rk head">
          <div className="cell">#</div><div className="cell">Player</div>
          <div className="cell r">Pos</div><div className="cell r">Value</div>
        </div>
        {list.map((p,i)=>(
          <div className="row rk" key={p.name}>
            <div className={`cell rank ${i<3?"top":""}`}>{i+1}</div>
            <div className="cell team">
              <span className="tier" style={{background:TIER_COLOR[p.tier-1]||"var(--oth)"}}/>
              <span className="tname">{p.name}</span>
              <span style={{color:"var(--dim)",fontSize:12,marginLeft:8}}>{p.team}</span>
            </div>
            <div className="cell r"><span className="pos" style={{display:"inline-block",background:POS_COLOR[p.pos]}}>{p.pos}</span></div>
            <div className="cell r val" style={{color:"var(--amber)"}}>{p.value}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ---------- Trade calculator with verdict bar ---------- */
function Trade(){
  const [a,setA]=useState([]);
  const [b,setB]=useState([]);
  const sum=(arr)=>arr.reduce((s,p)=>s+p.value,0);
  const va=sum(a),vb=sum(b),total=va+vb||1;
  const pa=Math.round((va/total)*100),pb=100-pa;
  const diff=va-vb;
  const winner=Math.abs(diff)<6?"Even trade":diff>0?"Side A wins":"Side B wins";
  const winColor=Math.abs(diff)<6?"var(--muted)":diff>0?"var(--mint)":"var(--amber)";
  return (
    <section className="sec">
      <div className="sechead"><h2>Trade calculator</h2><span className="rt">verdict updates live</span></div>
      <div className="trade">
        <TradeSide title="Side A" picks={a} setPicks={setA} accent="var(--mint)" other={b}/>
        <div style={{alignSelf:"center",textAlign:"center",padding:"8px 0"}}>
          <div className="cond" style={{fontSize:26,color:"var(--dim)"}}>VS</div>
        </div>
        <TradeSide title="Side B" picks={b} setPicks={setB} accent="var(--amber)" other={a}/>
      </div>

      <div className="verdict" style={{maxWidth:640,margin:"22px auto 0"}}>
        <div className="vbar">
          <div className="vfill" style={{width:`${pa}%`,background:"var(--mint)"}}/>
          <div className="vfill" style={{width:`${pb}%`,background:"var(--amber)"}}/>
        </div>
        <div style={{display:"flex",justifyContent:"space-between",marginTop:8,color:"var(--muted)",fontSize:13}}>
          <span className="num">A · {va}</span><span className="num">{vb} · B</span>
        </div>
        <div className="vlabel" style={{color:winColor}}>
          {winner}{Math.abs(diff)>=6?` (+${Math.abs(diff)})`:""}
        </div>
      </div>
    </section>
  );
}

function TradeSide({title,picks,setPicks,accent,other}){
  const [q,setQ]=useState("");
  const chosen=new Set([...picks,...other].map(p=>p.name));
  const matches=q.trim().length<1?[]:PLAYERS
    .filter(p=>p.name.toLowerCase().includes(q.toLowerCase())&&!chosen.has(p.name))
    .sort((a,b)=>b.value-a.value).slice(0,7);
  const add=(p)=>{setPicks([...picks,p]);setQ("");};
  const remove=(n)=>setPicks(picks.filter(p=>p.name!==n));
  const tot=picks.reduce((s,p)=>s+p.value,0);
  return (
    <div className="side">
      <h4 style={{color:accent}}>{title}</h4>
      {picks.map(p=>(
        <div className="picked" key={p.name}>
          <span className="pos" style={{background:POS_COLOR[p.pos]}}>{p.pos}</span>
          <span className="plname">{p.name}</span>
          <span className="val">{p.value}</span>
          <button className="x" onClick={()=>remove(p.name)}>✕</button>
        </div>
      ))}
      <div className="search">
        <input className="input" placeholder="Add a player…" value={q} onChange={e=>setQ(e.target.value)} style={{width:"100%"}}/>
        {matches.length>0 && (
          <div className="results">
            {matches.map(p=>(
              <div className="res" key={p.name} onClick={()=>add(p)}>
                <span className="pos" style={{background:POS_COLOR[p.pos]}}>{p.pos}</span>
                <span className="plname">{p.name}</span>
                <span style={{marginLeft:"auto",color:"var(--dim)"}}>{p.team}</span>
                <span className="val" style={{color:accent}}>{p.value}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="sum" style={{color:accent}}>{tot}</div>
    </div>
  );
}
