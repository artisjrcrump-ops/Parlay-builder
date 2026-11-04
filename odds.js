// FanDuel player prop lines from SportsGameOdds (free key, stored only on this device).
// Shares globals from app.js (state, $, loadPref, savePref).

const SGO = "https://api.sportsgameodds.com/v2/events";
const SGO_LEAGUE = { nba: "NBA", ncaab: "NCAAB", nfl: "NFL", ncaaf: "NCAAF" };
const CACHE_MINUTES = 30; // the free plan has a monthly limit, so refetch at most every 30 minutes

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
  const add = (line, fd, dk, odds, kind) => {
    if (!fd && !dk) return;
    const k = linkKey(game.id, player, side, line);
    (BET_LINKS[k] ||= []).push({ stat, fd, dk, src: `${stat} ${side} ${line} ${odds ?? ""} ${kind}` });
  };
  const main = parseFloat(o.overUnder);
  add(Number.isFinite(main) ? main : 0.5, o.link, o.dk?.[main], o.odds, "main");
  for (const a of o.altLines || []) add(parseFloat(a.overUnder), a.link, o.dk?.[parseFloat(a.overUnder)], a.odds, "alt");
}

function betLinksFor(leg) {
  const list = BET_LINKS[linkKey(leg.gameId, leg.player, leg.side === "under" ? "under" : "over", leg.line)] || [];
  const hit = list.find((x) => x.stat === leg.gradeKey) || (list.length === 1 ? list[0] : null);
  const dkGame = GAME_DK[leg.gameId] || null;
  return hit || dkGame ? { fd: hit?.fd || null, dk: hit?.dk || null, dkGame, src: hit?.src || "", n: list.length } : null;
}

const ODDS_FAIL = {};
let oddsError = null; // last SportsGameOdds failure, shown above picks (sportChips)

function oddsErrorNote() {
  if (!oddsError || Date.now() - oddsError.at > 30 * 60 * 1000) {
    return LINE_SOURCE === "DraftKings" ? `<p class="note">Lines and prices are DraftKings' (from ESPN). FanDuel's are usually close.</p>` : "";
  }
  const limit = /limit|quota|exceed|429|rate/i.test(oddsError.msg);
  return `<p class="warn">FanDuel lines didn't load for ${oddsError.league} ("${oddsError.msg}"), so these picks use DraftKings' lines from ESPN instead. Prices may differ a little on FanDuel.${limit
    ? " The free SportsGameOdds key hit its monthly limit; it resets next month."
    : /key/i.test(oddsError.msg) ? " Check your key in ⚙︎ Settings." : ""}</p>`;
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
  // After a failure, don't ask again for 5 minutes (every player would otherwise retry it).
  const failed = ODDS_FAIL[cacheKey];
  if (failed && Date.now() - failed.at < 5 * 60 * 1000) throw new Error(failed.msg);
  let res, body;
  try {
    res = await fetch(url);
    body = await res.json().catch(() => ({}));
  } catch (err) {
    res = { ok: false, status: 0 };
    body = { error: "Couldn't reach SportsGameOdds" };
  }
  if (!res.ok || body.success === false) {
    const msg = body.error || body.message || `HTTP ${res.status}`;
    ODDS_FAIL[cacheKey] = { at: Date.now(), msg };
    oddsError = { league, msg, at: Date.now() };
    throw new Error(msg);
  }
  if (oddsError?.league === league) oddsError = null;

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
// Lines for one player: FanDuel via SportsGameOdds when the key works, otherwise
// DraftKings via ESPN's free feed (espnodds.js). LINE_SOURCE says which one answered.
let LINE_SOURCE = "FanDuel";
async function getPlayerLines(game, playerName, playerId) {
  // Default: free DraftKings lines (no limit). FanDuel via the key only when turned on in
  // Settings, or when DraftKings has nothing for this player (e.g. some college games).
  const fdFirst = loadPref("lines", "dk") === "fd";
  if (!fdFirst) {
    const dk = await espnPlayerLines(game, playerId).catch(() => ({}));
    if (Object.keys(dk).length || !oddsKey()) { LINE_SOURCE = "DraftKings"; return dk; }
  }
  let events = null;
  if (oddsKey()) {
    try { events = await loadOddsEvents(game); } catch { events = null; }
  }
  if (!events) {
    LINE_SOURCE = "DraftKings";
    return fdFirst ? espnPlayerLines(game, playerId) : {};
  }
  LINE_SOURCE = "FanDuel";
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
// The version running = the ?v= on this script's URL (bumped every release).
const APP_VERSION = (document.currentScript?.src.match(/[?&]v=(\d+)/) || [])[1] || "?";

// Ask GitHub for the newest index.html and say whether this phone is behind.
async function checkVersion() {
  const el = $("app-version");
  if (!el) return;
  try {
    const html = await fetch(`index.html?check=${Date.now()}`, { cache: "no-store" }).then((r) => r.text());
    const latest = (html.match(/\.js\?v=(\d+)/) || [])[1];
    el.innerHTML = !latest || latest === APP_VERSION
      ? `Version ${APP_VERSION} · up to date ✓`
      : `Version ${APP_VERSION} · <b>version ${latest} is out.</b> <a href="./?v=${latest}">Tap to update</a>`;
  } catch {
    el.textContent = `Version ${APP_VERSION}`;
  }
}

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
      <label class="lines-pick">Lines for picks
        <select id="lines-src">
          <option value="dk" ${loadPref("lines", "dk") === "dk" ? "selected" : ""}>DraftKings (free, no limit)</option>
          <option value="fd" ${loadPref("lines", "dk") === "fd" ? "selected" : ""}>FanDuel (uses your key's monthly limit)</option>
        </select></label>
      <p class="note">With DraftKings picked, your key is only used for games DraftKings has no props for.</p>
      <p id="app-version" class="note app-version">Version ${APP_VERSION} · checking for updates…</p>
    </div>`;
  openSheet();
  checkVersion();
}

$("settings").addEventListener("click", openSettings);

$("sheet-body").addEventListener("change", (e) => {
  if (e.target.id !== "lines-src") return;
  savePref("lines", e.target.value);
  sheet.sportCache = {};
  sheet.autoCache = null;
});

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
