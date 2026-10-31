// Bank builder: a ladder of 2-pick parlays. Start with a bank (say $50), bet all of it on
// a 2-pick parlay that returns about 1.45x, roll the whole return into the next bet, and
// reach the goal (say $1,000) in 8 wins. A loss restarts the ladder.
// Shares globals from the other scripts (state, sheet, slip, $, decimal, american, money,
// legText, reason, persist, openSheet, openSlip, loadPref, savePref, slateCandidates,
// withoutSaved, skippedNote, LEAGUES).

const LADDER_KEY = "pb.ladder";
const LADDER_DEFAULT = { start: 50, goal: 1000, steps: 8, step: 1, bank: 50, last: null, done: false, picks: {} };

function loadLadder() {
  try { return { ...LADDER_DEFAULT, ...JSON.parse(localStorage.getItem(LADDER_KEY) || "{}") }; } catch { return { ...LADDER_DEFAULT }; }
}

function saveLadder(l) {
  try { localStorage.setItem(LADDER_KEY, JSON.stringify(l)); } catch { /* storage blocked */ }
}

// Each rung returns the same multiple, so start x multiple^steps = goal.
function ladderMultiple(l) {
  return (l.goal / l.start) ** (1 / l.steps);
}

function rungs(l) {
  const m = ladderMultiple(l);
  return Array.from({ length: l.steps }, (_, i) => ({ n: i + 1, from: l.start * m ** i, to: l.start * m ** (i + 1) }));
}

// Best 2-pick parlays for this rung: picks from different games, together paying close to the
// ladder multiple (a little over is fine), ranked by the chance both hit.
// Short-priced legs: the app's safer lines first, then posted lines at short odds.
function bankLegs(cands) {
  const seen = new Set();
  return [...cands.filter((c) => c.bank), ...cands.filter((c) => !c.smart && c.dec <= 1.8)]
    .filter((c) => { const k = `${c.player}|${c.stat}`; return !seen.has(k) && seen.add(k); })
    .sort((a, b) => b.prob - a.prob);
}

function bankEmpty(cands) {
  const games = sheet.bankGames || 0;
  const legs = bankLegs(cands);
  const why = games < 2
    ? `Only ${games} game${games === 1 ? " hasn't" : "s haven't"} started yet on this day in the sports you picked, and the 2 picks have to come from different games.`
    : legs.length < 2
      ? `Only ${legs.length} pick${legs.length === 1 ? "" : "s"} at short odds cleared the app's bar today. FanDuel posts more props closer to game time.`
      : "None of today's short-odds picks are in different games.";
  return `<p class="status">${why}</p>
    <div class="settings-actions"><button class="btn primary" data-bank-tomorrow>See tomorrow's picks</button></div>`;
}

function bankPairs(cands, multiple) {
  const legs = bankLegs(cands).slice(0, 80);
  const pairs = [];
  for (let i = 0; i < legs.length; i++) {
    for (let j = i + 1; j < legs.length; j++) {
      const a = legs[i];
      const b = legs[j];
      if (a.gameId === b.gameId || a.player === b.player) continue;
      if (a.side === "under" && b.side === "under") continue; // overs first: one under at most
      const dec = a.dec * b.dec;
      pairs.push({ legs: [a, b], dec, prob: a.prob * b.prob, fits: dec >= multiple * 0.97 && dec <= multiple * 1.3 });
    }
  }
  const fitting = pairs.filter((p) => p.fits).sort((x, y) => y.prob - x.prob);
  // Nothing lands in range: fall back to the pairs closest to the multiple.
  const pool = fitting.length ? fitting : pairs.sort((x, y) => Math.abs(x.dec - multiple) - Math.abs(y.dec - multiple));
  const out = [];
  const used = new Set();
  for (const p of pool) {
    if (p.legs.some((l) => used.has(l.player))) continue; // 3 different options, no shared players
    p.legs.forEach((l) => used.add(l.player));
    out.push(p);
    if (out.length >= 3) break;
  }
  return out;
}

const pickText = (c) => ({ text: `${c.sport ? `${c.sport} · ` : ""}${c.player} ${legText(c)}`, odds: c.odds });

// Each rung shows its 2 picks: the ones you bet, or for the current rung the top suggestion.
function ladderHtml(l, pairs) {
  return `<div class="ladder">${rungs(l).reverse().map((r) => {
    const won = r.n < l.step || l.done;
    const now = r.n === l.step && !l.done;
    const picks = l.picks?.[r.n] || (now && pairs[0] ? pairs[0].legs.map(pickText) : null);
    const tag = won ? "✓ Won" : now ? (l.picks?.[r.n] ? "Your bet" : picks ? "Suggested" : "") : "";
    return `
    <div class="rung ${won ? "done" : now ? "now" : ""}">
      <div class="rung-head"><b>BET ${r.n}</b><span>⚡</span><b>${money(Math.round(r.from))} – ${money(Math.round(r.to))}</b>${tag ? `<small>${tag}</small>` : ""}</div>
      ${picks && (won || now) ? `<div class="rung-picks">${picks.map((p) => `<div><span>${p.text}</span><span>${p.odds}</span></div>`).join("")}</div>` : ""}
    </div>`;
  }).join("")}</div>`;
}

function renderBank(cands, note = "") {
  const l = loadLadder();
  const m = ladderMultiple(l);
  const target = l.bank * m;
  const pairs = cands ? bankPairs(cands, m) : [];
  sheet.bankPairs = pairs;
  $("sheet-body").innerHTML = `
    <div class="bank-setup">
      <label>Start $<input class="num" data-ladder="start" type="number" inputmode="decimal" min="1" value="${l.start}"></label>
      <label>Goal $<input class="num" data-ladder="goal" type="number" inputmode="decimal" min="2" value="${l.goal}"></label>
      <label>Bets <input class="num" data-ladder="steps" type="number" inputmode="numeric" min="2" max="15" value="${l.steps}"></label>
    </div>
    ${ladderHtml(l, pairs)}
    <div class="slip-sum">
      ${l.done ? `<div><b>🎉 Goal reached: ${money(l.bank)}</b>. Tap Restart to start a new ladder.</div>` : `<div><b>Bet ${l.step} of ${l.steps}</b> · bet <b>${money(l.bank)}</b> to get back about <b>${money(target)}</b></div>`}
      <div class="muted">Each bet needs about ${american(m)} (${m.toFixed(2)}x back, stake included). 2 picks, different games.</div>
      <div class="settings-actions">
        ${l.done ? "" : `<button class="btn primary" data-ladder-won>✓ Won, next bet</button>`}
        <button class="btn" data-ladder-lost>${l.done ? "Restart" : "✗ Lost, restart"}</button>
      </div>
    </div>
    ${note}
    ${cands == null || l.done ? "" : pairs.length ? pairs.map((p, i) => `
      <div class="auto">
        <div class="auto-head"><b>Option ${i + 1}</b><span class="${p.fits ? "in" : "out"}">${american(p.dec)} · ${money(l.bank)} → ${money(l.bank * p.dec)}</span></div>
        <small class="auto-why">Both hit about ${Math.round(p.prob * 100)}% of the time${p.fits ? "" : " · pays less than this rung needs"}</small>
        ${p.legs.map((c) => `
          <div class="auto-leg">
            <div><b>${c.player}</b> ${legText(c)} <span class="muted">${c.team} vs ${c.opp}</span><br>
            <small>hits ~${Math.round(c.prob * 100)}% · ${reason(c)}</small>
            ${c.priceSource === "estimated" ? `<small class="muted">FanDuel "${c.line + 0.5}+ ${c.stat}" market · price estimated, check it in FanDuel</small>` : ""}</div>
            <span class="leg-odds">${c.odds}</span>
          </div>`).join("")}
        <button class="btn primary" data-bank-use="${i}">${l.picks?.[l.step] && l.picks[l.step][0].text === pickText(p.legs[0]).text ? "In your slip ✓" : `Bet this (${money(l.bank)})`}</button>
      </div>`).join("")
    : bankEmpty(cands)}
    <p class="note">One loss ends the run, so 8 straight wins is a long shot even with likely picks. Only bet the start amount you're OK losing.</p>`;
}

async function openBank() {
  sheet.game = null;
  $("sheet-back").hidden = true;
  $("sheet-title").textContent = "🏦 Bank builder";
  openSheet();
  const status = (msg) => renderBank(null, `${sportChips()}<p class="status">${msg}</p>`);
  sheet.reopen = openBank;
  status("Finding picks…");
  if (!loadPref("sgoKey", "")) return status("Add your SportsGameOdds key in ⚙︎ Settings first.");
  const r = await sportsCandidates(status);
  if (!r) return; // reopened or sports changed meanwhile
  const { all, games, failed } = r;
  const cands = withoutSaved(all.sort((a, b) => rank(b) - rank(a)));
  sheet.bankCands = cands;
  sheet.bankGames = games;
  const note = `${sportChips()}${skippedNote(cands)}${failed.length ? `<p class="note">Couldn't load ${failed.join(", ")} right now.</p>` : ""}`;
  sheet.bankNote = note;
  renderBank(cands, note);
}

$("bank").addEventListener("click", openBank);

$("sheet-body").addEventListener("click", (e) => {
  const t = e.target.closest("button");
  if (!t) return;
  const d = t.dataset;
  if (d.bankTomorrow !== undefined) {
    const next = new Date(state.date);
    next.setDate(next.getDate() + 1);
    state.date = next;
    t.textContent = "Loading…";
    return load().then(openBank);
  }
  const l = loadLadder();
  if (d.bankUse !== undefined) {
    const p = sheet.bankPairs?.[+d.bankUse];
    if (!p) return;
    // The slip becomes this bet: both picks, staked with the whole bank.
    slip.legs = p.legs.map((c) => {
      const { id, player, playerId, team, opp, gameId, date, stat, gradeKey, league, side, line, odds, est, l5, season } = c;
      return { id, player, playerId, team, opp, gameId, date, stat, gradeKey, league, side, line, odds, est, l5, season, yes: false, group: `Bank builder · bet ${l.step}`, on: true };
    });
    slip.stake = Math.round(l.bank * 100) / 100;
    savePref("stake", String(slip.stake));
    l.last = p.dec;
    l.picks = { ...(l.picks || {}), [l.step]: p.legs.map(pickText) };
    saveLadder(l);
    persist();
    // Stay on the ladder so the picks show in this bet's row; the slip bar has the bet.
    return renderBank(sheet.bankCands || null, `${sheet.bankNote || ""}<p class="note">Added to your slip. Place it on FanDuel, then come back and tap Won or Lost.</p>`);
  }
  if (d.ladderWon !== undefined) {
    l.bank = Math.round(l.bank * (l.last || ladderMultiple(l)) * 100) / 100;
    if (l.step >= l.steps) l.done = true;
    else l.step += 1;
    l.last = null;
  } else if (d.ladderLost !== undefined) {
    Object.assign(l, { step: 1, bank: l.start, last: null, done: false, picks: {} });
  } else {
    return;
  }
  saveLadder(l);
  renderBank(sheet.bankCands || null, sheet.bankNote || "");
});

$("sheet-body").addEventListener("change", (e) => {
  const field = e.target.dataset?.ladder;
  if (!field) return;
  const v = parseFloat(e.target.value);
  if (!(v > 0)) return;
  const l = loadLadder();
  l[field] = field === "steps" ? Math.max(2, Math.min(15, Math.round(v))) : v;
  if (l.goal <= l.start) l.goal = l.start * 2;
  // Changing the plan restarts the ladder.
  Object.assign(l, { step: 1, bank: l.start, last: null, done: false, picks: {} });
  saveLadder(l);
  renderBank(sheet.bankCands || null, sheet.bankNote || "");
});
