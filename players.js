// Game sheet and player view: rosters, last 5 games, and an estimated line for tonight.
// Shares globals from app.js (state, LEAGUES, SITE, WEB, getJSON, $).

const KEY_STATS = {
  basketball: [
    { key: "points", label: "PTS" },
    { key: "totalRebounds", label: "REB" },
    { key: "assists", label: "AST" },
    { key: "threes", label: "3PM" },
    { key: "pra", label: "PRA" },
    { key: "steals", label: "STL" },
    { key: "blocks", label: "BLK" },
    { key: "pr", label: "P+R" },
    { key: "pa", label: "P+A" },
    { key: "ra", label: "R+A" },
    { key: "dd", label: "DD" },
  ],
  football: [
    { key: "passingYards", label: "Pass Yds" },
    { key: "passingTouchdowns", label: "Pass TD" },
    { key: "completions", label: "Cmp" },
    { key: "passingAttempts", label: "Att" },
    { key: "interceptions", label: "INT" },
    { key: "rushingYards", label: "Rush Yds" },
    { key: "rushingTouchdowns", label: "Rush TD" },
    { key: "receptions", label: "Rec" },
    { key: "receivingYards", label: "Rec Yds" },
    { key: "receivingTouchdowns", label: "Rec TD" },
    { key: "longReception", label: "Long Rec" },
    { key: "rushRec", label: "Rush+Rec" },
    { key: "tds", label: "TDs" },
  ],
};

const FOOTBALL_POSITIONS = ["QB", "RB", "WR", "TE"];

const sheet = { game: null, side: "away", injuries: {}, leaders: {}, rosters: {}, logs: {} };

function sportOf(key) {
  return LEAGUES[key].path.split("/")[0];
}

function openSheet() {
  $("sheet").hidden = false;
  document.body.classList.add("sheet-open");
}

function closeSheet() {
  $("sheet").hidden = true;
  $("sheet-back").hidden = true;
  document.body.classList.remove("sheet-open");
  sheet.game = null;
}

async function openGame(gameId) {
  const g = state.games.find((x) => x.id === gameId);
  if (!g) return;
  sheet.game = g;
  sheet.side = "away";
  sheet.injuries = {};
  sheet.leaders = {};
  $("sheet-title").textContent = `${g.away.abbr} @ ${g.home.abbr}`;
  $("sheet-body").innerHTML = `<p class="status">Loading players…</p>`;
  openSheet();

  const lg = LEAGUES[state.league];
  try {
    const summary = await getJSON(`${SITE}${lg.path}/summary?event=${g.id}`);
    for (const team of summary.injuries || []) {
      for (const inj of team.injuries || []) {
        if (inj.athlete?.id) sheet.injuries[inj.athlete.id] = inj.status;
      }
    }
    for (const team of summary.leaders || []) {
      for (const cat of team.leaders || []) {
        const a = cat.leaders?.[0]?.athlete;
        if (a?.id) sheet.leaders[a.id] = true;
      }
    }
  } catch { /* summary is optional */ }
  if (sheet.game === g) renderGame();
}

async function loadRoster(teamId) {
  const key = `${state.league}:${teamId}`;
  if (sheet.rosters[key]) return sheet.rosters[key];
  const data = await getJSON(`${SITE}${LEAGUES[state.league].path}/teams/${teamId}/roster`);
  let players = data.athletes || [];
  // Football rosters come grouped by unit; basketball is a flat list.
  if (players[0]?.items) {
    players = players.filter((grp) => grp.position === "offense").flatMap((grp) => grp.items);
    players = players.filter((p) => FOOTBALL_POSITIONS.includes(p.position?.abbreviation));
    const order = (p) => FOOTBALL_POSITIONS.indexOf(p.position?.abbreviation);
    players.sort((a, b) => order(a) - order(b));
  }
  sheet.rosters[key] = players.map((p) => ({
    id: p.id,
    name: p.displayName,
    pos: p.position?.abbreviation || "",
    jersey: p.jersey || "",
    headshot: p.headshot?.href || "",
  }));
  return sheet.rosters[key];
}

async function renderGame() {
  const g = sheet.game;
  const team = g[sheet.side];
  const tabs = ["away", "home"]
    .map((s) => `<button class="tab ${s === sheet.side ? "active" : ""}" data-side="${s}">${g[s].name}</button>`)
    .join("");
  const sgpBtn = g.state === "pre" ? `<button class="btn primary sgp-inline" data-sgp-game="${g.id}">🎯 Build same-game parlays</button>` : "";
  $("sheet-body").innerHTML = `${sgpBtn}<div class="tabs">${tabs}</div><div id="roster"><p class="status">Loading roster…</p></div>`;
  try {
    const players = await loadRoster(team.id);
    if (sheet.game !== g) return;
    // Game leaders first, then everyone else in roster order.
    const sorted = [...players].sort((a, b) => (sheet.leaders[b.id] ? 1 : 0) - (sheet.leaders[a.id] ? 1 : 0));
    $("roster").innerHTML = sorted.map((p) => {
      const inj = sheet.injuries[p.id];
      return `
        <button class="player" data-player="${p.id}">
          ${p.headshot ? `<img src="${p.headshot}" alt="" loading="lazy">` : `<span class="no-img"></span>`}
          <span class="pname">${p.name}${sheet.leaders[p.id] ? ` <span class="star" title="Team leader">★</span>` : ""}</span>
          <span class="ppos">${p.pos}</span>
          ${inj ? `<span class="inj">${inj}</span>` : ""}
        </button>`;
    }).join("") || `<p class="status">No players listed.</p>`;
  } catch (err) {
    $("roster").innerHTML = `<p class="status">Couldn't load roster (${err.message}).</p>`;
  }
}

// Gamelog → rows sorted newest first, each { date, opp, atVs, result, stats: {name: number} }.
async function loadGameLog(playerId, league = state.league, fresh = false, season = "") {
  const key = `${league}:${playerId}${season ? `:${season}` : ""}`;
  if (sheet.logs[key] && !fresh) return sheet.logs[key];
  const data = await getJSON(`${WEB}${LEAGUES[league].path}/athletes/${playerId}/gamelog${season ? `?season=${season}` : ""}`);
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
        const meta = data.events?.[ev.eventId] || {};
        const stats = {};
        names.forEach((n, i) => {
          const raw = ev.stats?.[i];
          if (raw == null) return;
          if (n.includes("-")) {
            // "made-attempted" pairs, e.g. threePointFieldGoalsMade-threePointFieldGoalsAttempted
            const [made] = String(raw).split("-");
            stats[n.split("-")[0]] = parseFloat(made) || 0;
          } else {
            stats[n] = parseFloat(String(raw).replace(/,/g, "")) || 0;
          }
        });
        stats.threes = stats.threePointFieldGoalsMade ?? 0;
        stats.pra = (stats.points || 0) + (stats.totalRebounds || 0) + (stats.assists || 0);
        stats.tds = (stats.rushingTouchdowns || 0) + (stats.receivingTouchdowns || 0);
        stats.rushRec = (stats.rushingYards || 0) + (stats.receivingYards || 0);
        stats.pr = (stats.points || 0) + (stats.totalRebounds || 0);
        stats.pa = (stats.points || 0) + (stats.assists || 0);
        stats.ra = (stats.totalRebounds || 0) + (stats.assists || 0);
        stats.dd = ["points", "totalRebounds", "assists", "steals", "blocks"]
          .filter((k) => (stats[k] || 0) >= 10).length >= 2 ? 1 : 0;
        rows.push({
          eventId: ev.eventId,
          date: new Date(meta.gameDate),
          opp: meta.opponent?.abbreviation || "",
          atVs: meta.atVs || "",
          result: meta.gameResult ? `${meta.gameResult} ${meta.score || ""}` : "",
          stats,
        });
      }
    }
  }
  rows.sort((a, b) => b.date - a.date);
  const seasonNow = parseInt((data.filters || []).find((f) => f.name === "season")?.value, 10) || null;
  sheet.logs[key] = { rows, names, season: seasonNow };
  return sheet.logs[key];
}

function avg(rows, key) {
  if (!rows.length) return null;
  return rows.reduce((s, r) => s + (r.stats[key] || 0), 0) / rows.length;
}

// Estimate: 60% last-5 form + 40% season average, scaled by how many points
// tonight's opponent allows versus the league average (capped at ±10%).
function opponentFactor(oppId) {
  const ranks = state.ranks[state.league] || {};
  const all = Object.values(ranks);
  const opp = ranks[oppId];
  if (!opp || !all.length) return 1;
  const leagueAvg = all.reduce((s, r) => s + r.papg, 0) / all.length;
  return Math.min(1.1, Math.max(0.9, opp.papg / leagueAvg));
}

function fmt(n, key) {
  if (n == null || !Number.isFinite(n)) return "–";
  return /Touchdowns/.test(key) ? n.toFixed(2) : n.toFixed(1);
}

// Main line plus FanDuel's "X+" rungs for each prop, with how often he cleared each one.
function altTable({ rows, lines, stats, opp, home }) {
  const blocks = stats.filter((st) => lines?.[st.key] && ALT_STEPS[st.key]).map((st) => {
    const l = lines[st.key];
    const ladder = altLadder({ rows, statKey: st.key, l, opp, home })
      .filter((r) => r.thr <= l.line + 1.5 * Math.max(3, l.line * 0.3) && r.thr >= l.line * 0.35);
    if (!ladder.length) return "";
    const main = hits(rows, st.key, "over", l.line);
    const cell = (h, n) => (n ? `${h}/${n}` : "–");
    return `<tr class="alt-head"><td colspan="5"><b>${st.label}</b> · main line O ${l.line} ${l.over || ""} · L5 ${main.l5}/${main.l5n} · season ${main.all}/${main.n}</td></tr>
      ${ladder.map((r) => `<tr class="${r.l5n && r.l5 === r.l5n ? "alt-hot" : ""}"><td>${r.thr}+</td><td>${cell(r.l5, r.l5n)}</td><td>${cell(r.all, r.n)}</td><td>${cell(r.vs, r.vsn)}</td><td>${r.source === "estimated" ? "~" : ""}${r.odds || "–"}</td></tr>`).join("")}`;
  }).join("");
  return blocks ? `<h3 class="pick-title">Alternate lines</h3>
    <div class="table-wrap"><table class="log alt-table">
      <thead><tr><th>Line</th><th>L5</th><th>Season</th><th>Vs opp</th><th>Price</th></tr></thead>
      <tbody>${blocks}</tbody></table></div>
    <p class="note">How often he reached each "X+" line. Green = all of his last 5. ~ = estimated price; check FanDuel.</p>` : "";
}

async function openPlayer(playerId) {
  const g = sheet.game;
  const team = g[sheet.side];
  const opp = g[sheet.side === "away" ? "home" : "away"];
  const roster = sheet.rosters[`${state.league}:${team.id}`] || [];
  const p = roster.find((x) => x.id === playerId) || { name: "Player" };
  $("sheet-title").textContent = p.name;
  $("sheet-back").hidden = false;
  $("sheet-body").innerHTML = `<p class="status">Loading game log…</p>`;

  try {
    const { rows, names } = await loadGameLog(playerId);
    if (sheet.game !== g) return;
    const has = new Set([...names.map((n) => n.split("-")[0]), "threes", "pra"]);
    if (has.has("rushingTouchdowns") || has.has("receivingTouchdowns")) has.add("tds");
    if (has.has("rushingYards") && has.has("receivingYards")) has.add("rushRec");
    let stats = KEY_STATS[sportOf(state.league)].filter((s) => has.has(s.key));
    if (sportOf(state.league) === "basketball") stats = KEY_STATS.basketball;
    if (!rows.length) {
      $("sheet-body").innerHTML = `<p class="status">No games played this season yet.</p>`;
      return;
    }
    const last5 = rows.slice(0, 5);
    const factor = opponentFactor(opp.id);
    const inj = sheet.injuries[playerId];

    const head = stats.map((s) => `<th>${s.label}</th>`).join("");
    const gameRows = last5.map((r) => `
      <tr>
        <td class="gdate">${r.date.toLocaleDateString([], { month: "numeric", day: "numeric" })}<br><small>${r.atVs} ${r.opp}</small></td>
        ${stats.map((s) => `<td>${r.stats[s.key] ?? 0}</td>`).join("")}
      </tr>`).join("");
    const avgRow = (label, set) => `
      <tr class="avg"><td>${label}</td>${stats.map((s) => `<td>${fmt(avg(set, s.key), s.key)}</td>`).join("")}</tr>`;
    const predRow = `
      <tr class="pred"><td>This game<br><small>est.</small></td>${stats.map((s) => {
        const l5 = avg(last5, s.key);
        const season = avg(rows, s.key);
        return `<td>${fmt((0.6 * l5 + 0.4 * season) * factor, s.key)}</td>`;
      }).join("")}</tr>`;

    let lines = null;
    let linesError = "";
    try {
      lines = await getPlayerLines(g, p.name, p.id);
    } catch (err) {
      linesError = err.message;
    }
    if (sheet.game !== g) return;
    const estimate = (key) => (0.6 * avg(last5, key) + 0.4 * avg(rows, key)) * factor;
    const fdRow = lines ? `
      <tr class="fd"><td>${LINE_SOURCE}<br><small>line</small></td>${stats.map((s) => {
        if (s.key === "tds") {
          const a = lines.anytimeTd;
          const t = lines.twoTd;
          return `<td>${a || t ? `${a ? `ATD ${a.over}` : ""}<br><small>${t ? `2+ ${t.over}` : ""}</small>` : "–"}</td>`;
        }
        if (s.key === "dd") return `<td>${lines.doubleDouble ? `Yes ${lines.doubleDouble.over}` : "–"}</td>`;
        const l = lines[s.key];
        return `<td>${l ? `${l.line}<br><small>${l.over ?? ""}/${l.under ?? ""}</small>` : "–"}</td>`;
      }).join("")}</tr>
      <tr class="edge"><td>Est. vs line</td>${stats.map((s) => {
        const l = lines[s.key];
        if (!l || s.key === "tds" || s.key === "dd") return "<td></td>";
        const d = estimate(s.key) - l.line;
        return `<td class="${d >= 0 ? "up" : "down"}">${d >= 0 ? "+" : ""}${fmt(d, s.key)}</td>`;
      }).join("")}</tr>` : "";
    const linesNote = linesError
      ? `Couldn't load FanDuel lines (${linesError}).`
      : !lines
        ? "Add your free SportsGameOdds key in ⚙︎ Settings to see FanDuel lines here."
        : Object.keys(lines).length
          ? "FanDuel lines refresh about every 10 minutes."
          : "FanDuel hasn't posted props for this player yet.";

    const oppRank = opp.def ? `${opp.name} defense ranks ${ordinal(opp.def)} of ${opp.n} in points allowed` : `${opp.name}`;
    const adj = Math.round((factor - 1) * 100);
    $("sheet-body").innerHTML = `
      ${inj ? `<p class="inj-banner">Injury status: ${inj}</p>` : ""}
      <p class="matchup">Vs ${oppRank}. Estimate adjusted ${adj >= 0 ? "+" : ""}${adj}% for the matchup.</p>
      <div id="matchup-warn"></div>
      <div class="table-wrap">
        <table class="log">
          <thead><tr><th></th>${head}</tr></thead>
          <tbody>${gameRows}${avgRow("Last 5", last5)}${avgRow(`Season (${rows.length})`, rows)}${predRow}${fdRow}</tbody>
        </table>
      </div>
      <p class="note">Estimate = 60% last 5 + 40% season, scaled for this opponent. ${linesNote}</p>
      ${propPicker({ player: p.name, playerId, team: team.abbr, opp: opp.abbr, game: g, stats, lines, estimate, rows })}
      ${altTable({ rows, lines, stats, opp: opp.abbr, home: sheet.side === "home" })}`;
    // Matchup for each key stat: e.g. points, rebounds, assists and 3s allowed to this position.
    const checks = sportOf(state.league) === "football"
      ? [["receivingYards", "Yards"], ["tds", "TDs"]]
      : [["points", "Points"], ["totalRebounds", "Rebounds"], ["assists", "Assists"], ["threes", "3s"]];
    if (sportOf(state.league) === "football" && /RB|FB/.test(p.pos)) checks[0][0] = "rushingYards";
    Promise.all(checks.map(([k]) => matchupFor(opp.id, p.pos, k).catch(() => null))).then((mus) => {
      const box = $("matchup-warn");
      if (!box || sheet.game !== g) return;
      box.innerHTML = mus.map((mu, i) => {
        if (!mu) return "";
        const name = checks[i][1];
        if (mu.tough) return `<p class="inj-banner">Tough for ${name.toLowerCase()}: ${opp.name} ${mu.label}.</p>`;
        if (mu.soft) return `<p class="good-banner">Good for ${name.toLowerCase()}: ${opp.name} ${mu.label}.</p>`;
        return `<p class="note">${name}: ${opp.name} ${mu.label}.</p>`;
      }).join("");
    });
  } catch (err) {
    $("sheet-body").innerHTML = `<p class="status">Couldn't load game log (${err.message}).</p>`;
  }
}

$("games").addEventListener("click", (e) => {
  const card = e.target.closest("[data-game]");
  if (card) openGame(card.dataset.game);
});

$("sheet-body").addEventListener("click", (e) => {
  const side = e.target.closest("[data-side]");
  if (side) {
    sheet.side = side.dataset.side;
    renderGame();
    return;
  }
  const player = e.target.closest("[data-player]");
  if (player) openPlayer(player.dataset.player);
});

$("sheet-back").addEventListener("click", () => {
  $("sheet-back").hidden = true;
  $("sheet-title").textContent = `${sheet.game.away.abbr} @ ${sheet.game.home.abbr}`;
  renderGame();
});

$("sheet-close").addEventListener("click", closeSheet);
