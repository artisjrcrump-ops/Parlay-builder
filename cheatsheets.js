// Cheatsheets: three short lists of overs that have hit every time lately.
//   ⚡ 100% recent form   - FanDuel's main line, cleared in each of the last 5 (or more) games
//   🛡 100% vs opponent   - main line, cleared in every game against tonight's opponent (2+ games)
//   🪜 100% alternate lines - the highest "X+" rung cleared in every game this season (5+ games)
//   🪜 90% alternate lines  - a higher rung, cleared in 90%+ of the last 20 games (this season + last)
// Filled while props are scored (scorePlayer calls cheatNote), for every sport turned on.
// Shares globals from the other scripts (state, sheet, slip, $, decimal, american, hits,
// rungHits, altLadder, sportsCandidates, sportChips, openSheet, persist, loadPref).

const CHEAT = {};
const CHEAT_SHOW = 10;

function cheatNote({ g, p, team, opp, key, statKey, l, rows, season, label, tough }) {
  if (!Number.isFinite(l.line) || !l.over) return;
  const base = {
    player: p.name, playerId: p.id, team: team.abbr, opp: opp.abbr, gameId: g.id, date: g.date.toISOString(),
    stat: label, statKey: key, gradeKey: statKey, league: state.league, sport: LEAGUES[state.league].label,
    side: "over", yes: false, tough,
  };
  const h = hits(rows, statKey, "over", l.line);
  const vs = rows.filter((r) => r.opp === opp.abbr);
  const vsHit = vs.filter((r) => (r.stats[statKey] || 0) > l.line).length;
  const main = { ...base, id: `${g.id}|${p.name}|${label}|over`, line: l.line, odds: l.over, l5: `${h.l5}/${h.l5n}`, season: `${h.all}/${h.n}` };
  // Highest rung cleared every game, still worth a leg (about -1000 to -105).
  const ladder = altLadder({ rows, statKey, l, opp: opp.abbr, home: p.side === "home" });
  const rung = ladder.filter((s) => s.n >= 5 && s.all === s.n && s.dec && s.dec >= 1.1 && s.dec <= 1.95).pop();
  // 90%: a higher rung than the 100% one, cleared in 90%+ of games (8+ games, so 1 miss at most per 10).
  const rung90 = ladder.filter((s) => s.n >= 8 && s.all < s.n && s.all / s.n >= 0.9 && (!rung || s.thr > rung.thr)
    && s.dec && s.dec >= 1.15 && s.dec <= 2.2).pop();
  const altEntry = (r) => r ? {
    ...base, id: `${g.id}|${p.name}|${label}|over|alt${r.thr}`, line: r.line, thr: r.thr,
    odds: r.odds, est: r.source === "estimated", l5: `${r.l5}/${r.l5n}`, season: `${r.all}/${r.n}`,
    hit: r.all, of: r.n, dec: r.dec,
  } : null;
  // Versus opponent also looks back two seasons (filled in fillVsOpponent before showing).
  const pend = h.n && h.all / h.n >= 0.6
    ? { playerId: p.id, league: state.league, statKey, line: l.line, opp: opp.abbr, cur: vs, season, rows, l, home: p.side === "home", base, label, gid: g.id, pname: p.name } : null;
  CHEAT[main.id] = {
    pend, main: { ...main, rate: h.all / h.n },
    form: h.l5n >= 5 && h.l5 === h.l5n ? { ...main, hit: h.l5, of: h.l5n, rate: h.all / h.n } : null,
    vs: vs.length >= 2 && vsHit === vs.length ? { ...main, hit: vsHit, of: vs.length, rate: h.all / h.n } : null,
    alt: altEntry(rung),
    alt90: altEntry(rung90),
  };
}

// Games against tonight's opponent from this season and the two before, for main lines
// that hit 60%+ this season. One request per player per past season, a few at a time.
const VS_MAX_PLAYERS = 80;
async function fillVsOpponent(progress) {
  const todo = Object.values(CHEAT).filter((c) => c.pend && !c.vsDone);
  const players = [...new Map(todo.map((c) => [`${c.pend.league}:${c.pend.playerId}`, c.pend])).values()].slice(0, VS_MAX_PLAYERS);
  const past = {};
  let done = 0;
  const one = async (pd) => {
    const now = pd.season || (await loadGameLog(pd.playerId, pd.league).catch(() => ({}))).season;
    const logs = now ? await Promise.all([now - 1, now - 2].map((y) =>
      loadGameLog(pd.playerId, pd.league, false, y).then((r) => r.rows).catch(() => []))) : [];
    past[`${pd.league}:${pd.playerId}`] = logs.flat();
    progress?.(`Checking past games vs tonight's opponents… ${++done}/${players.length}`);
  };
  for (let i = 0; i < players.length; i += 6) await Promise.all(players.slice(i, i + 6).map(one));
  for (const c of todo) {
    const pd = c.pend;
    const old = past[`${pd.league}:${pd.playerId}`];
    if (!old) continue;
    c.vsDone = true;
    const seen = new Set(pd.cur.map((r) => r.eventId));
    const games = [...pd.cur, ...old.filter((r) => r.opp === pd.opp && !seen.has(r.eventId))];
    const hit = games.filter((r) => (r.stats[pd.statKey] || 0) > pd.line).length;
    c.vs = games.length >= 2 && hit === games.length ? { ...c.main, hit, of: games.length } : null;
    // 90% alt lines over the last 20 games (this season plus last), like "18 of last 20".
    const ids = new Set(pd.rows.map((r) => r.eventId));
    const last20 = [...pd.rows, ...old.filter((r) => !ids.has(r.eventId)).sort((a, b) => b.date - a.date)].slice(0, 20);
    const top = c.alt?.thr || 0;
    const r90 = altLadder({ rows: last20, statKey: pd.statKey, l: pd.l, opp: pd.opp, home: pd.home })
      .filter((x) => x.n >= 10 && x.all < x.n && x.all / x.n >= 0.9 && x.thr > top && x.dec && x.dec >= 1.15 && x.dec <= 2.2).pop();
    if (r90) {
      c.alt90 = {
        ...pd.base, id: `${pd.gid}|${pd.pname}|${pd.label}|over|alt${r90.thr}`, line: r90.line, thr: r90.thr,
        odds: r90.odds, est: r90.source === "estimated", l5: `${r90.l5}/${r90.l5n}`, season: `${r90.all}/${r90.n}`,
        hit: r90.all, of: r90.n, dec: r90.dec,
      };
    }
  }
}

function cheatLists(cands) {
  const games = new Set(cands.map((c) => c.gameId));
  const now = Date.now();
  const rows = Object.values(CHEAT).filter((c) => {
    const any = c.form || c.vs || c.alt || c.alt90;
    // Degen mode (NBA): only the group's teams, even for entries scored before it was turned on.
    if (any && any.league === "nba" && degenPick() !== "off") {
      const owner = degenOwner(any.team);
      if (!owner || (degenPick() !== "all" && owner !== degenPick())) return false;
    }
    return any && (games.size ? games.has(any.gameId) : true) && new Date(any.date).getTime() > now - 3 * 3600e3;
  });
  const pick = (kind, order) => {
    const seen = new Set();
    return rows.map((c) => c[kind]).filter(Boolean).sort(order)
      .filter((c) => !seen.has(c.player + c.stat) && seen.add(c.player + c.stat)).slice(0, CHEAT_SHOW);
  };
  const bySample = (a, b) => b.of - a.of || b.rate - a.rate || (a.tough - b.tough);
  return [
    { kind: "form", icon: "⚡", title: "100% Recent Form", list: pick("form", bySample) },
    { kind: "vs", icon: "🛡", title: "100% Versus Opponent", list: pick("vs", bySample) },
    { kind: "alt", icon: "🪜", title: "100% Alternate Lines", list: pick("alt", (a, b) => b.of - a.of || b.dec - a.dec || b.thr - a.thr) },
    { kind: "alt90", icon: "🪜", title: "90% Alternate Lines", list: pick("alt90", (a, b) => b.hit / b.of - a.hit / a.of || b.of - a.of || b.dec - a.dec) },
  ];
}

function renderCheats(lists, note = "") {
  sheet.cheats = lists;
  const inSlip = (c) => slip.legs.some((x) => x.id === c.id);
  const leg = (c) => c.thr ? `${c.thr}+ ${c.stat}` : `Over ${c.line} ${c.stat}`;
  $("sheet-body").innerHTML = `${sportChips()}${note}
    <p class="note">Overs that hit every single time. Tap a row to add it to your slip. Prices with ~ are estimates, so check them in FanDuel.</p>
    ${lists.map((s, i) => `
      <div class="auto cheat">
        <div class="auto-head"><b>${s.icon} ${s.title}</b></div>
        ${s.list.length ? s.list.map((c, j) => `
          <button class="cheat-row ${inSlip(c) ? "added" : ""}" data-cheat="${i}.${j}">
            <span><b>${c.player}</b> ${leg(c)}<br><small class="muted">${c.sport} · ${c.team} vs ${c.opp} · ${c.est ? "~" : ""}${c.odds}${c.tough ? " · tough matchup" : ""}</small></span>
            <span class="cheat-hit">${inSlip(c) ? "✓" : `${c.hit}/${c.of}`}</span>
          </button>`).join("") : `<p class="status">None on this slate.</p>`}
      </div>`).join("")}
    <p class="note">Past results, not guarantees.</p>`;
}

async function openCheats() {
  sheet.game = null;
  $("sheet-back").hidden = true;
  $("sheet-title").textContent = "📋 Cheatsheets";
  sheet.reopen = openCheats;
  openSheet();
  const status = (msg) => { $("sheet-body").innerHTML = `${sportChips()}<p class="status">${msg}</p>`; };
  try {
    const r = await sportsCandidates(status);
    if (!r) return;
    if (!r.games) return status("No upcoming games on this day. Use ‹ › on the main screen to change the day.");
    await fillVsOpponent(status);
    renderCheats(cheatLists(r.all), r.failed.length ? `<p class="note">Couldn't load ${r.failed.join(", ")}.</p>` : "");
  } catch (err) {
    status(`Couldn't build cheatsheets (${err.message}).`);
  }
}

$("cheats").addEventListener("click", openCheats);

$("sheet-body").addEventListener("click", (e) => {
  const b = e.target.closest("[data-cheat]");
  if (!b || !sheet.cheats) return;
  const [i, j] = b.dataset.cheat.split(".").map(Number);
  const c = sheet.cheats[i]?.list[j];
  if (!c) return;
  const at = slip.legs.findIndex((x) => x.id === c.id);
  if (at >= 0) slip.legs.splice(at, 1);
  else {
    const { id, player, playerId, team, opp, gameId, date, stat, gradeKey, league, side, line, odds, l5, season, thr } = c;
    slip.legs.push({ id, player, playerId, team, opp, gameId, date, stat, gradeKey, league, side, line, odds, est: null, l5, season, thr, yes: false, group: "Cheatsheet", on: true });
  }
  persist();
  renderCheats(sheet.cheats);
});
