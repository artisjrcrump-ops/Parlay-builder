// Slip builder: tap Over/Under on a player page to add a leg, tap legs on and off,
// and see the payout against the $400–$2,500 target. Saved slips live on this device.
// Shares globals from the other scripts (state, sheet, $, fmt, openSheet, loadPref, savePref).

const TARGET = { low: 400, high: 2500 };
const candidates = {}; // leg id -> leg, for the player page currently shown

function loadList(key) {
  try { return JSON.parse(localStorage.getItem(key) || "[]"); } catch { return []; }
}

function saveList(key, list) {
  try { localStorage.setItem(key, JSON.stringify(list)); } catch { /* storage full or blocked */ }
}

const slip = {
  legs: loadList("pb.slip"),
  saved: loadList("pb.saved"),
  stake: parseFloat(loadPref("stake", "10")) || 10,
};

function persist() {
  saveList("pb.slip", slip.legs);
  renderSlipBar();
}

function decimal(american) {
  const a = parseFloat(american);
  if (!Number.isFinite(a) || a === 0) return null;
  return a > 0 ? 1 + a / 100 : 1 + 100 / Math.abs(a);
}

function american(dec) {
  if (!dec || dec <= 1) return "–";
  return dec >= 2 ? `+${Math.round((dec - 1) * 100)}` : `${Math.round(-100 / (dec - 1))}`;
}

function money(n) {
  return n >= 1000 ? `$${Math.round(n).toLocaleString()}` : `$${n.toFixed(2)}`;
}

function hits(rows, key, side, line) {
  const ok = (r) => (side === "over" ? (r.stats[key] || 0) > line : (r.stats[key] || 0) < line);
  const last5 = rows.slice(0, 5);
  return { l5: last5.filter(ok).length, l5n: last5.length, all: rows.filter(ok).length, n: rows.length };
}

// HTML for the Over/Under buttons on a player page.
function propPicker({ player, team, opp, game, stats, lines, estimate, rows }) {
  if (!lines || !Object.keys(lines).length) return "";
  const rowsHtml = stats.filter((s) => lines[s.key]).map((s) => {
    const l = lines[s.key];
    const est = estimate(s.key);
    const btn = (side, odds) => {
      if (odds == null) return "";
      const id = `${game.id}|${player}|${s.key}|${side}`;
      const h = hits(rows, s.key, side, l.line);
      candidates[id] = {
        id, player, team, opp, gameId: game.id, date: game.date.toISOString(),
        stat: s.label, side, line: l.line, odds, est: Math.round(est * 10) / 10,
        l5: `${h.l5}/${h.l5n}`, season: `${h.all}/${h.n}`, on: true,
      };
      const inSlip = slip.legs.some((x) => x.id === id);
      const lean = side === "over" ? est > l.line : est < l.line;
      return `<button class="pick ${inSlip ? "added" : ""} ${lean ? "lean" : ""}" data-add-leg="${id}">
          ${side === "over" ? "O" : "U"} ${l.line} <small>${odds}</small><br><small>L5 ${h.l5}/${h.l5n}</small>
        </button>`;
    };
    return `<div class="pick-row"><span class="pick-stat">${s.label}<br><small>est ${fmt(est, s.key)}</small></span>${btn("over", l.over)}${btn("under", l.under)}</div>`;
  }).join("");
  return `<h3 class="pick-title">Add to slip</h3>${rowsHtml}
    <p class="note">Highlighted side is where the estimate leans. L5 = times it hit in the last 5 games.</p>`;
}

function toggleCandidate(id, btn) {
  const i = slip.legs.findIndex((x) => x.id === id);
  if (i >= 0) {
    slip.legs.splice(i, 1);
    btn.classList.remove("added");
  } else if (candidates[id]) {
    // Over and under on the same prop can't both be in a slip.
    const opposite = id.replace(/\|(over|under)$/, (m, side) => `|${side === "over" ? "under" : "over"}`);
    slip.legs = slip.legs.filter((x) => x.id !== opposite);
    btn.parentElement.querySelectorAll(".pick").forEach((b) => b.classList.remove("added"));
    slip.legs.push({ ...candidates[id] });
    btn.classList.add("added");
  }
  persist();
}

function slipMath(legs) {
  const on = legs.filter((l) => l.on);
  const dec = on.reduce((d, l) => d * (decimal(l.odds) || 1), 1);
  const games = new Set(on.map((l) => l.gameId)).size;
  return { on, dec, payout: slip.stake * dec, sameGame: on.length > games };
}

function renderSlipBar() {
  const bar = $("slip-bar");
  if (!slip.legs.length) {
    bar.hidden = true;
    return;
  }
  const m = slipMath(slip.legs);
  bar.hidden = false;
  bar.innerHTML = `<span><b>Slip</b> · ${m.on.length}/${slip.legs.length} legs · ${american(m.dec)}</span>
    <span>${money(slip.stake)} pays <b>${money(m.payout)}</b></span>`;
}

function openSlip() {
  sheet.game = null;
  $("sheet-back").hidden = true;
  $("sheet-title").textContent = "Your slip";
  renderSlip();
  openSheet();
}

function renderSlip() {
  const m = slipMath(slip.legs);
  const inRange = m.payout >= TARGET.low && m.payout <= TARGET.high;
  const stakeFor = (target) => (m.dec > 1 ? money(target / m.dec) : "–");
  const legs = slip.legs.map((l) => `
    <div class="leg ${l.on ? "" : "off"}">
      <button class="leg-toggle" data-toggle-leg="${l.id}" aria-label="Include leg">${l.on ? "✓" : ""}</button>
      <div class="leg-main">
        <div><b>${l.player}</b> ${l.side === "over" ? "Over" : "Under"} ${l.line} ${l.stat}</div>
        <small>${l.team} vs ${l.opp} · est ${l.est} · L5 ${l.l5} · season ${l.season}</small>
      </div>
      <span class="leg-odds">${l.odds}</span>
      <button class="leg-x" data-remove-leg="${l.id}" aria-label="Remove leg">✕</button>
    </div>`).join("");

  $("sheet-body").innerHTML = slip.legs.length ? `
    <div class="slip-legs">${legs}</div>
    <div class="slip-sum">
      <label>Stake $<input id="stake" type="number" inputmode="decimal" min="1" step="1" value="${slip.stake}"></label>
      <div class="slip-odds">${m.on.length} legs · ${american(m.dec)}</div>
      <div class="slip-pay ${inRange ? "in" : "out"}">Pays ${money(m.payout)}</div>
      <p class="note">Your target is ${money(TARGET.low)}–${money(TARGET.high)}. Stake for ${money(TARGET.low)}: ${stakeFor(TARGET.low)} · for ${money(TARGET.high)}: ${stakeFor(TARGET.high)}.</p>
      ${m.sameGame ? `<p class="warn">Some legs are from the same game. FanDuel reprices same-game parlays, so the real payout will usually be lower than this.</p>` : ""}
      <p class="note">Odds are FanDuel's standard lines. YourWay lines you move in FanDuel will change the price.</p>
    </div>
    <div class="settings-actions">
      <button id="slip-save" class="btn primary">Save slip</button>
      <button id="slip-clear" class="btn">Clear</button>
    </div>
    ${savedHtml()}` : `<p class="status">Your slip is empty. Open a player and tap Over or Under to add a leg.</p>${savedHtml()}`;
}

function savedHtml() {
  if (!slip.saved.length) return "";
  return `<h3 class="pick-title">Saved slips</h3>${slip.saved.map((s, i) => `
    <div class="saved">
      <div><b>${new Date(s.at).toLocaleDateString([], { month: "short", day: "numeric" })}</b> · ${s.legs.length} legs · ${money(s.stake)} pays ${money(s.payout)}</div>
      <small>${s.legs.map((l) => `${l.player} ${l.side === "over" ? "O" : "U"}${l.line} ${l.stat}`).join(" · ")}</small>
      <div class="settings-actions">
        <button class="btn" data-load-slip="${i}">Load</button>
        <button class="btn" data-delete-slip="${i}">Delete</button>
      </div>
    </div>`).join("")}`;
}

$("slip-bar").addEventListener("click", openSlip);

$("sheet-body").addEventListener("click", (e) => {
  const t = e.target.closest("button");
  if (!t) return;
  const d = t.dataset;
  if (d.addLeg) return toggleCandidate(d.addLeg, t);
  if (d.toggleLeg) {
    const leg = slip.legs.find((x) => x.id === d.toggleLeg);
    if (leg) leg.on = !leg.on;
  } else if (d.removeLeg) {
    slip.legs = slip.legs.filter((x) => x.id !== d.removeLeg);
  } else if (d.loadSlip) {
    const s = slip.saved[+d.loadSlip];
    slip.legs = s.legs.map((l) => ({ ...l }));
    slip.stake = s.stake;
  } else if (d.deleteSlip) {
    slip.saved.splice(+d.deleteSlip, 1);
    saveList("pb.saved", slip.saved);
  } else if (t.id === "slip-save") {
    const m = slipMath(slip.legs);
    if (!m.on.length) return;
    slip.saved.unshift({ at: Date.now(), stake: slip.stake, payout: m.payout, legs: m.on.map((l) => ({ ...l })) });
    saveList("pb.saved", slip.saved);
  } else if (t.id === "slip-clear") {
    slip.legs = [];
  } else {
    return;
  }
  persist();
  renderSlip();
});

$("sheet-body").addEventListener("change", (e) => {
  if (e.target.id !== "stake") return;
  const v = parseFloat(e.target.value);
  if (!(v > 0)) return;
  slip.stake = v;
  savePref("stake", String(v));
  persist();
  renderSlip();
});

renderSlipBar();
