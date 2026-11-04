// Backup player lines: DraftKings props from ESPN's free odds feed (no key, no monthly limit).
// Used when there's no SportsGameOdds key or it fails (e.g. the free plan's monthly limit).
// Includes DraftKings' "X+" milestone ladders, which become alternate lines.
// Shares globals from the other scripts (state, LEAGUES, readCache, writeCache).

const ESPN_CORE = "https://sports.core.api.espn.com/v2/sports/";
const ESPN_DK = 100; // DraftKings' provider id in ESPN's odds feed

// DraftKings market name (minus "Milestones" / "(incl. overtime)") -> app stat key.
const ESPN_STAT = {
  "Total Points": "points", "Points": "points",
  "Total Rebounds": "totalRebounds", "Rebounds": "totalRebounds",
  "Total Assists": "assists", "Assists": "assists",
  "Total 3-Point Field Goals": "threes", "3-Point Field Goals": "threes",
  "Total Points, Rebounds, and Assists": "pra", "Points + Assists + Rebounds": "pra",
  "Total Points and Rebounds": "pr", "Points + Rebounds": "pr",
  "Total Points and Assists": "pa", "Points + Assists": "pa",
  "Total Assists and Rebounds": "ra", "Assists + Rebounds": "ra",
  "Total Steals": "steals", "Steals": "steals",
  "Total Blocks": "blocks", "Blocks": "blocks",
  "Total Passing Yards": "passingYards", "Passing Yards": "passingYards",
  "Total Rushing Yards": "rushingYards", "Rushing Yards": "rushingYards",
  "Total Receiving Yards": "receivingYards", "Receiving Yards": "receivingYards",
  "Total Receptions": "receptions", "Receptions": "receptions",
  "Total Rushing Plus Receiving Yards": "rushRec", "Rushing + Receiving Yards": "rushRec",
  "Total Pass Completions": "completions", "Passing Completions": "completions",
  "Total Passing Attempts": "passingAttempts", "Passing Attempts": "passingAttempts",
  "Total Passing Touchdowns": "passingTouchdowns", "Passing Touchdown": "passingTouchdowns",
  "Total Passing Interceptions": "interceptions", "Interceptions Thrown": "interceptions",
  "Longest Reception": "longReception",
};
const ESPN_YES = {
  "Anytime Touchdown Scorer": { key: "anytimeTd", statKey: "tds", line: 0.5, label: "Anytime TD", maxDec: 4 },
  "Player to score 2 or more touchdowns": { key: "twoTd", statKey: "tds", line: 1.5, label: "2+ TDs", maxDec: 12 },
  "To Record a Double Double": { key: "doubleDouble", statKey: "dd", line: 0.5, label: "Double-double", maxDec: 6 },
};

const espnMem = {};

// { athleteId: { statKey: { line, over, under, alts: { line: { over } } } } } for one game.
// One download per game, shared by every player asking at once.
function espnGameLines(game) {
  const key = `pb.odds.espn.${game.id}`;
  if (espnMem[key] && Date.now() - espnMem[key].at < 30 * 60 * 1000) return espnMem[key].promise;
  const cached = readCache(key);
  const promise = cached ? Promise.resolve(cached) : fetchEspnLines(game, key);
  espnMem[key] = { at: Date.now(), promise };
  promise.catch(() => { delete espnMem[key]; });
  return promise;
}

async function fetchEspnLines(game, key) {
  const [sport, league] = LEAGUES[state.league].path.split("/");
  const base = `${ESPN_CORE}${sport}/leagues/${league}/events/${game.id}/competitions/${game.id}/odds/${ESPN_DK}/propBets?limit=1000`;
  const first = await fetch(base).then((r) => (r.ok ? r.json() : { items: [] }));
  let items = first.items || [];
  for (let page = 2; page <= (first.pageCount || 1); page++) {
    const more = await fetch(`${base}&page=${page}`).then((r) => (r.ok ? r.json() : { items: [] })).catch(() => ({ items: [] }));
    items = items.concat(more.items || []);
  }
  const data = {};
  const pairs = {}; // over/under come in pairs, over first
  for (const it of items) {
    const aid = (it.athlete?.$ref || "").match(/athletes\/(\d+)/)?.[1];
    const name = it.type?.name || "";
    if (!aid || /1st|2nd|3rd|4th|Quarter|Half|First /.test(name)) continue;
    const odds = parseInt(it.odds?.american?.value, 10);
    if (!Number.isFinite(odds)) continue;
    const p = (data[aid] ||= {});
    const yes = ESPN_YES[name];
    if (yes) {
      if (!p[yes.key]) p[yes.key] = { line: yes.line, over: odds, under: null, statKey: yes.statKey, yes: true, label: yes.label, maxDec: yes.maxDec };
      continue;
    }
    const base2 = name.replace(/ \(incl\. overtime\)/, "").replace(/ Milestones$/, "");
    const stat = ESPN_STAT[base2];
    if (!stat) continue;
    const s = (p[stat] ||= { line: NaN, over: null, under: null, alts: {} });
    if (/Milestones$/.test(name)) {
      const thr = parseFloat(it.odds?.total?.value ?? it.current?.target?.value);
      if (Number.isFinite(thr)) (s.alts[thr - 0.5] ||= {}).over ??= odds;
      continue;
    }
    const line = parseFloat(it.odds?.total?.value);
    if (!Number.isFinite(line)) continue;
    const pk = `${aid}|${stat}|${line}`;
    const n = (pairs[pk] = (pairs[pk] || 0) + 1);
    if (!Number.isFinite(s.line) || s.line === line) {
      s.line = line;
      if (n === 1) s.over = odds; else if (n === 2) s.under = odds;
    } else if (n === 1) {
      (s.alts[line] ||= {}).over ??= odds;
    }
  }
  // Stats with only a milestone ladder: use the rung priced closest to even as the main line.
  for (const p of Object.values(data)) {
    for (const [k, s] of Object.entries(p)) {
      if (s.yes || Number.isFinite(s.line)) continue;
      const rungs = Object.entries(s.alts).filter(([, v]) => v.over);
      if (!rungs.length) { delete p[k]; continue; }
      const [line, v] = rungs.sort((a, b) => Math.abs(a[1].over + 115) - Math.abs(b[1].over + 115))[0];
      s.line = parseFloat(line);
      s.over = v.over;
    }
  }
  writeCache(key, data);
  return data;
}

async function espnPlayerLines(game, playerId) {
  if (!playerId) return {};
  const data = await espnGameLines(game);
  return data[playerId] || {};
}
