// Best lines: instead of only scoring FanDuel's posted line, find the line the app thinks
// is most worth playing (a YourWay or alternate line), then build a pool of those legs that
// you trim down, with the payout and the chance the whole ticket hits updating as you go.
// Loaded before autobuild.js, whose scorePlayer() calls smartPick().
// Shares globals from the other scripts (state, sheet, slip, TARGET, $, decimal, american,
// money, legText, reason, persist, openSlip, loadPref, savePref).

const SMART = {
  minProb: 0.6, // model chance a leg hits
  minEdge: 0.05, // model chance minus the chance the price implies
  vig: 1.045, // FanDuel's usual margin, used when a line's price has to be estimated
  poolSize: 15,
  perGame: 3,
  survivorLegs: 4,
};
const SKEWED = new Set(["threes", "steals", "blocks", "interceptions", "passingTouchdowns", "rushingTouchdowns", "receivingTouchdowns"]);

// Standard normal CDF and its inverse (Abramowitz-Stegun / Acklam approximations).
function phi(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

function phiInv(p) {
  p = Math.min(0.999, Math.max(0.001, p));
  const a = [-39.69683, 220.9461, -275.9285, 138.3578, -30.66480, 2.506628];
  const b = [-54.47610, 161.5858, -155.6990, 66.80131, -13.28068];
  const c = [-0.007784894, -0.3223965, -2.400758, -2.549732, 4.374665, 2.938164];
  const d = [0.007784696, 0.3224671, 2.445134, 3.754409];
  const q = Math.min(p, 1 - p);
  let x;
  if (q < 0.02425) {
    const r = Math.sqrt(-2 * Math.log(q));
    x = (((((c[0] * r + c[1]) * r + c[2]) * r + c[3]) * r + c[4]) * r + c[5]) / ((((d[0] * r + d[1]) * r + d[2]) * r + d[3]) * r + 1);
    x = -x;
  } else {
    const r = (q - 0.5) ** 2;
    x = ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * (q - 0.5))
      / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  return p < 0.5 ? -Math.abs(x) : Math.abs(x);
}

const implied = (odds) => { const d = decimal(odds); return d ? 1 / d : null; };

// Chance the stat lands on `side` of `line`: a normal curve around tonight's estimate, blended
// with how often it actually happened in his games (leaning on the real games for lumpy stats).
function sideProb(rows, statKey, est, sd, line, side) {
  const over = 1 - phi((line - est) / sd);
  const seen = rows.filter((r) => (r.stats[statKey] || 0) > line).length / rows.length;
  const w = SKEWED.has(statKey) ? 0.7 : 0.4;
  const pOver = (1 - w) * over + w * seen;
  return side === "over" ? pOver : 1 - pOver;
}

// FanDuel's price for a line it didn't post: shift the book's own curve (centered where its
// posted price says) to the new line, then add the usual margin. Shown as an estimate.
function estimatePrice(l, sd, line, side) {
  const pi = implied(l.over);
  const pu = implied(l.under);
  const bookOver = pi && pu ? pi / (pi + pu) : pi ? pi / SMART.vig : pu ? 1 - pu / SMART.vig : 0.5;
  const center = l.line - sd * phiInv(1 - bookOver);
  const pOver = 1 - phi((line - center) / sd);
  const p = side === "over" ? pOver : 1 - pOver;
  const imp = Math.min(0.95, Math.max(0.05, p * SMART.vig));
  const dec = 1 / imp;
  return dec >= 2 ? `+${Math.round((dec - 1) * 100)}` : `${Math.round(-100 / (dec - 1))}`;
}

// The best line for one prop, or null. Considers FanDuel's posted line, its alternates and
// YourWay-style lines in whole steps toward the estimate's safe side; picks the one with the
// best value (chance x payout) among lines that clear the hit-chance and edge floors.
function smartPick({ rows, statKey, est, l, mu, injury }) {
  if (!Number.isFinite(l.line) || !Number.isFinite(est) || rows.length < 5) return null;
  if (/out|doubtful/i.test(injury || "")) return null;
  const mean = rows.reduce((t, r) => t + (r.stats[statKey] || 0), 0) / rows.length;
  const variance = rows.reduce((t, r) => t + ((r.stats[statKey] || 0) - mean) ** 2, 0) / (rows.length - 1);
  const sd = Math.max(Math.sqrt(variance), 0.15 * est, 0.6);
  let best = null;
  for (const side of ["over", "under"]) {
    if (side === "over" && mu?.tough) continue; // no overs into a tough matchup
    const dir = side === "over" ? -1 : 1; // overs get safer as the line drops
    for (let step = 0; step <= 12; step++) {
      const line = l.line + dir * step;
      if (line < 0.5) break;
      if (Math.abs(line - est) > 2.5 * sd && step > 0) break;
      const posted = step === 0 ? (side === "over" ? l.over : l.under) : null;
      const alt = l.alts?.[line]?.[side];
      const odds = posted || alt || (step > 0 ? estimatePrice(l, sd, line, side) : null);
      const dec = decimal(odds);
      if (!dec || dec < 1.08) continue;
      let prob = sideProb(rows, statKey, est, sd, line, side) - (injury ? 0.05 : 0);
      if (mu?.tough && side === "under") prob += 0.02;
      if (mu?.soft && side === "over") prob += 0.02;
      prob = Math.min(prob, 0.9); // nothing in sports is a lock; stay humble
      const edge = prob - 1 / dec;
      if (prob < SMART.minProb || edge < SMART.minEdge) continue;
      const score = prob * dec;
      // Same value (within 1%) -> take the likelier line.
      if (!best || score > best.score * 1.01 || (score > best.score * 0.99 && prob > best.prob)) {
        const h = hits(rows, statKey, side, line);
        best = {
          side, line, odds, dec, prob, edge, score, value: edge,
          priceSource: posted ? "FanDuel line" : alt ? "FanDuel alt" : "estimated",
          l5: `${h.l5}/${h.l5n}`, season: `${h.all}/${h.n}`, l5Rate: h.l5n ? h.l5 / h.l5n : 0,
        };
      }
    }
  }
  return best;
}

// --- The pool sheet (Auto parlays -> "Best lines" in the dropdown) ---

function smartPool(cands) {
  const perGame = {};
  const players = new Set();
  const pool = [];
  for (const c of [...cands].filter((x) => x.smart).sort((a, b) => b.score - a.score)) {
    if (players.has(c.player) || (perGame[c.gameId] || 0) >= SMART.perGame) continue;
    players.add(c.player);
    perGame[c.gameId] = (perGame[c.gameId] || 0) + 1;
    pool.push(c);
    if (pool.length >= SMART.poolSize) break;
  }
  return pool;
}

// Which legs start checked: Survivor = the likeliest few; Moonshot = add legs until ~$1,000.
function presetSmart(pool, mode) {
  const on = new Set();
  if (mode === "survivor") {
    [...pool].sort((a, b) => b.prob - a.prob).slice(0, SMART.survivorLegs).forEach((c) => on.add(c.id));
  } else {
    let dec = 1;
    for (const c of pool) {
      if (slip.stake * dec >= TARGET.goal) break;
      on.add(c.id);
      dec *= c.dec;
    }
  }
  return on;
}

function smartSummary(pool, on) {
  const legs = pool.filter((c) => on.has(c.id));
  const dec = legs.reduce((d, c) => d * c.dec, 1);
  const hit = legs.reduce((p, c) => p * c.prob, 1);
  const games = new Set(legs.map((c) => c.gameId)).size;
  return { legs, dec, pay: slip.stake * dec, hit, sameGame: legs.length > games, estimated: legs.some((c) => c.priceSource === "estimated") };
}

function renderSmartSummary() {
  const s = sheet.smart;
  const m = smartSummary(s.pool, s.on);
  const oneIn = m.hit > 0 ? Math.max(1, Math.round(1 / m.hit)) : null;
  const box = $("smart-sum");
  if (!box) return;
  box.innerHTML = `
    <div><b>${m.legs.length} legs</b> · ${american(m.dec)} · ${money(slip.stake)} pays <b>${money(m.pay)}</b></div>
    <div class="muted">Whole ticket hits about <b>${m.legs.length ? `${(m.hit * 100).toFixed(m.hit < 0.1 ? 1 : 0)}%` : "–"}</b> of the time${oneIn >= 2 && m.legs.length ? ` (about 1 in ${oneIn} tickets)` : ""}</div>
    ${m.estimated ? `<div class="warn small">Some prices are estimates. Set the line in FanDuel YourWay and type in the real odds after you save the slip.</div>` : ""}
    ${m.sameGame ? `<div class="warn small">Some legs share a game. FanDuel reprices those, so the real payout will be lower.</div>` : ""}`;
  $("sheet-body").querySelectorAll("[data-smart-leg]").forEach((b) => {
    const on = s.on.has(b.dataset.smartLeg);
    b.classList.toggle("on", on);
    b.textContent = on ? "✓" : "";
    b.closest(".smart-leg").classList.toggle("off", !on);
  });
}

function renderSmart(header, cands) {
  const mode = sheet.smartMode || "moonshot";
  const pool = smartPool(cands);
  sheet.smart = { pool, on: presetSmart(pool, mode) };
  sheet.autoParlays = null;
  const priceText = (c) => (c.priceSource === "estimated" ? `~${c.odds}` : c.odds);
  $("sheet-body").innerHTML = `${header}
    ${pool.length ? `
    <div class="seg">
      <button class="btn ${mode === "moonshot" ? "primary" : ""}" data-smart-mode="moonshot">🚀 Moonshot (~${money(TARGET.goal)})</button>
      <button class="btn ${mode === "survivor" ? "primary" : ""}" data-smart-mode="survivor">🛟 Survivor (${SMART.survivorLegs} legs)</button>
    </div>
    <div id="smart-sum" class="slip-sum smart-sum"></div>
    <div class="settings-actions top-actions">
      <button class="btn primary" data-smart-add>Add checked to slip</button>
      <button class="btn" data-open-slip>Open slip</button>
    </div>
    <p class="note">For each player the app picks the line it thinks is most worth playing, which may be lower (or higher) than FanDuel's posted line, so set it in YourWay. Hit % is the app's estimate from his games, tonight's matchup and how the opponent defends that stat. Tap ✓ to drop a leg.</p>
    <div class="auto">
      ${pool.map((c) => `
        <div class="smart-leg">
          <button class="leg-toggle" data-smart-leg="${c.id}" aria-label="Include leg"></button>
          <div class="leg-main">
            <div><b>${c.player}</b> ${legText(c)} <span class="muted">${c.team} vs ${c.opp}</span></div>
            <small>hits ~${Math.round(c.prob * 100)}% · FanDuel posted ${c.postedLine}${c.line !== c.postedLine ? ` → ${c.side === "over" ? "O" : "U"} ${c.line}` : ""} · ${reason(c)}</small>
            <small class="muted">${c.priceSource === "estimated" ? "Price estimated, check YourWay" : c.priceSource}</small>
          </div>
          <span class="leg-odds">${priceText(c)}</span>
        </div>`).join("")}
    </div>
    <p class="note">Model picks, not guarantees. Longer tickets pay more but hit far less often.</p>`
    : `<p class="status">No lines clear the app's bar on this slate yet. Props often post closer to game time.</p>`}`;
  renderSmartSummary();
}

$("sheet-body").addEventListener("click", (e) => {
  const t = e.target.closest("button");
  if (!t || !sheet.smart) return;
  const d = t.dataset;
  if (d.smartLeg) {
    const on = sheet.smart.on;
    on.has(d.smartLeg) ? on.delete(d.smartLeg) : on.add(d.smartLeg);
    renderSmartSummary();
  } else if (d.smartMode) {
    sheet.smartMode = d.smartMode;
    renderAuto();
  } else if (d.smartAdd !== undefined) {
    for (const c of smartSummary(sheet.smart.pool, sheet.smart.on).legs) {
      if (slip.legs.some((x) => x.id === c.id)) continue;
      const { id, player, playerId, team, opp, gameId, date, stat, gradeKey, league, side, line, odds, est, l5, season } = c;
      slip.legs.push({ id, player, playerId, team, opp, gameId, date, stat, gradeKey, league, side, line, odds, est, l5, season, yes: false,
        group: c.priceSource === "estimated" ? "Best lines · check price" : "Best lines", on: true });
    }
    persist();
    t.textContent = "Added ✓";
    t.classList.remove("primary");
  }
});
