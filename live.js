// 2nd-half parlays: for games in progress, read the live box score, project each player's
// final line from what he has now plus his usual rate for the time left, and flag overs he's
// on pace to clear. Developing blowouts shift minutes from starters to backups.
// The ⏱ 2nd half button shows only when a game on the board is live.
// Shares globals from the other scripts (state, sheet, slip, $, LEAGUES, SITE, getJSON, ymd,
// loadRanks, parseGame, loadGameLog, getPlayerLines, sportOf, phi, legText, persist, openSheet,
// sportsOn, sportChips, money, loadPref).

const GAME_CLOCK = { nba: [4, 12], ncaab: [2, 20], nfl: [4, 15], ncaaf: [4, 15] }; // periods, minutes each
const LIVE_BLOWOUT = { nba: 15, ncaab: 15, nfl: 17, ncaaf: 21 }; // point margin
const LIVE_STATS = {
  basketball: ["points", "totalRebounds", "assists", "threes", "pra"],
  football: ["passingYards", "rushingYards", "receivingYards", "receptions"],
};
const LIVE_LABEL = { points: "PTS", totalRebounds: "REB", assists: "AST", threes: "3PM", pra: "PRA",
  passingYards: "Pass Yds", rushingYards: "Rush Yds", receivingYards: "Rec Yds", receptions: "Rec" };

function clockMinutes(text) {
  const [m, s] = String(text || "0").split(":");
  return s == null ? parseFloat(m) / 60 || 0 : (parseFloat(m) || 0) + (parseFloat(s) || 0) / 60;
}

// Share of regulation still to play, 0-1.
function timeLeft(league, status) {
  const [n, len] = GAME_CLOCK[league];
  const p = status?.period || 1;
  if (p > n) return 0.02; // overtime
  return Math.max(0, Math.min(1, ((n - p) * len + clockMinutes(status?.displayClock)) / (n * len)));
}

// Live box score -> { athleteId: { name, teamId, starter, stats } }.
function liveBox(summary) {
  const out = {};
  for (const team of summary.boxscore?.players || []) {
    for (const cat of team.statistics || []) {
      for (const a of cat.athletes || []) {
        if (!a.athlete?.id || !a.stats?.length) continue;
        const p = (out[a.athlete.id] ||= { name: a.athlete.displayName, teamId: team.team?.id, starter: !!a.starter, pos: a.athlete.position?.abbreviation, stats: {} });
        cat.keys.forEach((k, i) => {
          const v = a.stats[i];
          if (k.includes("-")) { // "threePointFieldGoalsMade-threePointFieldGoalsAttempted" -> made
            if (k.startsWith("threePoint")) p.stats.threes = parseFloat(v) || 0;
          } else {
            p.stats[k === "rebounds" ? "totalRebounds" : k] = parseFloat(v) || 0;
          }
        });
      }
    }
  }
  for (const p of Object.values(out)) {
    const s = p.stats;
    s.pra = (s.points || 0) + (s.totalRebounds || 0) + (s.assists || 0);
  }
  return out;
}

// Projected final for one stat, with a spread for the chance math.
async function projectStat(league, playerId, live, key, left, blowoutRole) {
  const { rows } = await loadGameLog(playerId, league).catch(() => ({ rows: [] }));
  if (rows.length < 3) return null;
  const cur = live.stats[key] || 0;
  if (sportOf(league) === "basketball") {
    const mins = rows.reduce((t, r) => t + (parseFloat(r.stats.minutes) || 0), 0);
    if (!mins) return null;
    const rate = rows.reduce((t, r) => t + (r.stats[key] || 0), 0) / mins;
    const avgMin = mins / rows.length;
    const [n, len] = GAME_CLOCK[league];
    // His usual share of the minutes still to play, shifted if a blowout is on.
    let rem = Math.min(left * n * len, Math.max(0, avgMin - (live.stats.minutes || 0)) + 2);
    rem = Math.max(rem, left * avgMin);
    if (blowoutRole === "starter") rem *= 0.5;
    if (blowoutRole === "bench") rem = Math.min(left * n * len, rem * 1.6 + 3);
    const more = rate * rem;
    return { cur, proj: cur + more, sd: Math.sqrt(Math.max(more, 0.3)) * 1.15 + 0.4 };
  }
  const avg = rows.reduce((t, r) => t + (r.stats[key] || 0), 0) / rows.length;
  const sd = Math.sqrt(rows.reduce((t, r) => t + ((r.stats[key] || 0) - avg) ** 2, 0) / rows.length);
  let more = avg * left;
  if (blowoutRole === "starter") more *= 0.6;
  if (blowoutRole === "bench") more *= 1.5;
  return { cur, proj: cur + more, sd: Math.max(sd * Math.sqrt(left), 2) };
}

// Live games for one league, each with the box score and the over/under picks worth a look.
async function liveLeague(key, progress) {
  const lg = LEAGUES[key];
  const keep = { league: state.league, games: state.games };
  try {
    state.league = key; // odds lookups read state.league
    const [board, ranks] = await Promise.all([
      getJSON(`${SITE}${lg.path}/scoreboard?dates=${ymd(state.date)}${lg.query}`),
      loadRanks(key).catch(() => state.ranks[key] || {}),
    ]);
    const events = (board.events || []).filter((ev) => ev.status?.type?.state === "in");
    const out = [];
    for (const ev of events) {
      const g = parseGame(ev, ranks);
      progress(`${lg.label}: reading ${g.away.abbr} @ ${g.home.abbr}…`);
      const summary = await getJSON(`${SITE}${lg.path}/summary?event=${ev.id}`).catch(() => null);
      if (!summary) continue;
      const left = timeLeft(key, ev.status);
      const margin = Math.abs((parseFloat(g.home.score) || 0) - (parseFloat(g.away.score) || 0));
      const blowout = margin >= LIVE_BLOWOUT[key] && left <= 0.55;
      const box = liveBox(summary);
      const picks = [];
      for (const [id, p] of Object.entries(box)) {
        const lines = await getPlayerLines(g, p.name).catch(() => null);
        if (!lines) continue;
        const role = blowout ? (p.starter ? "starter" : "bench") : null;
        for (const statKey of LIVE_STATS[sportOf(key)]) {
          const l = lines[statKey];
          if (!l || !Number.isFinite(l.line) || !l.over) continue;
          const pr = await projectStat(key, id, p, statKey, left, role);
          if (!pr || pr.cur > l.line) continue; // already cashed
          const prob = Math.min(0.95, 1 - phi((l.line - pr.proj) / pr.sd));
          if (prob < 0.6) continue;
          const team = g.home.id === p.teamId ? g.home : g.away;
          const opp = team === g.home ? g.away : g.home;
          picks.push({
            id: `${g.id}|${p.name}|${LIVE_LABEL[statKey]}|over|live`, player: p.name, playerId: id, sport: lg.label,
            team: team.abbr, opp: opp.abbr, gameId: g.id, date: g.date.toISOString(), league: key,
            stat: LIVE_LABEL[statKey], gradeKey: statKey, side: "over", line: l.line, odds: l.over, yes: false,
            cur: pr.cur, proj: Math.round(pr.proj * 10) / 10, prob, role,
            est: Math.round(pr.proj * 10) / 10, l5: "live", season: "live", on: true,
          });
        }
      }
      picks.sort((a, b) => b.prob - a.prob);
      out.push({ g, status: ev.status?.type?.shortDetail || "", left, margin, blowout, picks, league: key });
    }
    return out;
  } finally {
    state.league = keep.league;
    state.games = keep.games;
  }
}

function renderLive(games, failed = []) {
  sheet.livePicks = games.flatMap((x) => x.picks);
  const top = [...sheet.livePicks].sort((a, b) => b.prob - a.prob).slice(0, 10);
  const inSlip = (c) => slip.legs.some((x) => x.id === c.id);
  const pickRow = (c) => `
    <div class="auto-leg">
      <div><b>${c.player}</b> ${legText(c)} <span class="muted">${c.sport} · ${c.team} vs ${c.opp}</span><br>
      <small>has ${c.cur} now · on pace for ${c.proj} · ~${Math.round(c.prob * 100)}% to clear${c.role === "bench" ? " · backup in a blowout" : ""}</small></div>
      <button class="pick hot-pick ${inSlip(c) ? "added" : ""}" data-live-add="${c.id}">${c.odds}<br><small>${inSlip(c) ? "Added" : "Add"}</small></button>
    </div>`;
  $("sheet-body").innerHTML = `${sportChips()}
    ${failed.length ? `<p class="note">Couldn't load ${failed.join(", ")} right now.</p>` : ""}
    ${games.length ? `
      <p class="note">Projections use what each player has now plus his usual rate for the time left. When a game turns into a blowout, starters' minutes are cut and backups' go up. The odds shown are the latest in the free feed, which can lag; FanDuel's live 2nd-half lines will be different, so check them before you bet.</p>
      <h3 class="pick-title">Best 2nd-half overs</h3>
      ${top.length ? `<div class="auto">${top.map(pickRow).join("")}</div>
        <div class="settings-actions"><button class="btn" data-open-slip>Open slip</button></div>`
        : `<p class="status">No overs look likely to clear right now. Refresh in a few minutes.</p>`}
      <h3 class="pick-title">Live games</h3>
      ${games.map((x) => `
        <div class="auto">
          <div class="auto-head"><b>${x.g.away.abbr} ${x.g.away.score} @ ${x.g.home.abbr} ${x.g.home.score}</b><span class="muted">${x.status}</span></div>
          <small class="auto-why">${x.blowout ? `💥 Blowout developing (${x.margin} pts). Starters may sit, so look at backups.` : x.margin <= 5 ? "Close game. Starters should play heavy minutes." : `Margin ${x.margin}.`} ${x.picks.length} over${x.picks.length === 1 ? "" : "s"} on pace.</small>
          ${x.picks.slice(0, 4).map(pickRow).join("")}
        </div>`).join("")}`
    : `<p class="status">No games in progress right now in the sports you picked.</p>`}`;
}

async function openLive() {
  sheet.game = null;
  sheet.reopen = openLive;
  $("sheet-back").hidden = true;
  $("sheet-title").textContent = "⏱ 2nd-half parlays";
  openSheet();
  const status = (msg) => { $("sheet-body").innerHTML = `${sportChips()}<p class="status">${msg}</p>`; };
  if (!loadPref("sgoKey", "")) return status("Add your SportsGameOdds key in ⚙︎ Settings first. Live picks need FanDuel's lines.");
  status("Reading live games…");
  const token = (sheet.liveToken = (sheet.liveToken || 0) + 1);
  const games = [];
  const failed = [];
  for (const key of sportsOn()) {
    try {
      games.push(...await liveLeague(key, status));
    } catch {
      failed.push(LEAGUES[key].label);
    }
    if (token !== sheet.liveToken) return;
  }
  renderLive(games, failed);
}

// Show the button only while a game on the board is in progress.
function updateLiveButton() {
  $("live").hidden = !(state.games || []).some((g) => g.state === "in");
}

$("live").addEventListener("click", openLive);
setInterval(updateLiveButton, 3000);
updateLiveButton();

$("sheet-body").addEventListener("click", (e) => {
  const b = e.target.closest("[data-live-add]");
  if (!b || !sheet.livePicks) return;
  const c = sheet.livePicks.find((x) => x.id === b.dataset.liveAdd);
  if (!c) return;
  const i = slip.legs.findIndex((x) => x.id === c.id);
  if (i >= 0) slip.legs.splice(i, 1);
  else {
    const { id, player, playerId, team, opp, gameId, date, stat, gradeKey, league, side, line, odds, est, l5, season } = c;
    slip.legs.push({ id, player, playerId, team, opp, gameId, date, stat, gradeKey, league, side, line, odds, est, l5, season, yes: false, group: "2nd half", on: true });
  }
  persist();
  const added = i < 0;
  b.classList.toggle("added", added);
  b.querySelector("small").textContent = added ? "Added" : "Add";
});
