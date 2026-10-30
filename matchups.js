// Defense vs position (basketball): points each team allowed to guards, forwards and
// centers over its last 5 games, compared with the average across the day's slate.
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

async function teamDvp(teamId) {
  const lg = LEAGUES[state.league];
  const cacheKey = `pb.dvp.${state.league}.${teamId}.${ymd(new Date())}`;
  try {
    const hit = JSON.parse(localStorage.getItem(cacheKey) || "null");
    if (hit) return hit;
  } catch { /* no storage */ }

  const sched = await getJSON(`${SITE}${lg.path}/teams/${teamId}/schedule`);
  const done = (sched.events || [])
    .filter((e) => e.competitions?.[0]?.status?.type?.completed)
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, DVP_GAMES);
  const totals = { G: 0, F: 0, C: 0 };
  let games = 0;
  for (const ev of done) {
    const sm = await getJSON(`${SITE}${lg.path}/summary?event=${ev.id}`);
    const opp = (sm.boxscore?.players || []).find((t) => t.team?.id !== String(teamId));
    const st = opp?.statistics?.[0];
    if (!st) continue;
    const ptsIdx = (st.keys || st.names || []).indexOf("points");
    if (ptsIdx < 0) continue;
    for (const a of st.athletes || []) {
      const g = posGroup(a.athlete?.position?.abbreviation);
      if (g && !a.didNotPlay) totals[g] += parseFloat(a.stats?.[ptsIdx]) || 0;
    }
    games++;
  }
  const out = games ? { G: totals.G / games, F: totals.F / games, C: totals.C / games, games } : null;
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
    const mean = (k) => rows.reduce((s, r) => s + r[k], 0) / (rows.length || 1);
    dvpState.baseline = rows.length >= 4 ? { G: mean("G"), F: mean("F"), C: mean("C") } : null;
    return dvpState;
  });
  return dvpState.loading;
}

// { ratio, label, tough, soft } for a player at `pos` facing team `oppId`, or null.
async function matchupFor(oppId, pos) {
  if (sportOf(state.league) !== "basketball") return null;
  const group = posGroup(pos);
  if (!group) return null;
  await loadSlateDvp();
  const team = dvpState.teams[oppId];
  const base = dvpState.baseline;
  if (!team || !base || !base[group]) return null;
  const ratio = team[group] / base[group];
  const name = { G: "guards", F: "forwards", C: "centers" }[group];
  const pct = Math.round(Math.abs(1 - ratio) * 100);
  return {
    ratio,
    tough: ratio <= TOUGH,
    soft: ratio >= SOFT,
    label: `${ratio < 1 ? "holds" : "gives up"} ${name} ${pct}% ${ratio < 1 ? "below" : "above"} average (${team[group].toFixed(1)} pts/game, last ${team.games})`,
  };
}
