// Ladder parlays: built like Artis's own FanDuel tickets (Nov 2026 screenshots).
// - Same-game ladder: one game, 6-9 "X+" legs from BOTH teams, role players welcome,
//   up to 2 legs per player (e.g. 4+ assists and 2+ threes).
// - One per game: 8 games, one X+ leg each, priced about -150 to -220.
// Every leg is a "safe rung": the highest rung the player cleared in 8+ of his last 10 games
// (and 4+ of his last 5). Threes and big rebound numbers need 9 of 10: those were the legs
// that kept losing on his tickets.
// Shares globals from the other scripts (sheet, slip, $, american, money, persist, playerOk,
// altLadder from alttrends.js).

const LADDER_MIN = 6;
const LADDER_MAX = 9;
const LADDER_GOAL = 31; // about +3000 straight math before FanDuel reprices the same-game legs
const PER_GAME_LEGS = 8;
const PER_GAME_TICKETS = 3;

// Highest rung cleared in 8 of the last 10 (9 of 10 for threes and 10+ rebounds).
function safeRung({ rows, statKey, l, opp, home }) {
  const last10 = rows.slice(0, 10);
  if (last10.length < 6) return null;
  const ladder = altLadder({ rows, statKey, l, opp, home }).filter((s) => {
    const hits = last10.filter((r) => (r.stats[statKey] || 0) >= s.thr).length;
    const strict = statKey === "threes" || (statKey === "totalRebounds" && s.thr >= 10);
    const need = Math.ceil(last10.length * (strict ? 0.9 : 0.8));
    s.l10 = hits; s.l10n = last10.length;
    return hits >= need && s.l5 >= s.l5n - 1 && s.dec && s.dec >= 1.2 && s.dec <= 1.9; // about -500 to -110: skip the near-locks that pay nothing
  });
  return ladder.length ? ladder[ladder.length - 1] : null;
}

const ladderScore = (c) => rate(c.l10Hits, c.l10n) * 2 + rate(c.l5Hits, c.l5n) + rate(c.allHits, c.n) * 0.5
  + (c.matchup === "soft matchup" ? 0.1 : 0);

function ladderPool(cands) {
  const byGame = {};
  cands.filter((c) => c.ladder).forEach((c) => (byGame[c.gameId] ||= []).push(c));
  for (const legs of Object.values(byGame)) legs.sort((a, b) => ladderScore(b) - ladderScore(a));
  return byGame;
}

// One same-game ticket per game: 6-9 legs, from both teams, until about +3000.
function sameGameLadders(cands) {
  const out = [];
  for (const legs of Object.values(ladderPool(cands))) {
    const pick = [];
    const teamCount = {};
    let dec = 1;
    for (const c of legs) {
      if (pick.length >= LADDER_MAX) break;
      if (pick.length >= LADDER_MIN && dec >= LADDER_GOAL) break;
      if (!playerOk(pick, c)) continue;
      // keep both teams in it: no team takes more than 6 of the legs
      if ((teamCount[c.team] || 0) >= 6) continue;
      teamCount[c.team] = (teamCount[c.team] || 0) + 1;
      pick.push(c);
      dec *= c.dec;
    }
    if (pick.length >= LADDER_MIN) out.push({ legs: pick, dec, kind: "sgp" });
  }
  // safest tickets first: the weakest leg's last-10 rate, then the average
  const weakest = (t) => Math.min(...t.legs.map((c) => rate(c.l10Hits, c.l10n)));
  return out.sort((a, b) => weakest(b) - weakest(a) || b.legs.length - a.legs.length);
}

// One leg per game, 8 games, priced like his multi-game tickets (about -150 to -220 each).
function perGameTickets(cands) {
  const games = Object.values(ladderPool(cands));
  const tickets = [];
  const used = new Set();
  for (let t = 0; t < PER_GAME_TICKETS; t++) {
    const legs = [];
    for (const g of games) {
      const inRange = g.filter((c) => !used.has(c.id) && c.dec >= 1.42 && c.dec <= 1.7);
      const c = inRange[0] || g.find((x) => !used.has(x.id) && x.dec >= 1.3);
      if (c) legs.push(c);
    }
    legs.sort((a, b) => ladderScore(b) - ladderScore(a));
    const pick = legs.slice(0, PER_GAME_LEGS);
    if (pick.length < 4) break;
    pick.forEach((c) => used.add(c.id));
    tickets.push({ legs: pick, dec: pick.reduce((d, c) => d * c.dec, 1), kind: "multi" });
  }
  return tickets;
}

function ladderLeg(c) {
  const name = c.line === c.postedLine ? `Over ${c.line} ${c.stat}` : `${c.thr}+ ${c.stat}`;
  const src = c.source === "estimated" ? "~" : "";
  return `<div class="alt-leg"><b>${c.player}</b> <span class="muted">(${c.team})</span> ${name} <span class="leg-odds">${src}${c.odds}</span>
    <small class="muted"> · last 10: ${c.l10Hits}/${c.l10n} · last 5: ${c.l5Hits}/${c.l5n}${c.matchup ? " · 🔥 soft D" : ""}</small></div>`;
}

function renderLadder(header, cands, mode) {
  const tickets = mode === "pergame" ? perGameTickets(cands) : sameGameLadders(cands);
  sheet.ladder = tickets;
  sheet.autoParlays = null;
  const note = mode === "pergame"
    ? "One X+ leg from each of 8 games, each about -150 to -220, like your multi-game tickets. Every leg cleared its line in 8+ of the player's last 10 games."
    : "One game per ticket, 6-9 X+ legs from both teams, like your same-game parlays. Every leg cleared its line in 8+ of the player's last 10 games (9 of 10 for threes and 10+ rebounds).";
  $("sheet-body").innerHTML = `${header}
    <p class="note">${note} The payout shown is straight math; FanDuel prices same-game parlays its own way, so check the real odds there. Prices with ~ are estimates.</p>
    ${tickets.length ? tickets.map((t, i) => {
      const g = t.legs[0];
      const title = t.kind === "sgp" ? `${g.sport ? `${g.sport} · ` : ""}${g.away} @ ${g.home} · ${t.legs.length} legs` : `Ticket #${i + 1} · ${t.legs.length} games`;
      return `
      <div class="auto">
        <div class="auto-head"><b>${title}</b><span class="muted">~${american(t.dec)} · ${money(slip.stake)} → ~${money(slip.stake * t.dec)}</span></div>
        ${t.legs.map(ladderLeg).join("")}
        <button class="btn primary" data-ladder-use="${i}">Add to slip</button>
      </div>`;
    }).join("") : `<p class="status">Not enough safe X+ lines on this slate yet. Props often post a few hours before tip-off.</p>`}`;
}

$("sheet-body").addEventListener("click", (e) => {
  const b = e.target.closest("[data-ladder-use]");
  if (!b || !sheet.ladder) return;
  const t = sheet.ladder[+b.dataset.ladderUse];
  for (const c of t?.legs || []) {
    if (slip.legs.some((x) => x.id === c.id)) continue;
    const { id, player, playerId, team, opp, gameId, date, stat, gradeKey, league, side, line, odds, l5, season, thr, yes } = c;
    const group = { sgp: "Same-game ladder", multi: "One per game", fbplus: "Football SGP+" }[t.kind];
    slip.legs.push({ id, player, playerId, team, opp, gameId, date, stat, gradeKey, league, side, line, odds, est: null, l5, season, thr: yes ? undefined : thr, yes: !!yes, group, on: true });
  }
  persist();
  b.textContent = "Added ✓";
  b.classList.remove("primary");
});

// Football SGP+ like Artis's 10-leg college ticket (Nov 7, 2026): 4-5 games, each a small
// same-game block of 2-3 legs: a TD scorer, the QB's alt passing yards, a receiver's alt
// receptions (or rushing/receiving yards), about 10 legs in all.
const FB_TICKETS = 3;
const FB_MAX_LEGS = 10;
const FB_KINDS = [
  (c) => c.tdPick,
  (c) => c.ladder && c.statKey === "passingYards",
  (c) => c.ladder && ["receptions", "receivingYards", "rushingYards", "rushRec"].includes(c.statKey),
];
const fbScore = (c) => (c.tdPick ? rate(c.allHits, c.n) * 2.2 : ladderScore(c));

function footballPlus(cands) {
  const byGame = {};
  cands.filter((c) => c.tdPick || c.ladder).forEach((c) => (byGame[c.gameId] ||= []).push(c));
  const used = new Set();
  const tickets = [];
  for (let t = 0; t < FB_TICKETS; t++) {
    const blocks = [];
    for (const legs of Object.values(byGame)) {
      const block = [];
      for (const kind of FB_KINDS) {
        const c = legs.filter((x) => kind(x) && !used.has(x.id) && playerOk(block, x)).sort((a, b) => fbScore(b) - fbScore(a))[0];
        if (c) block.push(c);
      }
      if (block.length >= 2) blocks.push(block);
    }
    // strongest games first; stop around 10 legs
    blocks.sort((a, b) => Math.min(...b.map(fbScore)) - Math.min(...a.map(fbScore)));
    const pick = [];
    let n = 0;
    for (const b of blocks) {
      if (n + b.length > FB_MAX_LEGS) continue;
      pick.push(b);
      n += b.length;
      if (n >= FB_MAX_LEGS - 1) break;
    }
    if (n < 4) break;
    pick.flat().forEach((c) => used.add(c.id));
    tickets.push({ blocks: pick, legs: pick.flat(), dec: pick.flat().reduce((d, c) => d * c.dec, 1), kind: "fbplus" });
  }
  return tickets;
}

function renderFootballPlus(header, cands) {
  const tickets = footballPlus(cands);
  sheet.ladder = tickets;
  sheet.autoParlays = null;
  const leg = (c) => c.tdPick
    ? `<div class="alt-leg"><b>${c.player}</b> <span class="muted">(${c.team})</span> Anytime TD <span class="leg-odds">${c.odds}</span>
       <small class="muted"> · scored in ${c.allHits}/${c.n} games · last 5: ${c.l5Hits}/${c.l5n}</small></div>`
    : ladderLeg(c);
  $("sheet-body").innerHTML = `${header}
    <p class="note">Built like your 10-leg SGP+: a few games, each a same-game block of a TD scorer, the QB's alt passing yards and a receiver's alt receptions/yards. TD scorers scored in half or more of their games; yardage and catch lines cleared in 8+ of the last 10. Straight-math payout; FanDuel prices each block its own way.</p>
    ${tickets.length ? tickets.map((t, i) => `
      <div class="auto">
        <div class="auto-head"><b>SGP+ #${i + 1} · ${t.blocks.length} games · ${t.legs.length} legs</b><span class="muted">~${american(t.dec)} · ${money(slip.stake)} → ~${money(slip.stake * t.dec)}</span></div>
        ${t.blocks.map((b) => `<div class="plus-block"><div class="muted"><small>SGP · ${b[0].away} @ ${b[0].home}</small></div>${b.map(leg).join("")}</div>`).join("")}
        <button class="btn primary" data-ladder-use="${i}">Add to slip</button>
      </div>`).join("") : `<p class="status">Not enough football props posted yet. College props usually show up a day or so before kickoff.</p>`}`;
}
