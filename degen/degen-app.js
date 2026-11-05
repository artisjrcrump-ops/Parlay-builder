// Degen Parlays: a simple NBA parlay builder for Artis, Kevin and AJ's group game.
// Each person picks props only from their own 6 teams. Uses the same thinking as the main
// Parlay Builder: recent form (last 5) + season hit rate + the estimate vs the line + how the
// opponent defends, overs first, "X+" alternate lines a player keeps clearing, at least 6 legs,
// at most 2 legs per player (both overs, stats that don't overlap). All data is free:
// ESPN for games, rosters, injuries and game logs; DraftKings props from ESPN's odds feed.

const TEAMS = {
  Artis: ["PHI", "BOS", "NY", "LAL", "DET", "POR"],
  Kevin: ["DEN", "TOR", "GS", "MIA", "PHX", "MIN"],
  AJ: ["SA", "CLE", "HOU", "DAL", "WSH", "ATL"],
};
const SITE = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/";
const WEB = "https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/";
const CORE = "https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/";
const STANDINGS = "https://site.api.espn.com/apis/v2/sports/basketball/nba/standings";

// Shared picks board: a free ntfy.sh topic (no account). Each "Share picks" posts that
// person's picks there; Update reads the latest per person. ntfy keeps posts for 12 hours.
const SYNC = "https://ntfy.sh/degen-parlays-82ef139de2c7";

const MIN_LEGS = 6;
const MAX_LEGS = 8;
const TARGET = 1000; // aim for about $1,000 back, stake included

// DraftKings market -> stat key (main over/under lines and "X+" milestone ladders).
const STAT = {
  "Total Points": "points", "Points": "points",
  "Total Rebounds": "rebounds", "Rebounds": "rebounds",
  "Total Assists": "assists", "Assists": "assists",
  "Total 3-Point Field Goals": "threes", "3-Point Field Goals": "threes",
  "Total Points, Rebounds, and Assists": "pra", "Points + Assists + Rebounds": "pra",
  "Total Points and Rebounds": "pr", "Points + Rebounds": "pr",
  "Total Points and Assists": "pa", "Points + Assists": "pa",
  "Total Assists and Rebounds": "ra", "Assists + Rebounds": "ra",
};
const LABEL = { points: "PTS", rebounds: "REB", assists: "AST", threes: "3PM", pra: "PRA", pr: "P+R", pa: "P+A", ra: "R+A" };
const PARTS = { pra: ["points", "rebounds", "assists"], pr: ["points", "rebounds"], pa: ["points", "assists"], ra: ["rebounds", "assists"] };
const parts = (k) => PARTS[k] || [k];

const $ = (id) => document.getElementById(id);
const store = {
  get: (k, d) => { try { return localStorage.getItem(`dg.${k}`) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(`dg.${k}`, v); } catch { /* private mode */ } },
};
const state = { me: store.get("me", ""), who: store.get("who", ""), games: [], board: [], legs: [], stake: parseFloat(store.get("stake", "10")) || 10 };

const getJSON = (url) => fetch(url).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); });
const ymd = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
const dec = (am) => (am > 0 ? 1 + am / 100 : 1 + 100 / -am);
const american = (d) => (d >= 2 ? `+${Math.round((d - 1) * 100)}` : `${Math.round(-100 / (d - 1))}`);
const money = (n) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const signed = (n) => (n > 0 ? `+${n}` : `${n}`);

// Run async jobs a few at a time so phones don't choke.
async function pool(items, n, fn) {
  const out = [];
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const k = i++; try { out[k] = await fn(items[k]); } catch { out[k] = null; } }
  }));
  return out;
}

// --- Data ---

async function loadGames() {
  const data = await getJSON(`${SITE}scoreboard?dates=${ymd(new Date())}`);
  return (data.events || []).map((ev) => {
    const c = ev.competitions[0];
    const side = (s) => {
      const t = c.competitors.find((x) => x.homeAway === s);
      return { id: t.team.id, abbr: t.team.abbreviation, name: t.team.shortDisplayName };
    };
    return { id: ev.id, date: new Date(ev.date), state: ev.status?.type?.state, away: side("away"), home: side("home") };
  });
}

// Ranks from the standings: defense by points allowed (1 = stingiest), offense by points scored (1 = most).
async function loadDefense() {
  const data = await getJSON(STANDINGS);
  const walk = (n) => (n.standings ? n.standings.entries : (n.children || []).flatMap(walk));
  const rows = walk(data).map((e) => {
    const s = Object.fromEntries(e.stats.map((x) => [x.name, x.value]));
    return { id: e.team.id, papg: s.avgPointsAgainst, ppg: s.avgPointsFor };
  }).filter((r) => Number.isFinite(r.papg));
  const off = [...rows].sort((a, b) => b.ppg - a.ppg).map((r) => r.id);
  rows.sort((a, b) => a.papg - b.papg);
  return Object.fromEntries(rows.map((r, i) => [r.id, { rank: i + 1, n: rows.length, off: off.indexOf(r.id) + 1, papg: r.papg, ppg: r.ppg }]));
}

async function loadRoster(teamId) {
  const data = await getJSON(`${SITE}teams/${teamId}/roster`);
  return (data.athletes || []).map((a) => ({ id: a.id, name: a.displayName, injury: a.injuries?.[0]?.status || "" }));
}

async function loadInjuries(gameId) {
  const data = await getJSON(`${SITE}summary?event=${gameId}`).catch(() => ({}));
  const out = {};
  for (const t of data.injuries || []) for (const i of t.injuries || []) out[i.athlete?.id] = i.status || "";
  return out;
}

async function loadLog(id) {
  const data = await getJSON(`${WEB}athletes/${id}/gamelog`);
  const names = data.names || [];
  const rows = [];
  const seen = new Set();
  for (const st of data.seasonTypes || []) {
    if (/preseason/i.test(st.displayName || "")) continue;
    for (const cat of st.categories || []) {
      if (cat.type && cat.type !== "event") continue;
      for (const ev of cat.events || []) {
        if (seen.has(ev.eventId)) continue;
        seen.add(ev.eventId);
        const s = {};
        names.forEach((n, i) => {
          const raw = ev.stats?.[i];
          if (raw == null) return;
          s[n.split("-")[0]] = parseFloat(String(raw).split("-")[0].replace(/,/g, "")) || 0;
        });
        const meta = data.events?.[ev.eventId] || {};
        rows.push({
          date: new Date(meta.gameDate), opp: meta.opponent?.abbreviation || "",
          points: s.points || 0, rebounds: s.totalRebounds || 0, assists: s.assists || 0, threes: s.threePointFieldGoalsMade || 0,
        });
      }
    }
  }
  rows.forEach((r) => { r.pra = r.points + r.rebounds + r.assists; r.pr = r.points + r.rebounds; r.pa = r.points + r.assists; r.ra = r.rebounds + r.assists; });
  return rows.sort((a, b) => b.date - a.date);
}

// DraftKings props for one game: { athleteId: { stat: { line, over, alts: { line: over } } } }.
async function loadProps(gameId) {
  const base = `${CORE}events/${gameId}/competitions/${gameId}/odds/100/propBets?limit=1000`;
  const first = await getJSON(base);
  let items = first.items || [];
  for (let p = 2; p <= (first.pageCount || 1); p++) items = items.concat((await getJSON(`${base}&page=${p}`).catch(() => ({}))).items || []);
  const out = {};
  const seen = {};
  for (const it of items) {
    const aid = (it.athlete?.$ref || "").match(/athletes\/(\d+)/)?.[1];
    const name = it.type?.name || "";
    if (!aid || /1st|2nd|3rd|4th|Quarter|Half/.test(name)) continue;
    const stat = STAT[name.replace(/ Milestones$/, "")];
    const odds = parseInt(it.odds?.american?.value, 10);
    if (!stat || !Number.isFinite(odds)) continue;
    const s = ((out[aid] ||= {})[stat] ||= { line: NaN, over: null, alts: {} });
    if (/Milestones$/.test(name)) {
      const thr = parseFloat(it.odds?.total?.value ?? it.current?.target?.value);
      if (Number.isFinite(thr) && !(thr in s.alts)) s.alts[thr] = odds;
    } else {
      const line = parseFloat(it.odds?.total?.value);
      const k = `${aid}|${stat}|${line}`;
      seen[k] = (seen[k] || 0) + 1;
      if (seen[k] === 1 && (!Number.isFinite(s.line) || s.line === line)) { s.line = line; s.over = odds; } // over comes first
    }
  }
  return out;
}

// --- Scoring (same ideas as the main app) ---

const avg = (rows, k) => (rows.length ? rows.reduce((t, r) => t + r[k], 0) / rows.length : 0);

// Every DraftKings option for one player and stat: the main over plus each "X+" rung.
// Each gets a hit-rate based chance; the ones worth betting are marked rec (⭐).
function propOptions(player, stat, prop, rows, def) {
  const last5 = rows.slice(0, 5);
  const defPct = def ? def.rank / def.n : 0.5; // closer to 1 = worse defense
  const est = rows.length ? (0.6 * avg(last5, stat) + 0.4 * avg(rows, stat)) * (0.94 + defPct * 0.12) : NaN;
  const base = { player: player.name, pid: player.id, team: player.team, opp: player.opp.abbr, gameId: player.gameId, stat, est: Math.round(est * 10) / 10, defRank: def?.rank };
  const options = [];
  if (Number.isFinite(prop.line) && prop.over) {
    const hit = (r) => r[stat] > prop.line;
    const l5 = last5.filter(hit).length;
    const all = rows.filter(hit).length;
    const edge = (est - prop.line) / Math.max(prop.line, 1);
    const prob = rows.length ? 0.45 * (all / rows.length) + 0.3 * (l5 / last5.length) + 0.25 * (0.5 + Math.max(-0.3, Math.min(0.3, edge * 2))) + (defPct - 0.5) * 0.08 : 0;
    const d = dec(prop.over);
    const rec = rows.length >= 3 && prob >= 0.55 && prob - 1 / d > 0 && est - prop.line > -0.5;
    options.push({ ...base, id: `${player.id}|${stat}|o${prop.line}`, sort: prop.line, text: `Over ${prop.line} ${LABEL[stat]}`, odds: prop.over, dec: d, l5, l5n: last5.length, all, n: rows.length, prob, value: prob - 1 / d, rec });
  }
  for (const [thr, odds] of Object.entries(prop.alts)) {
    const t = parseFloat(thr);
    const d = dec(odds);
    const l5 = last5.filter((r) => r[stat] >= t).length;
    const all = rows.filter((r) => r[stat] >= t).length;
    const prob = rows.length ? Math.min(0.97, 0.6 * (all / rows.length) + 0.4 * (l5 / last5.length) + (defPct - 0.5) * 0.06) : 0;
    // A rung he keeps clearing: 4+ of last 5, 70%+ of the season, priced about -400 to -105.
    const rec = d >= 1.25 && d <= 1.95 && last5.length >= 4 && l5 >= last5.length - 1 && all / rows.length >= 0.7 && est - t > -0.5 && prob - 1 / d > 0;
    options.push({ ...base, id: `${player.id}|${stat}|a${t}`, sort: t - 0.5, text: `${t}+ ${LABEL[stat]}`, alt: true, odds, dec: d, l5, l5n: last5.length, all, n: rows.length, prob, value: prob - 1 / d, rec });
  }
  return options.sort((a, b) => a.sort - b.sort);
}

// Loads every player with DraftKings props on your teams' games today.
async function loadBoard(progress) {
  const mine = TEAMS[state.who];
  const games = state.games.filter((g) => g.state !== "post" && (mine.includes(g.away.abbr) || mine.includes(g.home.abbr)));
  if (!games.length) return [];
  progress("Loading lines…");
  const [defense, props] = await Promise.all([loadDefense().catch(() => ({})), Promise.all(games.map((g) => loadProps(g.id).catch(() => ({}))))]);
  const teams = [];
  for (const [i, g] of games.entries()) {
    const inj = await loadInjuries(g.id);
    for (const side of ["away", "home"]) {
      const team = g[side];
      if (!mine.includes(team.abbr)) continue; // only your teams, never the opponent's players
      const opp = g[side === "away" ? "home" : "away"];
      const roster = await loadRoster(team.id).catch(() => []);
      const players = [];
      for (const p of roster) {
        const status = inj[p.id] || p.injury || "";
        if (/out|doubtful/i.test(status)) continue; // ruled-out players never make it in
        if (props[i][p.id]) players.push({ ...p, status, team: team.abbr, opp, gameId: g.id, props: props[i][p.id], def: defense[opp.id] });
      }
      teams.push({ team, opp, game: g, def: defense[opp.id], own: defense[team.id], players });
    }
  }
  const all = teams.flatMap((t) => t.players);
  let done = 0;
  await pool(all, 6, async (p) => {
    const rows = await loadLog(p.id).catch(() => []);
    progress(`Checking players… ${++done}/${all.length}`);
    p.stats = Object.entries(p.props)
      .sort(([a], [b]) => Object.keys(LABEL).indexOf(a) - Object.keys(LABEL).indexOf(b))
      .map(([stat, prop]) => ({ stat, options: propOptions(p, stat, prop, rows, p.def) }));
    p.recs = p.stats.flatMap((s) => s.options.filter((o) => o.rec));
  });
  for (const t of teams) {
    t.players.forEach((p) => { p.stats ||= []; p.recs ||= []; });
    t.players.sort((a, b) => b.recs.length - a.recs.length || (b.props.points?.line || 0) - (a.props.points?.line || 0));
  }
  return teams;
}

// Best ⭐ option per player and stat, strongest first.
function topPicks() {
  const best = {};
  for (const t of state.board) for (const p of t.players) for (const o of p.recs) {
    const k = `${o.pid}|${o.stat}`;
    if (!best[k] || o.prob + o.value > best[k].prob + best[k].value) best[k] = o;
  }
  return Object.values(best).sort((a, b) => (b.prob + b.value) - (a.prob + a.value));
}

// 2 legs per player at most, and only when they don't overlap (PTS + REB yes, PTS + PRA no).
function fits(legs, c) {
  const same = legs.filter((l) => l.pid === c.pid);
  if (same.length >= 2) return false;
  return same.every((l) => !parts(l.stat).some((x) => parts(c.stat).includes(x)));
}

function buildParlay(picks) {
  const games = new Set(picks.map((p) => p.gameId)).size || 1;
  const perGame = Math.max(2, Math.ceil(MIN_LEGS / games));
  const legs = [];
  for (const c of picks) {
    if (legs.length >= MAX_LEGS) break;
    const pay = state.stake * legs.reduce((d, l) => d * l.dec, 1);
    if (legs.length >= MIN_LEGS && pay >= TARGET) break;
    if (!fits(legs, c) || legs.filter((l) => l.gameId === c.gameId).length >= perGame) continue;
    legs.push({ ...c, on: true });
  }
  return legs;
}

// --- UI ---

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const time = (g) => (g.state === "pre" ? g.date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "Live");
const tone = (rank) => (rank <= 10 ? "good" : rank >= 21 ? "bad" : "");
const nth = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : { 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th"}`;

function renderWho() {
  $("who").innerHTML = Object.keys(TEAMS).map((w) =>
    { const n = w === state.who ? state.legs.length : loadSlip(w).legs.length; return `<button class="${w === state.who ? "on" : ""}" data-who="${w}">${w}${n ? ` <span class="pill">${n}</span>` : ""}<small>${TEAMS[w].join(" ")}</small></button>`; }).join("");
}

function renderStatus() {
  if (!state.me) { $("status").textContent = "Who are you? Tap your name (one time)."; return; }
  if (!state.who) { $("status").textContent = ""; return; }
  const mine = TEAMS[state.who];
  const games = state.games.filter((g) => mine.includes(g.away.abbr) || mine.includes(g.home.abbr));
  const open = games.filter((g) => g.state !== "post");
  if (!open.length) { $("status").textContent = games.length ? `${state.who}'s games today are over.` : `None of ${state.who}'s teams play today.`; return; }
  const playing = [...new Set(open.flatMap((g) => [g.away.abbr, g.home.abbr]).filter((a) => mine.includes(a)))];
  $("status").textContent = `${state.who}'s teams today: ${playing.join(", ")}`;
}

// Each person's picks live in their own tab, saved on this phone. "Share my picks" makes a
// link with the picks inside it; opening it fills that person's tab for whoever taps it.
const KEEP = ["id", "pid", "player", "text", "odds", "dec", "team", "opp", "gameId", "stat", "alt", "l5", "l5n", "all", "n", "on"];
function loadSlip(who) {
  const today = new Date().setHours(0, 0, 0, 0);
  try {
    const slip = JSON.parse(store.get(`slip.${who}`, "null"));
    return slip && slip.at >= today ? slip : { legs: [], at: 0 }; // yesterday's picks drop off
  } catch { return { legs: [], at: 0 }; }
}
const isMine = () => state.who && state.who === state.me;
function saveSlip() {
  if (!isMine()) return; // you can only change your own picks
  const legs = state.legs.map((l) => Object.fromEntries(KEEP.map((k) => [k, l[k]])));
  store.set(`slip.${state.who}`, JSON.stringify({ legs, at: Date.now(), shared: state.shared || 0 }));
}
const b64 = (str) => btoa(unescape(encodeURIComponent(str))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64 = (str) => decodeURIComponent(escape(atob(str.replace(/-/g, "+").replace(/_/g, "/"))));
// Post my picks to the shared board.
async function pushPicks() {
  const legs = state.legs.filter((l) => l.on).map((l) => [l.player, l.text, l.odds, l.team, l.opp, l.id, l.l5, l.l5n, l.all, l.n]);
  const r = await fetch(SYNC, { method: "POST", body: JSON.stringify({ w: state.who, d: ymd(new Date()), s: state.stake, l: legs }) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
}

// Pull everyone's latest shared picks; a newer copy replaces what this phone has.
async function pullPicks() {
  const text = await fetch(`${SYNC}/json?poll=1&since=12h`).then((r) => (r.ok ? r.text() : ""));
  const latest = {};
  for (const line of text.split("\n")) {
    try {
      const m = JSON.parse(line);
      if (m.event !== "message") continue;
      const data = JSON.parse(m.message);
      if (!TEAMS[data.w] || data.d !== ymd(new Date()) || !Array.isArray(data.l)) continue;
      if (!latest[data.w] || m.time > latest[data.w].time) latest[data.w] = { time: m.time, data };
    } catch { /* skip anything that isn't a pick post */ }
  }
  for (const [w, { time, data }] of Object.entries(latest)) {
    const mine = loadSlip(w);
    if (time * 1000 <= mine.at) continue; // this phone has newer edits
    store.set(`slip.${w}`, JSON.stringify({ legs: fromWire(data.l), at: time * 1000, shared: 1, stake: data.s }));
  }
  return Object.keys(latest);
}

const fromWire = (l) => l.map(([player, text, odds, team, opp, id, l5, l5n, all, n]) =>
  ({ id, pid: String(id).split("|")[0], player, text, odds, dec: dec(odds), team, opp, alt: /\+ /.test(text), stat: String(id).split("|")[1], l5, l5n, all, n, on: true }));

function shareLink() {
  const legs = state.legs.filter((l) => l.on).map((l) => [l.player, l.text, l.odds, l.team, l.opp, l.id, l.l5, l.l5n, l.all, l.n]);
  const data = { w: state.who, d: ymd(new Date()), s: state.stake, l: legs };
  return `${location.origin}${location.pathname}#p=${b64(JSON.stringify(data))}`;
}
function importLink() {
  const m = location.hash.match(/#p=([\w-]+)/);
  if (!m) return null;
  history.replaceState(null, "", location.pathname);
  try {
    const data = JSON.parse(unb64(m[1]));
    if (!TEAMS[data.w] || !Array.isArray(data.l)) return null;
    const legs = fromWire(data.l);
    if (data.w !== store.get("me", "") && data.d === ymd(new Date())) store.set(`slip.${data.w}`, JSON.stringify({ legs, at: Date.now(), shared: 1, stake: data.s }));
    return data.w;
  } catch { return null; }
}

function inSlip(id) { return state.legs.some((l) => l.id === id); }

function optionRow(o) {
  const hits = o.n ? `${o.l5}/${o.l5n} last 5 · ${Math.round((100 * o.all) / o.n)}% season` : "no recent games";
  return `<button class="opt ${o.rec ? "rec" : ""} ${inSlip(o.id) ? "in" : ""}" data-opt="${esc(o.id)}">
    <span>${o.rec ? "⭐ " : ""}${o.text}<small>${hits}</small></span><b>${signed(o.odds)}</b></button>`;
}

function renderBoard() {
  if (!state.board.length) { $("board").innerHTML = ""; return; }
  $("board").innerHTML = state.board.map((t) => `
    <div class="card team">
      <h2>${t.team.abbr} <span class="vs">vs ${t.opp.abbr} · ${time(t.game)}</span></h2>
      ${t.own && t.def ? `<div class="ranks">
        <div><b>${t.team.abbr}</b> Off <span class="${tone(t.own.off)}">${nth(t.own.off)}</span> · Def <span class="${tone(t.own.rank)}">${nth(t.own.rank)}</span></div>
        <div><b>${t.opp.abbr}</b> Off <span class="${tone(t.def.off)}">${nth(t.def.off)}</span> · Def <span class="${tone(t.def.rank)}">${nth(t.def.rank)}</span>${t.def.rank >= 21 ? " 🔥 soft D" : t.def.rank <= 10 ? " 🧱 tough D" : ""}</div>
      </div>` : ""}
      ${t.players.length ? t.players.map((p) => `
        <details ${p.recs.length ? "open" : ""}>
          <summary><b>${esc(p.name)}</b>${p.status ? ` <em>${esc(p.status)}</em>` : ""}<span class="cnt">${p.recs.length ? `⭐ ${p.recs.length}` : ""}</span></summary>
          ${p.stats.map((s) => `<div class="stat"><h3>${LABEL[s.stat]}${Number.isFinite(p.props[s.stat].line) ? ` · line ${p.props[s.stat].line}` : ""}${s.options[0]?.n ? ` · est ${s.options[0].est}` : ""}</h3>
            <div class="opts">${s.options.map(optionRow).join("")}</div></div>`).join("")}
        </details>`).join("") : `<p class="note">No props posted for ${t.team.abbr} yet. They usually show up a few hours before tip-off.</p>`}
    </div>`).join("");
}

function renderParlay() {
  renderWho();
  const mine = isMine();
  const slip = mine ? { legs: state.legs, stake: state.stake } : loadSlip(state.who);
  const stake = slip.stake || state.stake;
  const on = slip.legs.filter((l) => l.on);
  const d = on.reduce((t, l) => t * l.dec, 1);
  const hits = (l) => `${l.team} vs ${l.opp} · ${l.n ? `${l.l5}/${l.l5n} last 5 · ${l.all}/${l.n} season` : "no recent games"}`;
  if (!state.who) { $("parlay").innerHTML = ""; return; }
  if (!mine) {
    const when = slip.at ? new Date(slip.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
    $("parlay").innerHTML = `<div class="card slip">
      <h2>${state.who}'s picks${on.length ? ` · ${on.length} legs` : ""}</h2>
      ${on.length ? on.map((l) => `<div class="leg"><span class="main"><b>${esc(l.player)}</b> ${esc(l.text)}${l.alt ? " 🪜" : ""}<small>${esc(hits(l))}</small></span><span class="odds">${signed(l.odds)}</span></div>`).join("") + `
      <div class="pay"><span>$${stake} stake</span><span>${american(d)} · pays <b>${money(stake * d)}</b></span></div>
      <p class="note">Shared at ${when}. Only ${state.who} can change these. Tap ↻ Update for the latest.</p>
      <div class="row"><button id="copy">📋 Copy</button></div>`
      : `<p class="note">${state.who} hasn't shared picks today yet. Tap ↻ Update to check again.</p>`}
    </div>`;
    return;
  }
  $("parlay").innerHTML = state.legs.length ? `
    <div class="card slip">
      <h2>My picks · ${on.length} legs</h2>
      ${state.legs.map((l, i) => `
        <label class="leg ${l.on ? "" : "off"}"><input type="checkbox" data-leg="${i}" ${l.on ? "checked" : ""}>
          <span class="main"><b>${esc(l.player)}</b> ${esc(l.text)}${l.alt ? " 🪜" : ""}<small>${esc(hits(l))}</small></span>
          <span class="odds">${signed(l.odds)}</span><button class="x" data-del="${i}" aria-label="Remove">✕</button></label>`).join("")}
      <div class="pay"><label>Stake $<input id="stake" type="number" inputmode="decimal" min="1" value="${state.stake}"></label>
        <span>${on.length ? american(d) : "–"} · pays <b>${money(state.stake * d)}</b></span></div>
      <p class="note">Tap any prop below to add or remove it. Tap 📤 Share so the others see your picks. Same-game legs get repriced by the book, so the real payout is usually a bit lower.</p>
      <div class="row"><button id="share">📤 Share picks</button><button id="copy">📋 Copy</button><button id="clear">Clear</button></div>
    </div>` : "";
}

// After any change to my picks: save them, then redraw.
function changed() { saveSlip(); renderParlay(); renderBoard(); }

function renderAll() {
  renderWho(); renderStatus(); renderParlay(); renderBoard();
  $("build").hidden = !isMine() || !state.board.some((t) => t.players.length);
  $("me").innerHTML = state.me ? `You're ${state.me}. You can only pick from your own teams. <button id="notme" class="link">Not ${state.me}?</button>` : "";
}

async function load() {
  const who = state.who;
  state.board = []; state.legs = loadSlip(who).legs;
  renderAll();
  if (!who) return;
  await pullPicks().catch(() => []);
  if (state.who !== who) return;
  if (!isMine()) { renderAll(); return; } // other people's tabs only show their shared picks
  state.legs = loadSlip(who).legs;
  renderAll();
  try {
    const board = await loadBoard((msg) => { if (state.who === who) $("status").textContent = msg; });
    if (state.who !== who) return; // switched names while loading
    state.board = board;
  } catch (err) {
    $("status").textContent = `Couldn't load props (${err.message}). Try again in a minute.`;
    return;
  }
  renderAll();
}

document.addEventListener("click", (e) => {
  const t = e.target.closest("button");
  if (!t) return;
  if (t.dataset.who) {
    if (!state.me) { state.me = t.dataset.who; store.set("me", state.me); state.who = ""; }
    if (t.dataset.who === state.who) return;
    state.who = t.dataset.who;
    store.set("who", state.who);
    load();
  } else if (t.id === "update") {
    update(t);
  } else if (t.id === "notme") {
    state.me = ""; store.set("me", ""); state.who = ""; store.set("who", "");
    state.board = []; state.legs = [];
    renderAll();
  } else if (!isMine() && t.id !== "copy") {
    // someone else's tab: look, don't touch
  } else if (t.id === "build") {
    state.legs = buildParlay(topPicks());
    if (!state.legs.length) $("status").textContent = "No ⭐ picks yet today. Tap props below to make your own.";
    changed();
    $("parlay").scrollIntoView({ behavior: "smooth" });
  } else if (t.dataset.opt) {
    const id = t.dataset.opt;
    const i = state.legs.findIndex((l) => l.id === id);
    if (i >= 0) state.legs.splice(i, 1);
    else {
      const o = state.board.flatMap((x) => x.players).flatMap((p) => p.stats).flatMap((s) => s.options).find((x) => x.id === id);
      if (o) state.legs = state.legs.filter((l) => !(l.pid === o.pid && l.stat === o.stat)).concat({ ...o, on: true }); // one line per stat
    }
    changed();
  } else if (t.dataset.del) {
    e.preventDefault();
    state.legs.splice(+t.dataset.del, 1);
    changed();
  } else if (t.id === "clear") {
    state.legs = [];
    changed();
  } else if (t.id === "share") {
    t.textContent = "Sharing…";
    pushPicks().then(() => { t.textContent = "Shared ✓ (others tap Update)"; }, () => { t.textContent = "Couldn't share. Try again"; });
  } else if (t.id === "copy") {
    const legs = isMine() ? state.legs : loadSlip(state.who).legs;
    const text = legs.filter((l) => l.on).map((l) => `${l.player} ${l.text}`).join("\n");
    navigator.clipboard?.writeText(text).then(() => { t.textContent = "Copied ✓"; }, () => { t.textContent = "Couldn't copy"; });
  }
});

document.addEventListener("change", (e) => {
  if (e.target.dataset.leg && isMine()) { state.legs[+e.target.dataset.leg].on = e.target.checked; changed(); }
  if (e.target.id === "stake") {
    const v = parseFloat(e.target.value);
    if (v > 0) { state.stake = v; store.set("stake", String(v)); changed(); }
  }
});

// Update: fresh games, lines and everyone's latest picks.
async function update(btn) {
  btn.disabled = true; btn.textContent = "Updating…";
  try { state.games = await loadGames(); } catch { /* keep what we have */ }
  await load();
  btn.disabled = false; btn.textContent = "↻ Update";
}

(async function start() {
  const from = importLink();
  if (from) { state.who = from; store.set("who", from); }
  if (!state.me) state.who = "";
  renderWho();
  $("status").textContent = "Loading today's games…";
  try {
    state.games = await loadGames();
  } catch {
    $("status").textContent = "Couldn't load today's games. Pull to refresh.";
    return;
  }
  load();
})();
