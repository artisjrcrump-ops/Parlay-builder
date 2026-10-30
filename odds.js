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

// One request per league per day, cached, to stay inside the free monthly allowance.
async function loadOddsEvents(game) {
  const key = oddsKey();
  if (!key) return null;
  const league = SGO_LEAGUE[state.league];
  const day = ymd(game.date);
  const cacheKey = `pb.sgo.${league}.${day}`;
  const cached = readCache(cacheKey);
  if (cached) return cached;

  const start = new Date(game.date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const url = `${SGO}?leagueID=${league}&bookmakerID=fanduel&startsAfter=${start.toISOString()}`
    + `&startsBefore=${end.toISOString()}&limit=100&apiKey=${encodeURIComponent(key)}`;
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.success === false) throw new Error(body.error || `HTTP ${res.status}`);

  // Keep only what the app needs so the cache stays small.
  const events = (body.data || []).map((ev) => ({
    home: ev.teams?.home?.names?.long || "",
    away: ev.teams?.away?.names?.long || "",
    players: Object.fromEntries(Object.values(ev.players || {}).map((p) => [norm(p.name), p.playerID])),
    lines: Object.fromEntries(Object.entries(ev.odds || {})
      .filter(([id]) => id.endsWith("-game-ou-over") || id.endsWith("-game-ou-under"))
      .map(([id, o]) => [id, o.byBookmaker?.fanduel])
      .filter(([, fd]) => fd && fd.available !== false)),
  }));
  writeCache(cacheKey, events);
  return events;
}

function teamMatches(sgoName, espnTeam) {
  const n = norm(sgoName);
  return n === norm(espnTeam.full) || (espnTeam.name && n.endsWith(norm(espnTeam.name)));
}

// Returns { statKey: { line, over, under } } for this player, or null when unavailable.
async function getPlayerLines(game, playerName) {
  const events = await loadOddsEvents(game);
  if (!events) return null;
  const ev = events.find((e) => teamMatches(e.home, game.home) && teamMatches(e.away, game.away));
  if (!ev) return {};
  const pid = ev.players[norm(playerName)];
  if (!pid) return {};
  const out = {};
  for (const [statKey, statID] of Object.entries(PROP_STATS)) {
    const over = ev.lines[`${statID}-${pid}-game-ou-over`];
    const under = ev.lines[`${statID}-${pid}-game-ou-under`];
    if (!over && !under) continue;
    out[statKey] = { line: parseFloat((over || under).overUnder), over: over?.odds, under: under?.odds };
  }
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
      Object.keys(localStorage).filter((k) => k.startsWith("pb.sgo.")).forEach((k) => localStorage.removeItem(k));
    } catch { /* no storage */ }
    $("sgo-msg").textContent = "Saved. FanDuel lines will show on player pages.";
  } else if (e.target.id === "sgo-clear") {
    try { localStorage.removeItem("pb.sgoKey"); } catch { /* no storage */ }
    openSettings();
  }
});
