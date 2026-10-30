// My slips: saved slips with editable lines/odds (for whatever you actually got on FanDuel
// or DraftKings), automatic grading from ESPN box scores once games finish, and a record.
// Shares globals from the other scripts (slip, sheet, $, money, american, decimal, legText,
// saveList, loadGameLog, openSheet, persist, openSlip).

const BOOKS = ["FanDuel", "DraftKings", "Other"];
const RESULT_ICON = { won: "✓", lost: "✗", push: "–", void: "DNP", pending: "…" };
const NEXT_RESULT = { pending: "won", won: "lost", lost: "push", push: "pending", void: "pending" };

function legResult(leg, value) {
  if (value == null) return "pending";
  if (leg.yes) return value >= leg.line + 0.5 ? "won" : "lost";
  if (value === leg.line) return "push";
  const over = value > leg.line;
  return (leg.side === "over") === over ? "won" : "lost";
}

function slipStatus(s) {
  const r = s.legs.map((l) => l.result || "pending");
  if (r.includes("lost")) return "lost";
  if (r.includes("pending")) return "pending";
  return r.includes("won") ? "won" : "push";
}

// Return if it wins: pushes and DNPs drop out of the parlay, the way books settle them.
function slipReturn(s) {
  const live = s.legs.filter((l) => !["push", "void"].includes(l.result));
  return s.stake * live.reduce((d, l) => d * (decimal(l.odds) || 1), 1);
}

async function gradeSlip(s) {
  let changed = false;
  for (const leg of s.legs) {
    if (leg.result && leg.result !== "pending") continue;
    if (leg.manual || !leg.playerId || !leg.gradeKey || !leg.league) continue;
    const start = new Date(leg.date).getTime();
    if (Date.now() < start + 2.5 * 3600 * 1000) continue; // game can't be over yet
    try {
      const { rows } = await loadGameLog(leg.playerId, leg.league, true);
      const row = rows.find((r) => r.eventId === leg.gameId);
      if (row) {
        leg.actual = row.stats[leg.gradeKey] ?? 0;
        leg.result = legResult(leg, leg.actual);
      } else if (Date.now() > start + 24 * 3600 * 1000) {
        leg.result = "void"; // no box score a day later: didn't play
      }
      changed = changed || leg.result !== "pending";
    } catch { /* try again next time */ }
  }
  return changed;
}

function record() {
  const done = slip.saved.filter((s) => slipStatus(s) !== "pending");
  const won = done.filter((s) => slipStatus(s) === "won");
  const staked = done.reduce((t, s) => t + s.stake, 0);
  const returned = done.reduce((t, s) => t + (slipStatus(s) === "won" ? slipReturn(s) : slipStatus(s) === "push" ? s.stake : 0), 0);
  const legs = slip.saved.flatMap((s) => s.legs).filter((l) => ["won", "lost"].includes(l.result));
  const legWins = legs.filter((l) => l.result === "won").length;
  return { won: won.length, lost: done.filter((s) => slipStatus(s) === "lost").length, staked, returned, legWins, legs: legs.length };
}

function savedCard(s, i) {
  const status = slipStatus(s);
  const pays = slipReturn(s);
  const legs = s.legs.map((l, j) => `
    <div class="sleg">
      <button class="res ${l.result || "pending"}" data-cycle="${i}:${j}" title="Tap to set result">${RESULT_ICON[l.result || "pending"]}</button>
      <div class="sleg-main">
        <div><b>${l.player}</b> ${l.yes ? l.stat : `${l.side === "over" ? "O" : "U"} <input class="num" data-edit="${i}:${j}:line" type="number" inputmode="decimal" step="0.5" value="${l.line}"> ${l.stat}`}</div>
        <small>${l.team} vs ${l.opp}${l.actual != null ? ` · actual ${l.actual}` : ""}${l.manual ? " · set by you" : ""}</small>
      </div>
      <input class="num odds" data-edit="${i}:${j}:odds" type="text" inputmode="numbers-and-punctuation" value="${l.odds}">
    </div>`).join("");
  return `
    <div class="saved ${status}">
      <div class="auto-head">
        <b>${new Date(s.at).toLocaleDateString([], { month: "short", day: "numeric" })} · ${s.legs.length} legs</b>
        <span class="badge ${status}">${status === "pending" ? "Pending" : status === "won" ? `Won ${money(pays)}` : status === "push" ? "Push" : "Lost"}</span>
      </div>
      <div class="saved-row">
        <select data-edit="${i}:-1:book">${BOOKS.map((b) => `<option ${b === (s.book || "FanDuel") ? "selected" : ""}>${b}</option>`).join("")}</select>
        <label>Stake $<input class="num" data-edit="${i}:-1:stake" type="number" inputmode="decimal" min="1" value="${s.stake}"></label>
        <span class="muted">${american(pays / s.stake)} · pays ${money(pays)}</span>
      </div>
      ${legs}
      <div class="settings-actions">
        <button class="btn" data-load-slip="${i}">Load into slip</button>
        <button class="btn" data-delete-slip="${i}">Delete</button>
      </div>
    </div>`;
}

function renderMine() {
  const r = record();
  const profit = r.returned - r.staked;
  $("sheet-body").innerHTML = `
    <div class="slip-sum record">
      <div><b>${r.won}-${r.lost}</b> slips · legs hit ${r.legs ? `${r.legWins}/${r.legs} (${Math.round((100 * r.legWins) / r.legs)}%)` : "–"}</div>
      <div class="muted">Staked ${money(r.staked)} · returned ${money(r.returned)}</div>
      <div class="slip-pay ${profit >= 0 ? "in" : "out"}">${profit >= 0 ? "+" : "−"}${money(Math.abs(profit))}</div>
    </div>
    <div class="settings-actions"><button class="btn primary" data-grade-all>Check results</button></div>
    <p class="note">Change any line or odds to match what you actually got. Results fill in from ESPN box scores after games end; tap a result circle to set it yourself.</p>
    ${slip.saved.length ? slip.saved.map(savedCard).join("") : `<p class="status">No saved slips yet. Build a slip and tap Save slip.</p>`}`;
}

async function gradeAll() {
  let changed = false;
  for (const s of slip.saved) if (slipStatus(s) === "pending") changed = (await gradeSlip(s)) || changed;
  if (changed) saveList("pb.saved", slip.saved);
  return changed;
}

async function openMine() {
  sheet.game = null;
  $("sheet-back").hidden = true;
  $("sheet-title").textContent = "My slips";
  renderMine();
  openSheet();
  if (await gradeAll()) renderMine();
}

$("mine").addEventListener("click", openMine);

$("sheet-body").addEventListener("click", async (e) => {
  const t = e.target.closest("button");
  if (!t) return;
  const d = t.dataset;
  if (d.cycle) {
    const [i, j] = d.cycle.split(":").map(Number);
    const leg = slip.saved[i].legs[j];
    leg.result = NEXT_RESULT[leg.result || "pending"];
    leg.manual = leg.result !== "pending";
  } else if (d.loadSlip) {
    const s = slip.saved[+d.loadSlip];
    slip.legs = s.legs.map(({ result, actual, manual, ...l }) => ({ ...l, on: true }));
    slip.stake = s.stake;
    persist();
    return openSlip();
  } else if (d.deleteSlip) {
    slip.saved.splice(+d.deleteSlip, 1);
  } else if (d.gradeAll !== undefined) {
    t.textContent = "Checking…";
    await gradeAll();
  } else {
    return;
  }
  saveList("pb.saved", slip.saved);
  renderMine();
});

$("sheet-body").addEventListener("change", (e) => {
  const key = e.target.dataset?.edit;
  if (!key) return;
  const [i, j, field] = key.split(":");
  const s = slip.saved[+i];
  const v = e.target.value.trim();
  if (field === "book") s.book = v;
  else if (field === "stake" && parseFloat(v) > 0) s.stake = parseFloat(v);
  else if (field === "line" && Number.isFinite(parseFloat(v))) {
    const leg = s.legs[+j];
    leg.line = parseFloat(v);
    // Re-grade against the new line if the stat is already known.
    if (leg.actual != null && !leg.manual) leg.result = legResult(leg, leg.actual);
  } else if (field === "odds" && decimal(v)) {
    s.legs[+j].odds = /^[+-]/.test(v) ? v : `+${v}`;
  } else {
    return renderMine();
  }
  saveList("pb.saved", slip.saved);
  renderMine();
});
