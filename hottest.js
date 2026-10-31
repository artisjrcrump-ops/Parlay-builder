// 10 hottest picks of the day: the best single props on the slate for the sport picked in the
// dropdown, led by players who have been clearing their line lately. One pick per player.
// Shares globals from the other scripts (state, sheet, slip, LEAGUES, $, loadPref, savePref,
// renderTabs, load, slateCandidates, legText, reason, persist, openSheet, openSlip).

const HOT_COUNT = 10;

function hottestPicks(cands) {
  const heat = (c) => c.l5Rate * 0.5 + c.prob + c.value;
  const seen = new Set();
  return [...cands]
    .sort((a, b) => heat(b) - heat(a))
    .filter((c) => !seen.has(c.player) && seen.add(c.player))
    .slice(0, HOT_COUNT);
}

function hotHeader() {
  return `<label class="mode"><span>Sport</span><select id="hot-league">${Object.entries(LEAGUES)
    .map(([k, lg]) => `<option value="${k}" ${k === state.league ? "selected" : ""}>${lg.label}</option>`).join("")}</select></label>`;
}

function renderHottest(picks, note = sheet.hotNote || "") {
  sheet.hotPicks = picks;
  sheet.hotNote = note;
  const inSlip = (l) => slip.legs.some((x) => x.id === l.id);
  $("sheet-body").innerHTML = `${hotHeader()}${note}
    ${picks.length ? `
    <div class="settings-actions top-actions">
      <button class="btn primary" data-hot-add="all">Add all ${picks.length} to slip</button>
      <button class="btn" data-open-slip>Open slip</button>
    </div>
    <p class="note">Ranked by recent form (how often they cleared this line in the last 5), season hit rate, the estimate vs FanDuel's line, and how tonight's opponent defends that stat. One pick per player.</p>
    <div class="auto">
      ${picks.map((l, i) => `
        <div class="auto-leg">
          <div><b>${i + 1}. ${l.player}</b> ${legText(l)} <span class="muted">${l.team} vs ${l.opp}</span><br>
          <small>${reason(l)}</small></div>
          <button class="pick hot-pick ${inSlip(l) ? "added" : ""}" data-hot-add="${i}">${l.odds}<br><small>${inSlip(l) ? "Added" : "Add"}</small></button>
        </div>`).join("")}
    </div>
    <p class="note">Picks from a simple model, not guarantees.</p>`
    : `<p class="status">No strong picks for ${LEAGUES[state.league].label} on this day. Try another sport or day.</p>`}`;
}

async function openHottest() {
  sheet.game = null;
  $("sheet-back").hidden = true;
  $("sheet-title").textContent = "🔥 10 hottest picks";
  openSheet();
  const status = (msg) => { $("sheet-body").innerHTML = `${hotHeader()}<p class="status">${msg}</p>`; };
  if (!loadPref("sgoKey", "")) return status("Add your SportsGameOdds key in ⚙︎ Settings first. Hottest picks need FanDuel's lines.");
  try {
    const cands = withoutSaved(await slateCandidates(status));
    renderHottest(hottestPicks(postedOnly(cands)), skippedNote(cands));
  } catch (err) {
    status(/No upcoming/.test(err.message)
      ? `No upcoming ${LEAGUES[state.league].label} games on this day. Use ‹ › on the main screen to change the day.`
      : `Couldn't find picks (${err.message}).`);
  }
}

$("hot").addEventListener("click", openHottest);

$("sheet-body").addEventListener("change", async (e) => {
  if (e.target.id !== "hot-league") return;
  // Picking a sport switches the board too, so the picks and the games match.
  state.league = e.target.value;
  savePref("league", state.league);
  renderTabs();
  $("sheet-body").innerHTML = `${hotHeader()}<p class="status">Loading ${LEAGUES[state.league].label} games…</p>`;
  await load();
  openHottest();
});

$("sheet-body").addEventListener("click", (e) => {
  const b = e.target.closest("[data-hot-add]");
  if (!b || !sheet.hotPicks) return;
  const which = b.dataset.hotAdd;
  const chosen = which === "all" ? sheet.hotPicks : [sheet.hotPicks[+which]];
  for (const l of chosen) {
    const i = slip.legs.findIndex((x) => x.id === l.id);
    if (i >= 0) {
      if (which !== "all") slip.legs.splice(i, 1); // tap again to take it back out
      continue;
    }
    const { id, player, playerId, team, opp, gameId, date, stat, gradeKey, league, side, line, odds, est, l5, season, yes } = l;
    slip.legs.push({ id, player, playerId, team, opp, gameId, date, stat, gradeKey, league, side, line, odds, est, l5, season, yes, group: "Hottest 10", on: true });
  }
  persist();
  renderHottest(sheet.hotPicks);
});
