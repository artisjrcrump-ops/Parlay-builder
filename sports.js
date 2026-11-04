// All-sports slates: Auto parlays, Hottest 10 and the Bank builder pull picks from every
// sport turned on with the chips (NBA, NCAAB, NFL, NCAAF), for the day shown on the board.
// Same-game parlays stay one game at a time.
// Shares globals from the other scripts (state, sheet, $, LEAGUES, SITE, getJSON, ymd,
// loadRanks, parseGame, buildCandidates, loadPref, savePref).

const SPORTS_TTL = 10 * 60 * 1000;

function sportsOn() {
  const saved = loadPref("sports", loadPref("bankLeagues", ""));
  const keys = saved ? saved.split(",").filter((k) => LEAGUES[k]) : [];
  return keys.length ? keys : Object.keys(LEAGUES);
}

function sportChips() {
  const on = sportsOn();
  return `<div class="chips">${Object.entries(LEAGUES).map(([k, lg]) =>
    `<button class="chip ${on.includes(k) ? "on" : ""}" data-sport="${k}">${lg.label}</button>`).join("")}</div>${typeof oddsErrorNote === "function" ? oddsErrorNote() : ""}`;
}

// Score one league's slate for the board's day. The scoring code reads state.league and
// state.games, so swap them in for the run and put the board's back afterwards.
async function leagueCandidates(key, progress) {
  const lg = LEAGUES[key];
  const cacheKey = `${key}.${ymd(state.date)}`;
  sheet.sportCache ||= {};
  const hit = sheet.sportCache[cacheKey];
  if (hit && Date.now() - hit.at < SPORTS_TTL) return hit;
  const keep = { league: state.league, games: state.games };
  try {
    state.league = key;
    const [board, ranks] = await Promise.all([
      getJSON(`${SITE}${lg.path}/scoreboard?dates=${ymd(state.date)}${lg.query}`),
      loadRanks(key).catch(() => state.ranks[key] || {}),
    ]);
    state.ranks[key] = ranks;
    state.games = (board.events || []).map((ev) => parseGame(ev, ranks));
    const pre = state.games.filter((g) => g.state === "pre").length;
    const cands = pre ? await buildCandidates((msg) => progress(`${lg.label}: ${msg}`)) : [];
    cands.forEach((c) => { c.sport = lg.label; });
    sheet.sportCache[cacheKey] = { at: Date.now(), pre, cands };
    return sheet.sportCache[cacheKey];
  } finally {
    state.league = keep.league;
    state.games = keep.games;
  }
}

// Every sport that's on, one after another (they share state.league while scoring).
// Returns null if another run started meanwhile.
async function sportsCandidates(progress) {
  const token = (sheet.sportsToken = (sheet.sportsToken || 0) + 1);
  let all = [];
  let games = 0;
  const failed = [];
  for (const key of sportsOn()) {
    try {
      const r = await leagueCandidates(key, progress);
      all = all.concat(r.cands);
      games += r.pre;
    } catch {
      failed.push(LEAGUES[key].label);
    }
    if (token !== sheet.sportsToken) return null;
  }
  return { all, games, failed, leagues: sportsOn() };
}

$("sheet-body").addEventListener("click", (e) => {
  const chip = e.target.closest("[data-sport]");
  if (!chip) return;
  const on = new Set(sportsOn());
  on.has(chip.dataset.sport) ? on.delete(chip.dataset.sport) : on.add(chip.dataset.sport);
  if (!on.size) return; // keep at least one sport
  savePref("sports", [...on].join(","));
  sheet.reopen?.();
});
