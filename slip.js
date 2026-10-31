// Slip builder: tap Over/Under on a player page to add a leg, tap legs on and off,
// and see the payout against the $400–$2,500 target. Saved slips (results.js) live on this device.
// Shares globals from the other scripts (state, sheet, $, fmt, openSheet, loadPref, savePref).

const TARGET = { low: 800, goal: 1000, high: 1500 }; // Artis aims for about $1,000 back
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
  // Pick up FanDuel/DraftKings bet-slip links for new legs (odds.js) before saving.
  if (typeof betLinksFor === "function") slip.legs.forEach((l) => { if (!l.links) l.links = betLinksFor(l) || undefined; });
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
  if (n >= 1000 || Number.isInteger(n)) return `$${Math.round(n).toLocaleString()}`;
  return `$${n.toFixed(2)}`;
}

function hits(rows, key, side, line) {
  const ok = (r) => (side === "over" ? (r.stats[key] || 0) > line : (r.stats[key] || 0) < line);
  const last5 = rows.slice(0, 5);
  return { l5: last5.filter(ok).length, l5n: last5.length, all: rows.filter(ok).length, n: rows.length };
}

// HTML for the Over/Under buttons on a player page.
function propPicker({ player, playerId, team, opp, game, stats, lines, estimate, rows }) {
  if (!lines || !Object.keys(lines).length) return "";
  // Stat props from the table columns, plus yes-only props like Anytime TD that score a column stat.
  const items = [
    ...stats.filter((s) => lines[s.key]).map((s) => ({ key: s.key, statKey: s.key, label: s.label })),
    ...Object.entries(lines).filter(([, l]) => l.statKey).map(([key, l]) => ({ key, statKey: l.statKey, label: l.label })),
  ];
  const rowsHtml = items.map((s) => {
    const l = lines[s.key];
    const est = estimate(s.statKey);
    const btn = (side, odds) => {
      if (odds == null) return "";
      const id = `${game.id}|${player}|${s.key}|${side}`;
      const h = hits(rows, s.statKey, side, l.line);
      candidates[id] = {
        id, player, team, opp, gameId: game.id, date: game.date.toISOString(),
        stat: s.label, side, line: l.line, odds, est: Math.round(est * 10) / 10, yes: !!l.yes,
        playerId, gradeKey: s.statKey, league: state.league,
        l5: `${h.l5}/${h.l5n}`, season: `${h.all}/${h.n}`, on: true,
      };
      const inSlip = slip.legs.some((x) => x.id === id);
      const lean = side === "over" ? est > l.line : est < l.line;
      return `<button class="pick ${inSlip ? "added" : ""} ${lean ? "lean" : ""}" data-add-leg="${id}">
          ${l.yes ? "Yes" : `${side === "over" ? "O" : "U"} ${l.line}`} <small>${odds}</small><br><small>L5 ${h.l5}/${h.l5n}</small>
        </button>`;
    };
    return `<div class="pick-row"><span class="pick-stat">${s.label}<br><small>est ${fmt(est, s.statKey)}</small></span>${btn("over", l.over)}${btn("under", l.under)}</div>`;
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

function legText(l) {
  if (l.yes || (/TD/.test(l.stat) && !/Pass|Rush|Rec/.test(l.stat))) return l.stat; // "Anytime TD", "Double-double"
  return `${l.side === "over" ? "Over" : "Under"} ${l.line} ${l.stat}`;
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

// One link that opens FanDuel / DraftKings with every linked leg already in the bet slip.
function bookLink(legs, book) {
  const links = legs.map((l) => l.links?.[book]).filter(Boolean);
  if (!links.length) return null;
  if (book === "fd") {
    const parts = links.map((u, i) => {
      const q = new URL(u).searchParams;
      return `marketId[${i}]=${encodeURIComponent(q.get("marketId"))}&selectionId[${i}]=${encodeURIComponent(q.get("selectionId"))}`;
    });
    return { url: `https://sportsbook.fanduel.com/addToBetslip?${parts.join("&")}`, n: links.length };
  }
  const first = new URL(links[0]);
  const outcomes = links.map((u) => new URL(u).searchParams.get("outcomes")).filter(Boolean);
  return { url: `${first.origin}${first.pathname}?outcomes=${outcomes.map(encodeURIComponent).join("+")}`, n: outcomes.length };
}

function placeButtons(legs) {
  if (!legs.length) return "";
  const fd = bookLink(legs, "fd");
  const dk = bookLink(legs, "dk");
  if (!fd && !dk) return `<p class="note">No FanDuel/DraftKings bet-slip links for these legs yet (alternate and estimated lines usually don't have one). Reload the picks after props post, or add them in the app by hand.</p>`;
  const btn = (b, name) => b ? `<a class="btn ${name === "FanDuel" ? "primary" : ""} place-btn" href="${b.url}" target="_blank" rel="noopener">Place it on ${name}${b.n < legs.length ? ` (${b.n} of ${legs.length})` : ""} ↗</a>` : "";
  const missing = legs.filter((l) => !l.links?.fd).map((l) => l.player);
  return `<div class="settings-actions place-row">${btn(fd, "FanDuel")}${btn(dk, "DraftKings")}</div>
    ${missing.length && fd ? `<p class="note">Add by hand in FanDuel: ${missing.join(", ")}.</p>` : ""}`;
}

function renderSlip() {
  const m = slipMath(slip.legs);
  const inRange = m.payout >= TARGET.low && m.payout <= TARGET.high;
  const stakeFor = (target) => (m.dec > 1 ? money(target / m.dec) : "–");
  const legs = slip.legs.map((l) => `
    <div class="leg ${l.on ? "" : "off"}">
      <button class="leg-toggle" data-toggle-leg="${l.id}" aria-label="Include leg">${l.on ? "✓" : ""}</button>
      <div class="leg-main">
        <div><b>${l.player}</b> ${legText(l)}</div>
        <small>${l.team} vs ${l.opp} · est ${l.est} · L5 ${l.l5} · season ${l.season}${l.group ? ` · ${l.group}` : ""}</small>
      </div>
      <span class="leg-odds">${l.odds}</span>
      <button class="leg-x" data-remove-leg="${l.id}" aria-label="Remove leg">✕</button>
    </div>`).join("");

  const allOn = slip.legs.every((l) => l.on);
  $("sheet-body").innerHTML = slip.legs.length ? `
    <div class="settings-actions top-actions">
      <button class="btn" data-check-all="${allOn ? "off" : "on"}">${allOn ? "Uncheck all" : "Check all"}</button>
    </div>
    <div class="slip-legs">${legs}</div>
    <div class="slip-sum">
      <label>Stake $<input id="stake" type="number" inputmode="decimal" min="1" step="1" value="${slip.stake}"></label>
      <div class="slip-odds">${m.on.length} legs · ${american(m.dec)}</div>
      <div class="slip-pay ${inRange ? "in" : "out"}">Pays ${money(m.payout)}</div>
      <p class="note">Your target is ${money(TARGET.low)}–${money(TARGET.high)}. Stake for ${money(TARGET.low)}: ${stakeFor(TARGET.low)} · for ${money(TARGET.high)}: ${stakeFor(TARGET.high)}.</p>
      ${m.sameGame ? `<p class="warn">Some legs are from the same game. FanDuel reprices same-game parlays, so the real payout will usually be lower than this.</p>` : ""}
      <p class="note">Odds are FanDuel's standard lines. YourWay lines you move in FanDuel will change the price.</p>
    </div>
    ${placeButtons(m.on)}
    <div class="settings-actions">
      <button id="slip-save" class="btn primary">Save slip</button>
      <button id="slip-clear" class="btn">Clear</button>
    </div>
    ${slip.justSaved ? `<p class="note">Saved ✓ Find it under 📋 My slips, where you can edit lines and track results.</p>` : ""}` : `<p class="status">Your slip is empty. Open a player and tap Over or Under to add a leg.</p>`;
  slip.justSaved = false;
}

$("slip-bar").addEventListener("click", openSlip);

$("sheet-body").addEventListener("click", (e) => {
  const t = e.target.closest("button");
  if (!t) return;
  const d = t.dataset;
  if (d.addLeg) return toggleCandidate(d.addLeg, t);
  if (d.checkAll) {
    slip.legs.forEach((l) => { l.on = d.checkAll === "on"; });
  } else if (d.toggleLeg) {
    const leg = slip.legs.find((x) => x.id === d.toggleLeg);
    if (leg) leg.on = !leg.on;
  } else if (d.removeLeg) {
    slip.legs = slip.legs.filter((x) => x.id !== d.removeLeg);
  } else if (t.id === "slip-save") {
    const m = slipMath(slip.legs);
    if (!m.on.length) return;
    slip.saved.unshift({
      id: String(Date.now()), at: Date.now(), stake: slip.stake, book: "FanDuel",
      legs: m.on.map((l) => ({ ...l, result: "pending" })),
    });
    saveList("pb.saved", slip.saved);
    slip.justSaved = true;
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
