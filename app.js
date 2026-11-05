// Parlay Builder: daily board.
// Pulls games, scores, lines and standings from ESPN's public JSON feeds.

const LEAGUES = {
  nba: { label: "NBA", path: "basketball/nba", query: "" },
  ncaab: { label: "NCAAB", path: "basketball/mens-college-basketball", query: "&groups=50&limit=400" },
  nfl: { label: "NFL", path: "football/nfl", query: "" },
  ncaaf: { label: "NCAAF", path: "football/college-football", query: "&groups=80&limit=400" },
};

const SITE = "https://site.api.espn.com/apis/site/v2/sports/";
const STANDINGS = "https://site.api.espn.com/apis/v2/sports/";
const WEB = "https://site.web.api.espn.com/apis/common/v3/sports/";

const state = {
  league: loadPref("league", "nba"),
  date: new Date(),
  sort: loadPref("sort", "time"),
  ranks: {}, // league -> { teamId -> { off, def, ppg, papg, n } }
  games: [],
};

function loadPref(key, fallback) {
  try { return localStorage.getItem("pb." + key) || fallback; } catch { return fallback; }
}

function savePref(key, value) {
  try { localStorage.setItem("pb." + key, value); } catch { /* private mode */ }
}

const $ = (id) => document.getElementById(id);

function ymd(d) {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

function fmtDate(d) {
  const today = ymd(new Date());
  const label = d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  return ymd(d) === today ? `Today · ${label}` : label;
}

async function getJSON(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Standings → per-game points for/against → offense and defense ranks.
async function loadRanks(key) {
  const data = await getJSON(`${STANDINGS}${LEAGUES[key].path}/standings`);
  const walk = (node) => (node.standings ? node.standings.entries : (node.children || []).flatMap(walk));
  const rows = [];
  for (const entry of walk(data)) {
    // College standings repeat stat names per split (overall, home, road...); the first is overall.
    const stats = {};
    for (const s of entry.stats) {
      if (!(s.name in stats)) stats[s.name] = s;
    }
    const games = gamesPlayed(stats);
    if (!games) continue;
    const pf = stats.avgPointsFor ? stats.avgPointsFor.value : stats.pointsFor?.value / games;
    const pa = stats.avgPointsAgainst ? stats.avgPointsAgainst.value : stats.pointsAgainst?.value / games;
    if (!Number.isFinite(pf) || !Number.isFinite(pa)) continue;
    rows.push({ id: entry.team.id, ppg: pf, papg: pa });
  }
  const byOff = [...rows].sort((a, b) => b.ppg - a.ppg);
  const byDef = [...rows].sort((a, b) => a.papg - b.papg);
  const ranks = {};
  byOff.forEach((r, i) => { ranks[r.id] = { ...r, off: i + 1, n: rows.length }; });
  byDef.forEach((r, i) => { ranks[r.id].def = i + 1; });
  return ranks;
}

function gamesPlayed(stats) {
  const rec = stats.overall?.displayValue || stats.overall?.summary;
  if (rec && /^\d+-\d+/.test(rec)) return rec.split("-").reduce((sum, n) => sum + (parseInt(n, 10) || 0), 0);
  const w = stats.wins?.value || 0;
  const l = stats.losses?.value || 0;
  const t = stats.ties?.value || 0;
  return w + l + t;
}

function rankClass(rank, n) {
  if (!rank || !n) return "";
  if (rank <= n / 3) return "good";
  if (rank > (2 * n) / 3) return "bad";
  return "mid";
}

function ordinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function parseOdds(comp) {
  const o = (comp.odds || [])[0];
  if (!o) return null;
  const ml = (side) => o.moneyline?.[side]?.close?.odds ?? o[`${side}TeamOdds`]?.moneyLine;
  return {
    spread: o.details,
    total: o.overUnder,
    mlHome: ml("home"),
    mlAway: ml("away"),
    provider: o.provider?.name,
  };
}

function parseGame(ev, ranks) {
  const comp = ev.competitions[0];
  const side = (ha) => {
    const c = comp.competitors.find((x) => x.homeAway === ha);
    const r = ranks[c.team.id] || {};
    return {
      id: c.team.id,
      name: c.team.shortDisplayName || c.team.displayName,
      full: c.team.displayName,
      abbr: c.team.abbreviation,
      logo: c.team.logo,
      record: c.records?.[0]?.summary || "",
      score: c.score,
      rank: c.curatedRank?.current && c.curatedRank.current < 99 ? c.curatedRank.current : null,
      off: r.off, def: r.def, n: r.n,
    };
  };
  const st = comp.status.type;
  return {
    id: ev.id,
    date: new Date(ev.date),
    away: side("away"),
    home: side("home"),
    state: st.state, // pre | in | post
    detail: st.shortDetail,
    odds: parseOdds(comp),
    broadcast: comp.broadcasts?.[0]?.names?.[0] || "",
  };
}

function teamRow(t, g) {
  const n = t.n;
  const ranks = t.off
    ? `<span class="rank ${rankClass(t.off, n)}">Off ${ordinal(t.off)}</span><span class="rank ${rankClass(t.def, n)}">Def ${ordinal(t.def)}</span>`
    : "";
  const showScore = g.state !== "pre";
  return `
    <div class="team">
      <img src="${t.logo || ""}" alt="" loading="lazy">
      <div class="name">${t.rank ? `<small>${t.rank}</small> ` : ""}${t.name}<span class="record">${t.record}</span></div>
      <div class="ranks">${ranks}</div>
      <div class="score">${showScore ? t.score : ""}</div>
    </div>`;
}

function oddsRow(o) {
  if (!o) return "";
  const parts = [];
  if (o.spread) parts.push(`Spread <b>${o.spread}</b>`);
  if (o.total) parts.push(`Total <b>${o.total}</b>`);
  if (o.mlAway || o.mlHome) parts.push(`ML <b>${o.mlAway ?? "–"} / ${o.mlHome ?? "–"}</b>`);
  return parts.length ? `<div class="odds">${parts.join("")}</div>` : "";
}

function gameCard(g) {
  const time = g.state === "pre"
    ? g.date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : g.detail;
  return `
    <article class="game" data-game="${g.id}">
      <div class="game-head">
        <span class="${g.state === "in" ? "live" : ""}">${time}</span>
        <span>${g.broadcast}</span>
      </div>
      ${teamRow(g.away, g)}
      ${teamRow(g.home, g)}
      ${oddsRow(g.odds)}
    </article>`;
}

// Finished games leave the main list and show as a compact final score.
function finalRow(g) {
  const a = parseFloat(g.away.score) || 0;
  const h = parseFloat(g.home.score) || 0;
  const team = (t, win) => `<span class="${win ? "win" : ""}"><img src="${t.logo || ""}" alt="" loading="lazy">${t.abbr} ${t.score}</span>`;
  return `<div class="final-row" data-game="${g.id}">${team(g.away, a > h)}<span class="muted">@</span>${team(g.home, h > a)}<small>${g.detail}</small></div>`;
}

function renderBoard(games) {
  if (typeof renderDegenBar === "function") renderDegenBar();
  const degen = typeof degenOn === "function" && degenOn();
  const shown = degen ? games.filter(degenGame) : games;
  const active = shown.filter((g) => g.state !== "post");
  const done = shown.filter((g) => g.state === "post");
  $("games").innerHTML = (degen ? `<p class="note degen-note">🎲 Degen mode: ${active.length} game${active.length === 1 ? "" : "s"} with your group's teams left${shown.length < games.length ? ` (${games.length - shown.length} hidden)` : ""}. Only players on those teams count.</p>` : "")
    + active.map(gameCard).join("")
    + (done.length ? `<details class="finals" ${active.length ? "" : "open"}><summary>Final scores (${done.length})</summary>${done.map(finalRow).join("")}</details>` : "");
}

function sortGames(games) {
  const worstDef = (g) => Math.max(g.away.def || 0, g.home.def || 0);
  const sorters = {
    time: (a, b) => a.date - b.date,
    weakdef: (a, b) => worstDef(b) - worstDef(a),
    total: (a, b) => (b.odds?.total || 0) - (a.odds?.total || 0),
  };
  return [...games].sort(sorters[state.sort] || sorters.time);
}

let loadToken = 0;

let liveTimer = null;

// quiet: background refresh during live games (keeps the list on screen while it reloads).
async function load(quiet = false) {
  const token = ++loadToken;
  const key = state.league;
  const lg = LEAGUES[key];
  clearTimeout(liveTimer);
  if (!quiet) {
    $("status").textContent = "Loading…";
    $("games").innerHTML = "";
  }
  $("refresh").classList.add("spinning");
  $("date-label").textContent = fmtDate(state.date);

  try {
    const [board, ranks] = await Promise.all([
      getJSON(`${SITE}${lg.path}/scoreboard?dates=${ymd(state.date)}${lg.query}`),
      loadRanks(key).catch(() => state.ranks[key] || {}),
    ]);
    if (token !== loadToken) return;
    state.ranks[key] = ranks;
    const games = sortGames((board.events || []).map((ev) => parseGame(ev, ranks)));
    state.games = games;
    const open = $("games").querySelector(".finals")?.open;
    renderBoard(games);
    if (open) $("games").querySelector(".finals").open = true;
    const live = games.filter((g) => g.state === "in").length;
    const left = games.filter((g) => g.state !== "post").length;
    $("status").textContent = games.length
      ? `${left ? `${left} game${left === 1 ? "" : "s"} left` : `All ${games.length} final`}${live ? ` · ${live} live` : ""} · updated ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
      : "No games on this day.";
    // While games are live, refresh every minute so finished ones drop off on their own.
    if (live) liveTimer = setTimeout(() => { if (!document.hidden) load(true); }, 60 * 1000);
  } catch (err) {
    if (token !== loadToken) return;
    $("status").textContent = `Couldn't load games (${err.message}). Tap ↻ to try again.`;
  } finally {
    if (token === loadToken) $("refresh").classList.remove("spinning");
  }
}

function renderTabs() {
  $("leagues").innerHTML = Object.entries(LEAGUES)
    .map(([key, lg]) => `<button class="tab ${key === state.league ? "active" : ""}" data-league="${key}" role="tab">${lg.label}</button>`)
    .join("");
}

function shiftDay(delta) {
  const d = new Date(state.date);
  d.setDate(d.getDate() + delta);
  state.date = d;
  load();
}

$("leagues").addEventListener("click", (e) => {
  const key = e.target.dataset?.league;
  if (!key || key === state.league) return;
  state.league = key;
  savePref("league", key);
  renderTabs();
  load();
});
$("prev-day").addEventListener("click", () => shiftDay(-1));
$("next-day").addEventListener("click", () => shiftDay(1));
$("refresh").addEventListener("click", () => load());
$("sort").value = state.sort;
$("sort").addEventListener("change", (e) => {
  state.sort = e.target.value;
  savePref("sort", state.sort);
  load();
});

renderTabs();
load();

// Coming back to the app: catch up on scores right away.
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && (state.games || []).some((g) => g.state === "in")) load(true);
});
