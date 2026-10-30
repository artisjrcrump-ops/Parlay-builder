// Defense vs position over each team's last 5 games, compared with the average across the
// day's slate. Basketball: points, rebounds, assists and 3s allowed to guards, forwards and
// centers. Football: passing yards (QB/WR/TE), rushing yards (RB) and offensive TDs allowed.
// Shares globals from the other scripts (state, LEAGUES, SITE, getJSON, sportOf).

const DVP_GAMES = 5;
const TOUGH = 0.85; // allows 15%+ fewer points than average to that position
const SOFT = 1.15;

function posGroup(pos) {
  const p = (pos || "").toUpperCase();
  if (p.includes("C")) return "C";
  if (p.includes("G")) return "G";
  if (p.includes("F")) return "F";
  return null;
}

function footballGroup(pos) {
  const p = (pos || "").toUpperCase();
  if (p === "RB" || p === "FB") return "rush";
  if (["QB", "WR", "TE"].includes(p)) return "pass";
  return null;
}

async function teamDvp(teamId) {
  const lg = LEAGUES[state.league];
  const cacheKey = `pb.dvp3.${state.league}.${teamId}.${ymd(new Date())}`;
  try {
    const hit = JSON.parse(localStorage.getItem(cacheKey) || "null");
    if (hit) return hit;
  } catch { /* no storage */ }

  const sched = await getJSON(`${SITE}${lg.path}/teams/${teamId}/schedule`);
  const done = (sched.events || [])
    .filter((e) => e.competitions?.[0]?.status?.type?.completed)
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, DVP_GAMES);
  const football = sportOf(state.league) === "football";
  const totals = { pass: 0, rush: 0, tds: 0 };
  for (const g of ["G", "F", "C"]) for (const m of BB_METRICS) totals[`${g}.${m}`] = 0;
  let games = 0;
  for (const ev of done) {
    const sm = await getJSON(`${SITE}${lg.path}/summary?event=${ev.id}`);
    const opp = (sm.boxscore?.players || []).find((t) => t.team?.id !== String(teamId));
    if (football) {
      const total = (cat, stat) => {
        const c = (opp?.statistics || []).find((x) => x.name === cat);
        const i = (c?.keys || []).indexOf(stat);
        return i >= 0 ? parseFloat(c.totals?.[i]) || 0 : null;
      };
      const pass = total("passing", "passingYards");
      const rush = total("rushing", "rushingYards");
      if (pass == null || rush == null) continue;
      totals.pass += pass;
      totals.rush += rush;
      totals.tds += (total("passing", "passingTouchdowns") || 0) + (total("rushing", "rushingTouchdowns") || 0);
      games++;
      continue;
    }
    const st = opp?.statistics?.[0];
    if (!st) continue;
    const keys = st.keys || st.names || [];
    const idx = {
      pts: keys.indexOf("points"),
      reb: keys.indexOf("rebounds"),
      ast: keys.indexOf("assists"),
      threes: keys.indexOf("threePointFieldGoalsMade-threePointFieldGoalsAttempted"),
    };
    if (idx.pts < 0) continue;
    for (const a of st.athletes || []) {
      const g = posGroup(a.athlete?.position?.abbreviation);
      if (!g || a.didNotPlay) continue;
      for (const m of BB_METRICS) {
        if (idx[m] >= 0) totals[`${g}.${m}`] += parseFloat(String(a.stats?.[idx[m]]).split("-")[0]) || 0;
      }
    }
    games++;
  }
  const out = games ? Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, v / games])) : null;
  if (out) out.games = games;
  try { if (out) localStorage.setItem(cacheKey, JSON.stringify(out)); } catch { /* storage full */ }
  return out;
}

const dvpState = { day: "", teams: {}, baseline: null, loading: null };

// Loads every team on the current slate once per day, then builds the slate baseline.
function loadSlateDvp() {
  const day = `${state.league}.${ymd(state.date)}`;
  if (dvpState.day === day && dvpState.loading) return dvpState.loading;
  dvpState.day = day;
  dvpState.teams = {};
  const ids = [...new Set(state.games.flatMap((g) => [g.home.id, g.away.id]))];
  dvpState.loading = pool(ids, 4, async (id) => { dvpState.teams[id] = await teamDvp(id); }).then(() => {
    const rows = Object.values(dvpState.teams).filter(Boolean);
    const mean = (k) => rows.reduce((s, r) => s + (r[k] || 0), 0) / (rows.length || 1);
    dvpState.baseline = rows.length >= 4
      ? Object.fromEntries(Object.keys(rows[0]).filter((k) => k !== "games").map((k) => [k, mean(k)]))
      : null;
    return dvpState;
  });
  return dvpState.loading;
}

const BB_METRICS = ["pts", "reb", "ast", "threes"];
const BB_STAT_METRIC = {
  points: "pts", pra: "pts", pr: "pts", pa: "pts", dd: "pts",
  totalRebounds: "reb", ra: "reb", assists: "ast", threes: "threes",
};
const METRIC_NAME = { pts: "points", reb: "rebounds", ast: "assists", threes: "3s" };

// The defense number that matters for this stat: e.g. rebounds allowed to forwards,
// rushing yards allowed for an RB's rushing prop, TDs allowed for a TD prop.
function metricFor(pos, statKey) {
  if (sportOf(state.league) === "football") {
    if (["tds", "anytimeTd", "twoTd"].includes(statKey)) return "tds";
    if (/^rushing/.test(statKey)) return "rush";
    if (/^(passing|receiving|receptions|completions|interceptions|longReception)/.test(statKey)) return "pass";
    return footballGroup(pos);
  }
  const g = posGroup(pos);
  if (!g) return null;
  return `${g}.${BB_STAT_METRIC[statKey] || "pts"}`;
}

// { ratio, label, tough, soft } for a player at `pos` facing team `oppId` on `statKey`, or null.
async function matchupFor(oppId, pos, statKey = "points") {
  const football = sportOf(state.league) === "football";
  const group = metricFor(pos, statKey);
  if (!group) return null;
  await loadSlateDvp();
  const team = dvpState.teams[oppId];
  const base = dvpState.baseline;
  if (!team || !base || !base[group]) return null;
  const ratio = team[group] / base[group];
  const pct = Math.round(Math.abs(1 - ratio) * 100);
  const dir = ratio < 1 ? "below" : "above";
  let label;
  if (football) {
    label = group === "tds"
      ? `allows ${team.tds.toFixed(1)} offensive TDs/game, ${pct}% ${dir} average (last ${team.games})`
      : `allows ${team[group].toFixed(0)} ${group === "pass" ? "passing" : "rushing"} yds/game, ${pct}% ${dir} average (last ${team.games})`;
  } else {
    const [g, m] = group.split(".");
    label = `${ratio < 1 ? "holds" : "gives up"} ${{ G: "guards", F: "forwards", C: "centers" }[g]} ${pct}% ${dir} average in ${METRIC_NAME[m]} (${team[group].toFixed(1)}/game, last ${team.games})`;
  }
  return { ratio, tough: ratio <= TOUGH, soft: ratio >= SOFT, label };
}
