// NBA Degen mode: Artis's group game with Kevin and AJ. Each owns 6 NBA teams; picks can only
// come from players on those teams (an opponent counts only if his team is also owned).
// The dropdown under the sport tabs picks Off or whose 6 teams (each person only picks from their own).
// Shares globals from the other scripts (state, $, loadPref, savePref, renderBoard, load, sheet).

const DEGEN_TEAMS = {
  Kevin: ["DEN", "TOR", "GS", "MIA", "PHX", "MIN"],
  Artis: ["PHI", "BOS", "NY", "LAL", "DET", "POR"],
  AJ: ["SA", "CLE", "HOU", "DAL", "WSH", "ATL"],
};

// Each person picks only from their own 6 teams (no shared pool).
const degenPick = () => { const v = loadPref("degen", "off"); return v === "all" ? "Artis" : v; };
const degenOn = () => degenPick() !== "off" && state.league === "nba";
const degenOwner = (abbr) => Object.keys(DEGEN_TEAMS).find((who) => DEGEN_TEAMS[who].includes(abbr)) || null;
function degenAllows(abbr) {
  if (!degenOn()) return true;
  const owner = degenOwner(abbr);
  return owner === degenPick();
}
// Games with at least one eligible team (the other side's players stay out unless owned too).
const degenGame = (g) => degenAllows(g.away.abbr) || degenAllows(g.home.abbr);

function renderDegenBar() {
  const bar = $("degen-bar");
  if (!bar) return;
  bar.hidden = state.league !== "nba";
  const pick = degenPick();
  bar.innerHTML = `<label class="mode"><span>🎲 Degen</span><select id="degen-pick">
    ${[["off", "Off (all teams)"], ...["Artis", "Kevin", "AJ"].map((w) => [w, `${w}'s teams`])]
      .map(([v, l]) => `<option value="${v}" ${v === pick ? "selected" : ""}>${l}</option>`).join("")}
  </select></label>`;
}

document.addEventListener("change", (e) => {
  if (e.target.id !== "degen-pick") return;
  savePref("degen", e.target.value);
  // Picks were scored for the old pool; score again.
  sheet.sportCache = {};
  sheet.autoCache = null;
  renderDegenBar();
  if (state.games) renderBoard(state.games);
});
