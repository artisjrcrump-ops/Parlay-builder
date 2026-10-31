// Same-game parlay builder: 5 SGPs for one game, each built around a game script
// (shootout, favorite rolls, underdog hangs around, grind, value), with no shared picks.
// Shares globals from the other scripts.

const SGP_MAX_LEGS = 5;

// Which side the spread favors, from ESPN's "CHA -1.5" style detail.
function favoriteSide(g) {
  const abbr = (g.odds?.spread || "").split(" ")[0];
  if (abbr === g.home.abbr) return "home";
  if (abbr === g.away.abbr) return "away";
  return null;
}

function sgpThemes(g) {
  const fav = favoriteSide(g);
  const dog = fav === "home" ? "away" : fav === "away" ? "home" : null;
  const themes = [
    { name: "Shootout", why: "Overs on both sides: a fast, high-scoring game", fit: (c) => c.side === "over" },
  ];
  if (fav) {
    themes.push(
      { name: `${g[fav].name} roll`, why: `${g[fav].name} stars go over, ${g[dog].name} stars go under`,
        fit: (c) => (c.teamSide === fav) === (c.side === "over"), balance: true },
      { name: `${g[dog].name} hang around`, why: `${g[dog].name} stars go over in a closer game`,
        fit: (c) => (c.teamSide === dog) === (c.side === "over"), balance: true },
    );
  }
  themes.push(
    { name: "Grind it out", why: "Unders: a slow, low-scoring game", fit: (c) => c.side === "under" },
    { name: "Best value", why: "Biggest gaps between the app's estimate and FanDuel's line", fit: () => true, sort: (a, b) => b.edgeAbs - a.edgeAbs },
  );
  return themes;
}

function buildSgps(g, cands) {
  const used = new Set();
  const parlays = sgpThemes(g).map((t) => ({ ...t, legs: [] }));
  const full = (p) => p.legs.length >= SGP_MAX_LEGS
    || (p.legs.length >= 3 && slip.stake * p.legs.reduce((d, l) => d * l.dec, 1) >= TARGET.low);
  const canAdd = (p, c) => !used.has(c.id) && !used.has(`${c.player}|${c.stat}`) && !p.legs.some((l) => l.player === c.player);

  let progress = true;
  while (progress) {
    progress = false;
    for (const p of parlays) {
      if (full(p)) continue;
      const themed = cands.filter((c) => p.fit(c) && canAdd(p, c));
      if (p.sort) themed.sort(p.sort);
      // Alternate teams so "roll" scripts get overs from one side and unders from the other.
      if (p.balance) {
        const count = (side) => p.legs.filter((l) => l.teamSide === side).length;
        themed.sort((a, b) => count(a.teamSide) - count(b.teamSide));
      }
      // Stick to the game script; only "Best value" takes anything.
      const pick = themed[0];
      if (!pick) continue;
      p.legs.push({ ...pick });
      used.add(pick.id);
      used.add(`${pick.player}|${pick.stat}`);
      progress = true;
    }
  }
  return parlays.filter((p) => p.legs.length >= 2);
}

async function sgpCandidates(g, progress) {
  const summary = await getJSON(`${SITE}${LEAGUES[state.league].path}/summary?event=${g.id}`).catch(() => ({}));
  const injuries = {};
  for (const team of summary.injuries || []) {
    for (const inj of team.injuries || []) if (inj.athlete?.id) injuries[inj.athlete.id] = inj.status;
  }
  const players = [];
  for (const side of ["away", "home"]) {
    const roster = await loadRoster(g[side].id);
    roster.forEach((p) => players.push({ ...p, side, injury: injuries[p.id] }));
  }
  await loadSlateDvp().catch(() => null);

  let done = 0;
  const results = await pool(players, 6, async (p) => {
    const legs = await scorePlayer(g, p, 0.5, true);
    progress(`Checking ${g.away.abbr} @ ${g.home.abbr} players… ${++done}/${players.length}`);
    return legs.map((l) => ({ ...l, teamSide: p.side }));
  });
  return results.flat().filter(Boolean).sort((a, b) => b.prob + b.value - (a.prob + a.value));
}

async function runSgp(gameId) {
  const g = state.games.find((x) => x.id === gameId);
  if (!g) return;
  sheet.game = null;
  $("sheet-back").hidden = true;
  $("sheet-title").textContent = `SGPs · ${g.away.abbr} @ ${g.home.abbr}`;
  openSheet();
  if (!loadPref("sgoKey", "")) {
    $("sheet-body").innerHTML = `<p class="status">Add your SportsGameOdds key in ⚙︎ Settings first. SGPs need FanDuel's lines.</p>`;
    return;
  }
  const status = (msg) => { $("sheet-body").innerHTML = `<p class="status">${msg}</p>`; };
  try {
    const cands = withoutSaved(await sgpCandidates(g, status));
    // Posted lines plus YourWay lines; one leg per player and stat, so each prop uses whichever scores better.
    renderParlays(buildSgps(g, cands.filter((c) => !c.bank)), {
      header: skippedNote(cands),
      intro: "Each same-game parlay follows one game script so its legs help each other. Some legs use YourWay lines (a custom line FanDuel lets you set in same-game parlays); their prices are estimates until you set them in FanDuel. No pick appears in more than one.",
      outro: "FanDuel reprices same-game parlays for correlation, so the real payout will usually be lower than shown. These are model picks, not guarantees.",
      empty: "Not enough strong FanDuel props in this game yet. Props often post closer to tip-off.",
    });
  } catch (err) {
    status(`Couldn't build SGPs (${err.message}).`);
  }
}

function openSgpPicker() {
  sheet.game = null;
  $("sheet-back").hidden = true;
  $("sheet-title").textContent = "Same-game parlays";
  const games = state.games.filter((g) => g.state === "pre");
  $("sheet-body").innerHTML = games.length
    ? `<p class="note">Pick a game. The app builds 5 same-game parlays for it.</p>${games.map((g) => `
        <button class="player" data-sgp-game="${g.id}">
          <img src="${g.away.logo || ""}" alt="">
          <span class="pname">${g.away.name} @ ${g.home.name}</span>
          <span class="ppos">${g.odds?.total ? `O/U ${g.odds.total}` : ""}</span>
          <span class="ppos">${g.date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
        </button>`).join("")}`
    : `<p class="status">No upcoming games on this day.</p>`;
  openSheet();
}

$("sgp").addEventListener("click", openSgpPicker);

$("sheet-body").addEventListener("click", (e) => {
  const b = e.target.closest("[data-sgp-game]");
  if (b) runSgp(b.dataset.sgpGame);
});
