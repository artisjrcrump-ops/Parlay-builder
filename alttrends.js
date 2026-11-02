// Alternate lines: FanDuel's "X+" ladders (15+ rec yards, 4+ receptions, 20+ points...).
// For each player and stat, find the highest rung he has cleared in at least 4 of his last 5,
// then pair legs into same-game parlays with three checks: last 5 games, games against
// tonight's opponent, and games at home/away like tonight.
// Shares globals from the other scripts (sheet, slip, $, decimal, american, money, legText,
// estimatePrice, persist, openSlip).

// The rungs FanDuel usually offers for each stat.
const ALT_STEPS = {
  points: [5, 10, 15, 20, 25, 30, 35, 40], totalRebounds: [2, 3, 4, 5, 6, 7, 8, 10, 12, 14],
  assists: [2, 3, 4, 5, 6, 7, 8, 10, 12], threes: [1, 2, 3, 4, 5, 6], pra: [10, 15, 20, 25, 30, 35, 40, 45, 50],
  pr: [10, 15, 20, 25, 30, 35, 40], pa: [10, 15, 20, 25, 30, 35, 40], ra: [5, 8, 10, 12, 15],
  passingYards: [150, 175, 200, 225, 250, 275, 300, 325, 350], rushingYards: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 125],
  receivingYards: [10, 15, 20, 25, 30, 40, 50, 60, 70, 80, 90, 100, 125], receptions: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  rushRec: [25, 40, 50, 60, 70, 80, 90, 100, 125], completions: [10, 15, 18, 20, 22, 25, 28],
};

const rate = (hit, n) => (n ? hit / n : 0);

// Hit counts for one rung: last 5, all games, vs this opponent, home/away like tonight.
function rungHits(rows, statKey, thr, opp, home) {
  const ok = (r) => (r.stats[statKey] || 0) >= thr;
  const last5 = rows.slice(0, 5);
  const vs = rows.filter((r) => r.opp === opp);
  const ha = rows.filter((r) => (home ? r.atVs !== "@" : r.atVs === "@")).slice(0, 5);
  return {
    l5: last5.filter(ok).length, l5n: last5.length,
    all: rows.filter(ok).length, n: rows.length,
    vs: vs.filter(ok).length, vsn: vs.length,
    ha: ha.filter(ok).length, han: ha.length,
  };
}

// Every rung for one prop, with hit rates and FanDuel's price (or an estimate).
function altLadder({ rows, statKey, l, opp, home }) {
  const steps = ALT_STEPS[statKey];
  if (!steps || !rows.length) return [];
  const vals = rows.map((r) => r.stats[statKey] || 0);
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const sd = Math.max(Math.sqrt(vals.reduce((t, v) => t + (v - mean) ** 2, 0) / vals.length), 0.6);
  return steps.map((thr) => {
    const line = thr - 0.5;
    const posted = line === l?.line ? l.over : null;
    const alt = l?.alts?.[line]?.over;
    const odds = posted || alt || (l && Number.isFinite(l.line) ? estimatePrice(l, sd, line, "over") : null);
    return { thr, line, odds, dec: decimal(odds), source: posted ? "FanDuel line" : alt ? "FanDuel alt" : "estimated", ...rungHits(rows, statKey, thr, opp, home) };
  });
}

// The best alt leg for a prop: the highest rung cleared in 4+ of the last 5 and 70%+ of all
// games, priced like the alt lines worth playing (about -400 to -110).
function altTrend(args) {
  const ladder = altLadder(args).filter((s) => s.l5n >= 4 && s.l5 >= s.l5n - 1 && rate(s.all, s.n) >= 0.7
    && s.dec && s.dec >= 1.25 && s.dec <= 1.95);
  return ladder.length ? ladder[ladder.length - 1] : null;
}

const pct = (h, n) => `${Math.round(rate(h, n) * 100)}%`;

// Same-game combos: up to 6 legs from different players, best signals first, no repeats.
function altSgps(cands) {
  const byGame = {};
  cands.filter((c) => c.alt).forEach((c) => (byGame[c.gameId] ||= []).push(c));
  const out = [];
  for (const legs of Object.values(byGame)) {
    const score = (c) => rate(c.l5Hits, c.l5n) * 2 + rate(c.allHits, c.n) + (c.vsn ? rate(c.vsHits, c.vsn) * 0.5 : 0);
    const pool = legs.sort((a, b) => score(b) - score(a));
    const used = new Set();
    for (let k = 0; k < 2; k++) { // up to 2 combos per game
      const combo = [];
      for (const c of pool) {
        if (used.has(c.id) || combo.some((x) => x.player === c.player)) continue;
        combo.push(c);
        if (combo.length === 6) break; // up to 6 legs to pick from
      }
      if (combo.length < (k ? 4 : 2)) break; // a second combo only if it has 4+ legs
      combo.forEach((c) => used.add(c.id));
      out.push(combo);
    }
  }
  return out.sort((a, b) => Math.min(...b.map((c) => rate(c.l5Hits, c.l5n))) - Math.min(...a.map((c) => rate(c.l5Hits, c.l5n))));
}

// "Each leg hit in at least X of last Y games", using the weakest leg.
function signal(legs, hit, n, text) {
  if (legs.some((c) => !c[n])) return "";
  const worst = legs.reduce((w, c) => (rate(c[hit], c[n]) < rate(w[hit], w[n]) ? c : w), legs[0]);
  const all = legs.every((c) => c[hit] === c[n]);
  const words = all ? `${worst[hit]} of last ${worst[n]}` : `at least ${worst[hit]} of last ${worst[n]}`;
  return `<div class="sig"><span>${text.icon} Each leg hit in ${words} ${text.what}</span><b>${pct(worst[hit], worst[n])}</b></div>`;
}

function renderAltTrends(header, cands) {
  const combos = altSgps(cands);
  sheet.altCombos = combos;
  sheet.autoParlays = null;
  const leg = (c) => `
    <div class="alt-leg"><b>${c.player}:</b> ${c.thr}+ ${c.stat} <span class="leg-odds">${c.source === "estimated" ? "~" : ""}${c.odds}</span></div>`;
  $("sheet-body").innerHTML = `${header}
    <p class="note">FanDuel's "X+" alternate lines. Each leg is the highest rung the player cleared in at least 4 of his last 5 games. Same-game parlays, so FanDuel reprices them; prices with ~ are estimates, so check them in FanDuel.</p>
    ${combos.length ? combos.map((legs, i) => {
      const dec = legs.reduce((d, c) => d * c.dec, 1);
      return `
      <div class="auto">
        <div class="auto-head"><b>${legs[0].sport ? `${legs[0].sport} · ` : ""}${legs[0].away} @ ${legs[0].home}</b><span class="muted">${american(dec)} · ${money(slip.stake)} → ${money(slip.stake * dec)}</span></div>
        ${legs.map(leg).join("")}
        <div class="sigs">
          ${signal(legs, "l5Hits", "l5n", { icon: "⚡", what: "games" })}
          ${signal(legs, "vsHits", "vsn", { icon: "🛡", what: "games against their opponent" })}
          ${signal(legs, "haHits", "han", { icon: "📍", what: "home/away games" })}
        </div>
        <button class="btn primary" data-alt-use="${i}">Add to slip</button>
      </div>`;
    }).join("") : `<p class="status">No alternate-line combos on this slate yet. Props often post closer to game time.</p>`}`;
}

$("sheet-body").addEventListener("click", (e) => {
  const b = e.target.closest("[data-alt-use]");
  if (!b || !sheet.altCombos) return;
  for (const c of sheet.altCombos[+b.dataset.altUse] || []) {
    if (slip.legs.some((x) => x.id === c.id)) continue;
    const { id, player, playerId, team, opp, gameId, date, stat, gradeKey, league, side, line, odds, est, l5, season } = c;
    slip.legs.push({ id, player, playerId, team, opp, gameId, date, stat, gradeKey, league, side, line, odds, est, l5, season, yes: false, group: "Alt lines SGP", on: true });
  }
  persist();
  b.textContent = "Added ✓";
  b.classList.remove("primary");
});

// SGP+ like Artis's own tickets: one multi-game parlay made of same-game blocks of alt lines
// (2-5 legs per game, a single leg when a game only has one), until it pays about $1,000.
const PLUS_TICKETS = 3;
const PLUS_MAX_LEGS = 15;
const PLUS_BLOCK = 5;
const altScore = (c) => rate(c.l5Hits, c.l5n) * 2 + rate(c.allHits, c.n) + (c.vsn ? rate(c.vsHits, c.vsn) * 0.5 : 0);

function altPlusTickets(cands) {
  const byGame = {};
  cands.filter((c) => c.alt).forEach((c) => (byGame[c.gameId] ||= []).push(c));
  const games = Object.values(byGame).map((legs) => legs.sort((a, b) => altScore(b) - altScore(a)))
    .sort((a, b) => altScore(b[0]) - altScore(a[0]));
  const used = new Set();
  const tickets = [];
  for (let t = 0; t < PLUS_TICKETS && games.length; t++) {
    const order = games.slice(t % games.length).concat(games.slice(0, t % games.length)); // each ticket leads with a different game
    const blocks = [];
    let dec = 1;
    let legs = 0;
    for (const g of order) {
      const pay = slip.stake * dec;
      if (legs >= MIN_LEGS && pay >= TARGET.goal) break;
      const block = [];
      for (const c of g) {
        if (used.has(c.id) || block.some((x) => x.player === c.player)) continue;
        block.push(c);
        if (block.length === PLUS_BLOCK || legs + block.length >= PLUS_MAX_LEGS) break;
      }
      if (!block.length) continue;
      block.forEach((c) => { used.add(c.id); dec *= c.dec; });
      legs += block.length;
      blocks.push(block);
      if (legs >= PLUS_MAX_LEGS) break;
    }
    if (legs >= 2) tickets.push({ blocks, dec, legs });
  }
  return tickets;
}

function renderAltPlus(header, cands) {
  const tickets = altPlusTickets(cands);
  sheet.altPlus = tickets;
  sheet.autoParlays = null;
  const leg = (c) => `<div class="alt-leg"><b>${c.player}</b> ${c.thr}+ ${c.stat} <span class="leg-odds">${c.source === "estimated" ? "~" : ""}${c.odds}</span>
    <small class="muted"> · L5 ${c.l5Hits}/${c.l5n} · season ${c.allHits}/${c.n}</small></div>`;
  $("sheet-body").innerHTML = `${header}
    <p class="note">Built like your own tickets: same-game blocks of alternate "X+" lines from several games in one parlay (FanDuel's SGP+). Every leg cleared its line in 4+ of the last 5 games. FanDuel reprices each same-game block, so the real payout will be lower than the straight math shown. Prices with ~ are estimates.</p>
    ${tickets.length ? tickets.map((t, i) => `
      <div class="auto">
        <div class="auto-head"><b>SGP+ #${i + 1} · ${t.blocks.length} game${t.blocks.length === 1 ? "" : "s"} · ${t.legs} legs</b>
          <span class="muted">~${american(t.dec)} · ${money(slip.stake)} → ~${money(slip.stake * t.dec)}</span></div>
        ${t.blocks.map((b) => `
          <div class="plus-block">
            <div class="muted"><small>${b.length > 1 ? "SGP · " : ""}${b[0].sport ? `${b[0].sport} · ` : ""}${b[0].away} @ ${b[0].home}</small></div>
            ${b.map(leg).join("")}
          </div>`).join("")}
        <button class="btn primary" data-plus-use="${i}">Add to slip</button>
      </div>`).join("") : `<p class="status">Not enough alternate-line picks on this slate yet. Props often post closer to game time.</p>`}`;
}

$("sheet-body").addEventListener("click", (e) => {
  const b = e.target.closest("[data-plus-use]");
  if (!b || !sheet.altPlus) return;
  const t = sheet.altPlus[+b.dataset.plusUse];
  for (const c of (t?.blocks || []).flat()) {
    if (slip.legs.some((x) => x.id === c.id)) continue;
    const { id, player, playerId, team, opp, gameId, date, stat, gradeKey, league, side, line, odds, l5, season } = c;
    slip.legs.push({ id, player, playerId, team, opp, gameId, date, stat, gradeKey, league, side, line, odds, est: null, l5, season, yes: false, group: `SGP+ #${+b.dataset.plusUse + 1}`, on: true });
  }
  persist();
  b.textContent = "Added ✓";
  b.classList.remove("primary");
});
