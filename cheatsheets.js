// Cheatsheets: three short lists of overs that have hit every time lately.
//   ⚡ 100% recent form   - FanDuel's main line, cleared in each of the last 5 (or more) games
//   🛡 100% vs opponent   - main line, cleared in every game against tonight's opponent (2+ games)
//   🪜 100% alternate lines - the highest "X+" rung cleared in every game this season (5+ games)
// Filled while props are scored (scorePlayer calls cheatNote), for every sport turned on.
// Shares globals from the other scripts (state, sheet, slip, $, decimal, american, hits,
// rungHits, altLadder, sportsCandidates, sportChips, openSheet, persist, loadPref).

const CHEAT = {};
const CHEAT_SHOW = 10;

function cheatNote({ g, p, team, opp, key, statKey, l, rows, label, tough }) {
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
  // Highest rung cleared every game, still worth a leg (not shorter than about -1000).
  const rung = altLadder({ rows, statKey, l, opp: opp.abbr, home: p.side === "home" })
    .filter((s) => s.n >= 5 && s.all === s.n && s.dec && s.dec >= 1.1).pop();
  CHEAT[main.id] = {
    form: h.l5n >= 5 && h.l5 === h.l5n ? { ...main, hit: h.l5, of: h.l5n, rate: h.all / h.n } : null,
    vs: vs.length >= 2 && vsHit === vs.length ? { ...main, hit: vsHit, of: vs.length, rate: h.all / h.n } : null,
    alt: rung ? {
      ...base, id: `${g.id}|${p.name}|${label}|over|alt${rung.thr}`, line: rung.line, thr: rung.thr,
      odds: rung.odds, est: rung.source === "estimated", l5: `${rung.l5}/${rung.l5n}`, season: `${rung.all}/${rung.n}`,
      hit: rung.all, of: rung.n, dec: rung.dec,
    } : null,
  };
}

function cheatLists(cands) {
  const games = new Set(cands.map((c) => c.gameId));
  const now = Date.now();
  const rows = Object.values(CHEAT).filter((c) => {
    const any = c.form || c.vs || c.alt;
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
  if (!loadPref("sgoKey", "")) return status("Add your SportsGameOdds key in ⚙︎ Settings first. Cheatsheets need FanDuel's lines.");
  try {
    const r = await sportsCandidates(status);
    if (!r) return;
    if (!r.games) return status("No upcoming games on this day. Use ‹ › on the main screen to change the day.");
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
    const { id, player, playerId, team, opp, gameId, date, stat, gradeKey, league, side, line, odds, l5, season } = c;
    slip.legs.push({ id, player, playerId, team, opp, gameId, date, stat, gradeKey, league, side, line, odds, est: null, l5, season, yes: false, group: "Cheatsheet", on: true });
  }
  persist();
  renderCheats(sheet.cheats);
});
