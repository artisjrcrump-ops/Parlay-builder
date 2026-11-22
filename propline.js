// Real sportsbook prices from PropLine (prop-line.com) through Artis's own Cloudflare Worker
// (worker/propline-worker.js holds the key). FanDuel first, DraftKings if FanDuel has no price.
// One request loads a whole sport's slate (every game, props + alt lines) and is reused for
// 10 minutes, so the free 1,000 requests a day go a long way.
// Shares globals from the other scripts (state, LEAGUES, loadPref, savePref, norm).

const PL_SPORT = { nba: "basketball_nba", ncaab: "basketball_ncaab", nfl: "football_nfl", ncaaf: "football_ncaaf" };
const PL_TTL = 10 * 60 * 1000;
const PL_BOOKS = ["fanduel", "draftkings"];

// PropLine market key -> the app's stat key (same keys espnodds.js uses).
const PL_STAT = {
  player_points: "points", player_rebounds: "totalRebounds", player_assists: "assists", player_threes: "threes",
  player_points_rebounds_assists: "pra", player_points_rebounds: "pr", player_points_assists: "pa", player_rebounds_assists: "ra",
  player_steals: "steals", player_blocks: "blocks",
  player_pass_yds: "passingYards", player_rush_yds: "rushingYards", player_reception_yds: "receivingYards",
  player_receptions: "receptions", player_rush_reception_yds: "rushRec", player_pass_completions: "completions",
  player_pass_attempts: "passingAttempts", player_pass_tds: "passingTouchdowns", player_pass_interceptions: "interceptions",
};
// Yes-only markets, shaped like espnodds.js's ESPN_YES entries.
const PL_YES = {
  player_anytime_td: { key: "anytimeTd", statKey: "tds", line: 0.5, label: "Anytime TD", maxDec: 4 },
  player_2plus_td: { key: "twoTd", statKey: "tds", line: 1.5, label: "2+ TDs", maxDec: 12 },
  player_double_double: { key: "doubleDouble", statKey: "dd", line: 0.5, label: "Double-double", maxDec: 6 },
};
const PL_MARKETS = { basketball: Object.keys(PL_STAT).filter((k) => !/pass|rush|recep/.test(k)).concat("player_double_double"),
  football: Object.keys(PL_STAT).filter((k) => /pass|rush|recep/.test(k)).concat("player_anytime_td", "player_2plus_td") };

const plMem = {};
let PL_STATUS = ""; // shown in Settings: when prices were loaded and requests left today

const plUrl = () => (loadPref("propline", "") || "").replace(/\/+$/, "");

async function plSlate(leagueKey, fresh = false) {
  const sport = PL_SPORT[leagueKey];
  if (!plUrl() || !sport) return null;
  const hit = plMem[sport];
  if (!fresh && hit && Date.now() - hit.at < PL_TTL) return hit.promise;
  const kind = LEAGUES[leagueKey].path.split("/")[0];
  const url = `${plUrl()}/v1/sports/${sport}/odds?markets=${PL_MARKETS[kind].join(",")}&bookmakers=${PL_BOOKS.join(",")}`;
  const promise = fetch(url).then(async (r) => {
    if (!r.ok) throw new Error(`PropLine HTTP ${r.status}`);
    const left = r.headers.get("X-Daily-Remaining");
    const events = parsePropLine(await r.json());
    PL_STATUS = `Real odds loaded ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}${left ? ` · ${left} requests left today` : ""}`;
    return events;
  });
  plMem[sport] = { at: Date.now(), promise };
  promise.catch((e) => { delete plMem[sport]; PL_STATUS = `Real odds unavailable (${e.message})`; });
  return promise;
}

// -> [{ home, away, time, books: { fanduel: { normName: { statKey: {line, over, under, alts} } } } }]
function parsePropLine(data) {
  const list = Array.isArray(data) ? data : data?.data || [];
  return list.map((ev) => {
    const books = {};
    for (const bk of ev.bookmakers || []) {
      const players = (books[bk.key] ||= {});
      for (const m of bk.markets || []) {
        if (m.period) continue; // full game only
        const yes = PL_YES[m.key];
        const stat = PL_STAT[m.key];
        if (!yes && !stat) continue;
        for (const o of m.outcomes || []) {
          const who = norm(o.description || "");
          const price = parseInt(o.price, 10);
          if (!who || !Number.isFinite(price)) continue;
          const p = (players[who] ||= {});
          if (yes) {
            if (/^(yes|over)$/i.test(o.name || "") && !p[yes.key]) p[yes.key] = { ...yes, over: price, under: null, yes: true };
            continue;
          }
          const s = (p[stat] ||= { line: NaN, over: null, under: null, alts: {} });
          const side = /^under/i.test(o.name || "") ? "under" : "over";
          const rung = (o.name || "").match(/(\d+)\+/);
          const point = rung ? parseInt(rung[1], 10) - 0.5 : parseFloat(o.point);
          if (!Number.isFinite(point)) continue;
          if (m.line_type === "main" && !rung) {
            if (!Number.isFinite(s.line) || s.line === point) { s.line = point; s[side] = price; }
          } else {
            (s.alts[point] ||= {})[side] ??= price;
          }
        }
      }
    }
    // stats with only alt rungs: use the rung priced closest to -115 as the main line
    for (const players of Object.values(books)) for (const p of Object.values(players)) for (const [k, s] of Object.entries(p)) {
      if (s.yes || Number.isFinite(s.line)) continue;
      const rungs = Object.entries(s.alts).filter(([, v]) => v.over);
      if (!rungs.length) { delete p[k]; continue; }
      const [line, v] = rungs.sort((a, b) => Math.abs(a[1].over + 115) - Math.abs(b[1].over + 115))[0];
      s.line = parseFloat(line); s.over = v.over; s.under = v.under ?? null;
    }
    return { home: ev.home_team, away: ev.away_team, time: new Date(ev.commence_time), books };
  });
}

// This player's lines from PropLine, FanDuel first. null = PropLine has nothing for him.
async function propLinePlayerLines(game, playerName) {
  const events = await plSlate(state.league).catch(() => null);
  if (!events) return null;
  const ev = events.find((e) => teamMatches(e.home, game.home) && teamMatches(e.away, game.away)
    && Math.abs(e.time - game.date) < 12 * 3600 * 1000);
  if (!ev) return null;
  const who = norm(playerName);
  for (const book of PL_BOOKS) {
    const lines = ev.books[book]?.[who];
    if (lines && Object.keys(lines).length) {
      LINE_SOURCE = book === "fanduel" ? "FanDuel" : "DraftKings";
      return lines;
    }
  }
  return null;
}

function plRefresh() { for (const k of Object.keys(plMem)) delete plMem[k]; }
