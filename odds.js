// FanDuel player prop lines from SportsGameOdds (free key, stored only on this device).
// Shares globals from app.js (state, $, loadPref, savePref).

const SGO = "https://api.sportsgameodds.com/v2/events";
const SGO_LEAGUE = { nba: "NBA", ncaab: "NCAAB", nfl: "NFL", ncaaf: "NCAAF" };
const CACHE_MINUTES = 10; // the free plan refreshes odds every 10 minutes

// App stat key -> SportsGameOdds statID.
const PROP_STATS = {
  points: "points",
  totalRebounds: "rebounds",
  assists: "assists",
  threes: "threePointersMade",
  pra: "points+rebounds+assists",
  passingYards: "passing_yards",
  passingTouchdowns: "passing_touchdowns",
  rushingYards: "rushing_yards",
  receptions: "receiving_receptions",
  receivingYards: "receiving_yards",
  steals: "steals",
  blocks: "blocks",
  pr: "points+rebounds",
  pa: "points+assists",
  ra: "rebounds+assists",
  passingAttempts: "passing_attempts",
  completions: "passing_completions",
  interceptions: "passing_interceptions",
  longReception: "receiving_longestReception",
  rushRec: "rushing+receiving_yards",
};

function oddsKey() {
  return loadPref("sgoKey", "");
}

function norm(name) {
  return (name || "")
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, "")
    .replace(/[^a-z]/g, "");
}

function readCache(key) {
  try {
    const hit = JSON.parse(localStorage.getItem(key) || "null");
    if (hit && Date.now() - hit.at < CACHE_MINUTES * 60 * 1000) return hit.data;
  } catch { /* no storage */ }
  return null;
}

function writeCache(key, data) {
  try { localStorage.setItem(key, JSON.stringify({ at: Date.now(), data })); } catch { /* quota or private mode */ }
}

function trimLine(fd, dk) {
  if (!fd) return fd;
  const alt = Array.isArray(fd.altLines)
    ? fd.altLines.map((a) => ({ odds: a.odds, overUnder: a.overUnder, link: a.deeplink })) : undefined;
  // Bet-slip links: FanDuel's for this line, DraftKings' for the same line when it has one.
  const dkLinks = {};
  for (const d of dk ? [dk, ...(dk.altLines || [])] : []) if (d.deeplink) dkLinks[parseFloat(d.overUnder)] = d.deeplink;
  return { odds: fd.odds, overUnder: fd.overUnder, available: fd.available, altLines: alt, link: fd.deeplink, dk: dkLinks };
}

// Bet-slip links by game, player, side and line, filled as props load; slip legs pick them up
// (persist in slip.js) so "Place on FanDuel / DraftKings" can open the book with the picks in it.
const BET_LINKS = {};
const GAME_DK = {}; // DraftKings game page, for when it has no bet-slip link for a line
const linkKey = (gameId, player, side, line) => `${gameId}|${norm(player)}|${side}|${parseFloat(line)}`;

function noteLinks(game, player, stat, side, o) {
  if (!o) return;
  const add = (line, fd, dk) => {
    if (!fd && !dk) return;
    const k = linkKey(game.id, player, side, line);
    (BET_LINKS[k] ||= []).push({ stat, fd, dk });
  };
  const main = parseFloat(o.overUnder);
  add(Number.isFinite(main) ? main : 0.5, o.link, o.dk?.[main]);
  for (const a of o.altLines || []) add(parseFloat(a.overUnder), a.link, o.dk?.[parseFloat(a.overUnder)]);
}

function betLinksFor(leg) {
  const list = BET_LINKS[linkKey(leg.gameId, leg.player, leg.side === "under" ? "under" : "over", leg.line)] || [];
  const hit = list.find((x) => x.stat === leg.gradeKey) || (list.length === 1 ? list[0] : null);
  const dkGame = GAME_DK[leg.gameId] || null;
  return hit || dkGame ? { fd: hit?.fd || null, dk: hit?.dk || null, dkGame } : null;
}

// One request per league per day, cached, to stay inside the free monthly allowance.
async function loadOddsEvents(game) {
  const key = oddsKey();
  if (!key) return null;
  const league = SGO_LEAGUE[state.league];
  const day = ymd(game.date);
  const cacheKey = `pb.odds.v3.${league}.${day}`;
  const cached = readCache(cacheKey);
  if (cached) return cached;

  const start = new Date(game.date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const url = `${SGO}?leagueID=${league}&bookmakerID=fanduel,draftkings&startsAfter=${start.toISOString()}`
    + `&startsBefore=${end.toISOString()}&limit=100&apiKey=${encodeURIComponent(key)}`
    + "&includeAltLines=true"; // alternate lines price the app's suggested lines (and 2+ TDs)
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.success === false) throw new Error(body.error || `HTTP ${res.status}`);

  // Keep only what the app needs so the cache stays small.
  const events = (body.data || []).map((ev) => ({
    home: ev.teams?.home?.names?.long || "",
    away: ev.teams?.away?.names?.long || "",
    dkEvent: ev.links?.bookmakers?.draftkings || "",
    players: Object.fromEntries(Object.values(ev.players || {}).map((p) => [norm(p.name), p.playerID])),
    lines: Object.fromEntries(Object.entries(ev.odds || {})
      .filter(([id]) => /-game-(ou-over|ou-under|yn-yes)$/.test(id))
      .map(([id, o]) => [id, trimLine(o.byBookmaker?.fanduel, o.byBookmaker?.draftkings)])
      .filter(([, fd]) => fd && fd.available !== false)),
  }));
  writeCache(cacheKey, events);
  return events;
}

function teamMatches(sgoName, espnTeam) {
  const n = norm(sgoName);
  return n === norm(espnTeam.full) || (espnTeam.name && n.endsWith(norm(espnTeam.name)));
}

// Anytime TD and 2+ TDs, from a yes/no market or the touchdowns over/under ladder.
function touchdownLines(ev, pid) {
  const ladder = {};
  const yes = ev.lines[`touchdowns-${pid}-game-yn-yes`];
  if (yes?.odds) ladder[0.5] = yes.odds;
  const ou = ev.lines[`touchdowns-${pid}-game-ou-over`];
  for (const l of ou ? [ou, ...(ou.altLines || [])] : []) {
    const line = parseFloat(l.overUnder);
    if (Number.isFinite(line) && l.odds && !(line in ladder)) ladder[line] = l.odds;
  }
  const out = {};
  const td = { under: null, statKey: "tds", yes: true };
  if (ladder[0.5]) out.anytimeTd = { ...td, line: 0.5, over: ladder[0.5], label: "Anytime TD", maxDec: 4 };
  if (ladder[1.5]) out.twoTd = { ...td, line: 1.5, over: ladder[1.5], label: "2+ TDs", maxDec: 12 };
  return out;
}

function doubleDoubleLine(ev, pid) {
  const yes = ev.lines[`doubleDouble-${pid}-game-yn-yes`];
  const ou = ev.lines[`doubleDouble-${pid}-game-ou-over`];
  const odds = yes?.odds || (ou && parseFloat(ou.overUnder) === 0.5 ? ou.odds : null);
  return odds
    ? { doubleDouble: { line: 0.5, over: odds, under: null, statKey: "dd", yes: true, label: "Double-double", maxDec: 6 } }
    : {};
}

// Returns { statKey: { line, over, under } } for this player, or null when unavailable.
async function getPlayerLines(game, playerName) {
  const events = await loadOddsEvents(game);
  if (!events) return null;
  const ev = events.find((e) => teamMatches(e.home, game.home) && teamMatches(e.away, game.away));
  if (!ev) return {};
  if (ev.dkEvent) GAME_DK[game.id] = ev.dkEvent;
  const pid = ev.players[norm(playerName)];
  if (!pid) return {};
  const out = {};
  for (const [statKey, statID] of Object.entries(PROP_STATS)) {
    const over = ev.lines[`${statID}-${pid}-game-ou-over`];
    const under = ev.lines[`${statID}-${pid}-game-ou-under`];
    if (!over && !under) continue;
    // FanDuel's alternate lines for this prop: { line: { over, under } }.
    const alts = {};
    for (const [side, o] of [["over", over], ["under", under]]) {
      for (const a of o?.altLines || []) {
        const line = parseFloat(a.overUnder);
        if (Number.isFinite(line) && a.odds) (alts[line] ||= {})[side] = a.odds;
      }
    }
    out[statKey] = { line: parseFloat((over || under).overUnder), over: over?.odds, under: under?.odds, alts };
    noteLinks(game, playerName, statKey, "over", over);
    noteLinks(game, playerName, statKey, "under", under);
  }
  for (const [id, stat] of [["touchdowns", "tds"], ["doubleDouble", "dd"]]) {
    noteLinks(game, playerName, stat, "over", ev.lines[`${id}-${pid}-game-yn-yes`]);
    noteLinks(game, playerName, stat, "over", ev.lines[`${id}-${pid}-game-ou-over`]);
  }
  Object.assign(out, touchdownLines(ev, pid), doubleDoubleLine(ev, pid));
  return out;
}

// Settings sheet: paste the key once; it never leaves this device except to SportsGameOdds.
function openSettings() {
  sheet.game = null;
  $("sheet-back").hidden = true;
  $("sheet-title").textContent = "Settings";
  const has = !!oddsKey();
  $("sheet-body").innerHTML = `
    <div class="settings">
      <label for="sgo-key">SportsGameOdds API key</label>
      <input id="sgo-key" type="password" autocomplete="off" placeholder="Paste your key" value="${has ? "••••••••" : ""}">
      <div class="settings-actions">
        <button id="sgo-save" class="btn primary">Save</button>
        ${has ? `<button id="sgo-clear" class="btn">Remove</button>` : ""}
      </div>
      <p id="sgo-msg" class="note">${has ? "A key is saved on this device." : "No key saved yet."}
        The key is stored only on this phone, never in the app's code.
        Get a free one at <a href="https://sportsgameodds.com/pricing" target="_blank" rel="noopener">sportsgameodds.com</a>.</p>
    </div>`;
  openSheet();
}

$("settings").addEventListener("click", openSettings);

$("sheet-body").addEventListener("click", (e) => {
  if (e.target.id === "sgo-save") {
    const v = $("sgo-key").value.trim();
    if (!v || v === "••••••••") return;
    savePref("sgoKey", v);
    try {
      Object.keys(localStorage).filter((k) => k.startsWith("pb.odds.")).forEach((k) => localStorage.removeItem(k));
    } catch { /* no storage */ }
    $("sgo-msg").textContent = "Saved. FanDuel lines will show on player pages.";
  } else if (e.target.id === "sgo-clear") {
    try { localStorage.removeItem("pb.sgoKey"); } catch { /* no storage */ }
    openSettings();
  }
});
