// Auto parlays: scores every FanDuel prop for the day's key players and builds
// 5 themed parlays that never share a pick.
// Shares globals from the other scripts (state, sheet, slip, LEAGUES, SITE, $, getJSON,
// loadGameLog, getPlayerLines, opponentFactor, avg, hits, decimal, american, money,
// ordinal, openSheet, persist, TARGET).

const MAX_LEGS = 10;
const MAX_PER_GAME = 2;
const ODDS_RANGE = [1.33, 3.2]; // roughly -300 to +220: skip near-locks and long shots

const THEMES = [
  { name: "Weak defense overs", why: "Overs against bottom-third defenses", fit: (c) => c.side === "over" && c.oppDefPct >= 2 / 3 },
  { name: "Hot hands", why: "Players who cleared this line in 4 or 5 of their last 5", fit: (c) => c.l5Rate >= 0.8 },
  { name: "Shootout games", why: "Overs in the highest-total games on the slate", fit: (c) => c.side === "over" && c.totalPct >= 0.5 },
  { name: "Lockdown unders", why: "Unders against top-third defenses", fit: (c) => c.side === "under" && c.oppDefPct <= 1 / 3 },
  { name: "Best value", why: "Biggest gap between the app's estimate and FanDuel's line", fit: () => true, sort: (a, b) => b.edgeAbs - a.edgeAbs },
];

const PROP_LABEL = {
  points: "PTS", totalRebounds: "REB", assists: "AST", threes: "3PM", pra: "PRA",
  steals: "STL", blocks: "BLK", pr: "P+R", pa: "P+A", ra: "R+A", doubleDouble: "Double-double",
  passingYards: "Pass Yds", passingTouchdowns: "Pass TD", rushingYards: "Rush Yds",
  receptions: "Rec", receivingYards: "Rec Yds", anytimeTd: "Anytime TD", twoTd: "2+ TDs",
  passingAttempts: "Pass Att", completions: "Completions", interceptions: "INT", longReception: "Long Rec",
  rushRec: "Rush+Rec Yds",
};

// Leaders and injuries for one game, from ESPN's game summary.
async function gamePlayers(g) {
  const lg = LEAGUES[state.league];
  const summary = await getJSON(`${SITE}${lg.path}/summary?event=${g.id}`);
  const injuries = {};
  for (const team of summary.injuries || []) {
    for (const inj of team.injuries || []) if (inj.athlete?.id) injuries[inj.athlete.id] = inj.status;
  }
  const players = new Map();
  for (const team of summary.leaders || []) {
    const side = team.team?.id === g.home.id ? "home" : "away";
    for (const cat of team.leaders || []) {
      for (const l of (cat.leaders || []).slice(0, 1)) {
        const a = l.athlete;
        if (a?.id && !players.has(a.id)) {
          players.set(a.id, { id: a.id, name: a.displayName, pos: a.position?.abbreviation, side, injury: injuries[a.id] });
        }
      }
    }
  }
  return [...players.values()];
}

async function pool(items, size, fn) {
  const out = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try { out[idx] = await fn(items[idx]); } catch { out[idx] = null; }
    }
  });
  await Promise.all(workers);
  return out;
}

function stakeLabel() {
  return money(slip.stake);
}

// Every qualifying Over/Under leg for one player in one game, scored.
// yourWay: also allow custom lines FanDuel doesn't post (same-game parlays only).
async function scorePlayer(g, p, totalPct = 0.5, yourWay = false) {
  if (/out|doubtful/i.test(p.injury || "")) return [];
  const lines = await getPlayerLines(g, p.name);
  if (!lines || !Object.keys(lines).length) return [];
  const { rows } = await loadGameLog(p.id);
  if (rows.length < 3) return [];
  const team = g[p.side];
  const opp = g[p.side === "home" ? "away" : "home"];
  const factor = opponentFactor(opp.id);
  const last5 = rows.slice(0, 5);
  const out = [];
  for (const [key, l] of Object.entries(lines)) {
    const statKey = l.statKey || key;
    const mu = await matchupFor(opp.id, p.pos, key).catch(() => null);
    const est = (0.6 * avg(last5, statKey) + 0.4 * avg(rows, statKey)) * factor;
    // The app's own best line for this prop (YourWay / alternate), from smartlines.js.
    const smart = l.yes ? null : smartPick({ rows, statKey, est, l, mu, injury: p.injury, yourWay });
    if (smart) {
      out.push({
        id: `${g.id}|${p.name}|${PROP_LABEL[key] || key}|${smart.side}|smart`, smart: true,
        player: p.name, playerId: p.id, team: team.abbr, opp: opp.abbr, gameId: g.id, date: g.date.toISOString(),
        stat: PROP_LABEL[key] || key, statKey: key, gradeKey: statKey, league: state.league, yes: false,
        ...smart, est: Math.round(est * 10) / 10, postedLine: l.line, edgeAbs: Math.abs(est - smart.line) / Math.max(smart.line, 5),
        oppDef: opp.def, oppN: opp.n, injury: p.injury || "", on: true,
        matchup: mu && (mu.tough || mu.soft) ? (mu.tough ? "tough matchup" : "soft matchup") : "",
      });
    }
    // A short-priced version of this prop for the Bank builder (bank.js).
    const safe = l.yes ? null : smartPick({ rows, statKey, est, l, mu, injury: p.injury, bank: true });
    if (safe) {
      out.push({
        id: `${g.id}|${p.name}|${PROP_LABEL[key] || key}|${safe.side}|${safe.line}|bank`, smart: true, bank: true,
        player: p.name, playerId: p.id, team: team.abbr, opp: opp.abbr, gameId: g.id, date: g.date.toISOString(),
        stat: PROP_LABEL[key] || key, statKey: key, gradeKey: statKey, league: state.league, yes: false,
        ...safe, est: Math.round(est * 10) / 10, postedLine: l.line,
        oppDef: opp.def, oppN: opp.n, injury: p.injury || "", on: true,
        matchup: mu && (mu.tough || mu.soft) ? (mu.tough ? "tough matchup" : "soft matchup") : "",
      });
    }
    for (const side of ["over", "under"]) {
      const odds = side === "over" ? l.over : l.under;
      const dec = decimal(odds);
      if (!dec || dec < ODDS_RANGE[0] || dec > (l.maxDec || ODDS_RANGE[1])) continue;
      const h = hits(rows, statKey, side, l.line);
      const edge = side === "over" ? est - l.line : l.line - est;
      const edgePct = l.line ? edge / l.line : 0;
      const oppDefPct = opp.def && opp.n ? opp.def / opp.n : 0.5;
      // Matchup nudge: overs like bad defenses, unders like good ones.
      const matchup = (side === "over" ? oppDefPct - 0.5 : 0.5 - oppDefPct) * 0.08;
      let prob = 0.45 * (h.all / h.n) + 0.3 * (h.l5 / h.l5n)
        + 0.25 * (0.5 + Math.max(-0.3, Math.min(0.3, edgePct * 2))) + matchup
        - (p.injury ? 0.05 : 0);
      // Defense vs position: no scoring overs into a tough matchup; small nudges otherwise.
      // Defense vs position for this exact stat: no overs into a tough matchup; small nudges otherwise.
      if (mu?.tough && side === "over") continue;
      if (mu?.tough && side === "under") prob += 0.03;
      if (mu?.soft && side === "over") prob += 0.03;
      if (mu?.soft && side === "under") prob -= 0.03;
      const value = prob - 1 / dec;
      if (prob < 0.55 || value <= 0 || edge <= 0) continue;
      const label = PROP_LABEL[key] || key;
      out.push({
        id: `${g.id}|${p.name}|${label}|${side}`,
        player: p.name, playerId: p.id, team: team.abbr, opp: opp.abbr, gameId: g.id, date: g.date.toISOString(),
        stat: label, statKey: key, gradeKey: statKey, league: state.league, side, line: l.line, odds, dec, yes: !!l.yes,
        est: Math.round(est * 10) / 10, l5: `${h.l5}/${h.l5n}`, season: `${h.all}/${h.n}`,
        l5Rate: h.l5 / h.l5n, prob, value, edgeAbs: Math.abs(edge) / Math.max(l.line, 5), // tiny lines don't count as big edges
        oppDefPct, oppDef: opp.def, oppN: opp.n, totalPct,
        injury: p.injury || "", matchup: mu && (mu.tough || mu.soft) ? (mu.tough ? "tough matchup" : "soft matchup") : "", on: true,
      });
    }
  }
  return out;
}

async function buildCandidates(progress) {
  const games = state.games.filter((g) => g.state === "pre");
  if (!games.length) throw new Error("No upcoming games on this day.");
  const totals = games.map((g) => g.odds?.total || 0).sort((a, b) => a - b);
  const totalPct = (t) => (totals.length > 1 ? totals.indexOf(t) / (totals.length - 1) : 0.5);

  progress(`Finding key players in ${games.length} games…`);
  const perGame = await pool(games, 4, gamePlayers);
  const jobs = [];
  games.forEach((g, i) => (perGame[i] || []).forEach((p) => jobs.push({ g, p })));

  progress("Checking defense vs position for every team…");
  await loadSlateDvp().catch(() => null);

  let done = 0;
  const results = await pool(jobs, 6, async ({ g, p }) => {
    const legs = await scorePlayer(g, p, totalPct(g.odds?.total || 0));
    progress(`Checking players… ${++done}/${jobs.length}`);
    return legs;
  });
  return results.flat().filter(Boolean).sort((a, b) => b.prob + b.value - (a.prob + a.value));
}

function buildParlays(cands) {
  const used = new Set(); // leg ids and player+stat keys already taken by any parlay
  const parlays = THEMES.map((t) => ({ ...t, legs: [] }));
  const decOf = (p) => p.legs.reduce((d, l) => d * l.dec, 1);
  const full = (p) => p.legs.length >= MAX_LEGS || slip.stake * decOf(p) >= TARGET.goal;

  const canAdd = (p, c) => !used.has(c.id) && !used.has(`${c.player}|${c.stat}`)
    && !p.legs.some((l) => l.player === c.player)
    && p.legs.filter((l) => l.gameId === c.gameId).length < MAX_PER_GAME;

  // Round-robin, one leg per parlay per pass, so no theme hogs the best picks.
  let progress = true;
  while (progress) {
    progress = false;
    for (const p of parlays) {
      if (full(p)) continue;
      const themed = cands.filter((c) => p.fit(c) && canAdd(p, c));
      if (p.sort) themed.sort(p.sort);
      const pick = themed[0] || cands.find((c) => canAdd(p, c));
      if (!pick) continue;
      p.legs.push({ ...pick });
      used.add(pick.id);
      used.add(`${pick.player}|${pick.stat}`);
      progress = true;
    }
  }
  return parlays.filter((p) => p.legs.length >= 2);
}

function reason(l) {
  const bits = [`est ${l.est}`, `hit ${l.l5} last 5`];
  if (l.oppDef) bits.push(`vs ${ordinal(l.oppDef)} D`);
  if (l.postedLine != null && l.line !== l.postedLine) bits.push(`FanDuel posted ${l.postedLine}`);
  if (l.priceSource === "estimated") bits.push("YourWay line, price estimated");
  if (l.matchup) bits.push(l.matchup);
  if (l.injury) bits.push(l.injury);
  return bits.join(" · ");
}

function renderParlays(parlays, opts = {}) {
  if (!parlays.length) {
    $("sheet-body").innerHTML = `${opts.header || ""}<p class="status">${opts.empty || "Not enough strong picks on this slate to build parlays. Try another day or league."}</p>`;
    return;
  }
  $("sheet-body").innerHTML = `
    ${opts.header || ""}
    <div class="settings-actions top-actions">
      <button class="btn primary" data-use-parlay="all">Add all ${parlays.length} to slip</button>
      <button class="btn" data-open-slip>Open slip</button>
    </div>
    <p class="note">${opts.intro || "Built from offense vs defense ranks, defense vs position, recent form, season hit rate, the app's estimate vs FanDuel's line, and game totals. No pick appears in more than one parlay."} Payouts are at your ${stakeLabel()} stake.</p>
    ${parlays.map((p, i) => {
      const dec = p.legs.reduce((d, l) => d * l.dec, 1);
      const pay = slip.stake * dec;
      const inRange = pay >= TARGET.low && pay <= TARGET.high;
      return `
      <div class="auto">
        <div class="auto-head"><b>${i + 1}. ${p.name}</b><span class="${inRange ? "in" : "out"}">${american(dec)} · ${money(pay)}</span></div>
        <small class="auto-why">${p.why}</small>
        ${p.legs.map((l) => `
          <div class="auto-leg">
            <div><b>${l.player}</b> ${legText(l)} <span class="muted">${l.team} vs ${l.opp}</span><br>
            <small>${reason(l)}</small></div>
            <span class="leg-odds">${l.odds}</span>
          </div>`).join("")}
        <button class="btn primary" data-use-parlay="${i}">Add to slip</button>
      </div>`;
    }).join("")}
    <p class="note">${opts.outro || "These are picks from a simple model, not guarantees. Same-game legs get repriced by FanDuel."}</p>`;
  sheet.autoParlays = parlays;
}

const AUTO_MODES = {
  basketball: [
    ["smart", "Best lines pool"], ["mixed", "Mixed: 5 themed parlays"], ["threes", "3-pointers made"], ["totalRebounds", "Rebounds"],
    ["assists", "Assists"], ["points", "Points"], ["pra", "Pts + Reb + Ast"],
  ],
  football: [
    ["smart", "Best lines pool"], ["mixed", "Mixed: 5 themed parlays"], ["anytimeTd", "Anytime TD"], ["passingYards", "Passing yards"],
    ["rushingYards", "Rushing yards"], ["receivingYards", "Receiving yards"], ["receptions", "Receptions"],
  ],
};

// 5 parlays from one prop type, best picks spread snake-style so #1 isn't the only good one.
function buildStatParlays(cands, statKey, label) {
  const pool = cands.filter((c) => c.statKey === statKey);
  const parlays = [1, 2, 3, 4, 5].map((n) => ({ name: `${label} #${n}`, why: "", legs: [] }));
  const used = new Set();
  const full = (p) => p.legs.length >= MAX_LEGS || slip.stake * p.legs.reduce((d, l) => d * l.dec, 1) >= TARGET.goal;
  const canAdd = (p, c) => !used.has(c.id) && !used.has(`${c.player}|${c.stat}`)
    && !p.legs.some((l) => l.player === c.player)
    && p.legs.filter((l) => l.gameId === c.gameId).length < MAX_PER_GAME;
  let round = 0;
  let progress = true;
  while (progress) {
    progress = false;
    const order = round++ % 2 ? [...parlays].reverse() : parlays;
    for (const p of order) {
      if (full(p)) continue;
      const pick = pool.find((c) => canAdd(p, c));
      if (!pick) continue;
      p.legs.push({ ...pick });
      used.add(pick.id);
      used.add(`${pick.player}|${pick.stat}`);
      progress = true;
    }
  }
  const out = parlays.filter((p) => p.legs.length >= 2);
  out.forEach((p) => {
    const overs = p.legs.filter((l) => l.side === "over").length;
    p.why = `${overs} over${overs === 1 ? "" : "s"}, ${p.legs.length - overs} under${p.legs.length - overs === 1 ? "" : "s"}, picked on hit rate, estimate vs line and how the opponent defends this stat`;
  });
  return out;
}

function renderAuto() {
  const c = sheet.autoCache;
  const modes = AUTO_MODES[sportOf(state.league)];
  const mode = modes.some(([k]) => k === sheet.autoMode) ? sheet.autoMode : "smart";
  const label = modes.find(([k]) => k === mode)[1];
  const all = withoutSaved(c.cands);
  const header = `<label class="mode"><span>Build</span><select id="auto-mode">${modes
    .map(([k, l]) => `<option value="${k}" ${k === mode ? "selected" : ""}>${l}</option>`).join("")}</select></label>${skippedNote(all)}`;
  sheet.smart = null;
  if (mode === "smart") return renderSmart(header, all);
  const cands = postedOnly(all);
  const parlays = mode === "mixed" ? buildParlays(cands) : buildStatParlays(cands, mode, label);
  renderParlays(parlays, {
    header,
    intro: mode === "mixed" ? undefined
      : `Only ${label.toLowerCase()} props. Each pick is checked against how tonight's opponent defends that stat at the player's position, plus recent form, season hit rate and the estimate vs FanDuel's line. No pick appears in more than one parlay.`,
    empty: `Not enough strong ${mode === "mixed" ? "" : `${label.toLowerCase()} `}picks on this slate. Try another prop type, day or league.`,
  });
}

// Picks already in a saved slip (same game, player and stat, either side) are left out of
// every auto build, so new parlays never double up on what you've already bet.
const savedKey = (l) => `${l.gameId}|${l.player}|${l.gradeKey}`;
function withoutSaved(cands) {
  const taken = new Set(slip.saved.flatMap((s) => s.legs.map(savedKey)));
  const kept = cands.filter((c) => !taken.has(savedKey(c)));
  kept.skipped = cands.length ? new Set(cands.filter((c) => taken.has(savedKey(c))).map(savedKey)).size : 0;
  return kept;
}

// Legs on FanDuel's posted lines only (the "Best lines" pool has its own picks).
const postedOnly = (cands) => cands.filter((c) => !c.smart);

function skippedNote(cands) {
  return cands.skipped ? `<p class="note">Left out ${cands.skipped} pick${cands.skipped === 1 ? "" : "s"} already in your saved slips.</p>` : "";
}

// Score the slate once per league and day (10 min); auto parlays and hottest picks share it.
async function slateCandidates(progress) {
  const key = `${state.league}.${ymd(state.date)}`;
  if (sheet.autoCache?.key !== key || Date.now() - sheet.autoCache.at > 10 * 60 * 1000) {
    sheet.autoCache = { key, at: Date.now(), cands: await buildCandidates(progress) };
  }
  return sheet.autoCache.cands;
}

async function openAutoParlays() {
  sheet.game = null;
  $("sheet-back").hidden = true;
  $("sheet-title").textContent = `Auto parlays · ${LEAGUES[state.league].label}`;
  openSheet();
  if (!loadPref("sgoKey", "")) {
    $("sheet-body").innerHTML = `<p class="status">Add your SportsGameOdds key in ⚙︎ Settings first. Auto parlays need FanDuel's lines.</p>`;
    return;
  }
  const status = (msg) => { $("sheet-body").innerHTML = `<p class="status">${msg}</p>`; };
  try {
    await slateCandidates(status);
    renderAuto();
  } catch (err) {
    status(`Couldn't build parlays (${err.message}).`);
  }
}

$("auto").addEventListener("click", openAutoParlays);

$("sheet-body").addEventListener("change", (e) => {
  if (e.target.id !== "auto-mode") return;
  sheet.autoMode = e.target.value;
  renderAuto();
});

$("sheet-body").addEventListener("click", (e) => {
  if (e.target.closest("[data-open-slip]")) return openSlip();
  const b = e.target.closest("[data-use-parlay]");
  if (!b || !sheet.autoParlays) return;
  const which = b.dataset.useParlay;
  const chosen = which === "all" ? sheet.autoParlays : [sheet.autoParlays[+which]];
  // Add to whatever is already in the slip; every leg starts checked so you can uncheck the ones you don't want.
  for (const p of chosen) {
    for (const l of p.legs) {
      if (slip.legs.some((x) => x.id === l.id)) continue;
      const { id, player, playerId, team, opp, gameId, date, stat, gradeKey, league, side, line, odds, est, l5, season, yes } = l;
      slip.legs.push({ id, player, playerId, team, opp, gameId, date, stat, gradeKey, league, side, line, odds, est, l5, season, yes, group: p.name, on: true });
    }
  }
  persist();
  const buttons = which === "all" ? $("sheet-body").querySelectorAll("[data-use-parlay]") : [b];
  buttons.forEach((x) => { x.textContent = "Added ✓"; x.classList.remove("primary"); });
});
