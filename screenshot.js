// FanDuel screenshot import: Artis screenshots a FanDuel screen (bet slip, a player's props,
// an alt ladder) and the app reads it on the phone (Tesseract OCR, loaded only when used,
// nothing uploaded anywhere) to fill in FanDuel's real prices:
// - each slip leg whose player + line it finds gets FanDuel's price for that leg
// - the parlay's total odds (the big "+7281" on a bet slip) become the slip's real price
// Shares globals from the other scripts (slip, $, decimal, american, money, legText, persist,
// renderSlip, savePref, loadPref).

const OCR_LIB = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
let ocrLoading = null;

function loadOcr() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  ocrLoading ||= new Promise((ok, fail) => {
    const s = document.createElement("script");
    s.src = OCR_LIB;
    s.onload = () => ok(window.Tesseract);
    s.onerror = () => { ocrLoading = null; fail(new Error("couldn't load the reader")); };
    document.head.appendChild(s);
  });
  return ocrLoading;
}

const ODDS_RE = /(?:^|\s)([+\-−–]\s?\d{3,5})(?=\s|$)/g;
const oddsNum = (s) => parseInt(s.replace(/[−–]/, "-").replace(/\s/g, ""), 10);
const words = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9+. ]/g, " ");

// Find each leg's price in the text. A leg matches when its player's last name is on a line and
// its number (the "2" in "2+ THREES" or the "5.5" in "Over 5.5") is on that line or the next two.
function matchLegs(text) {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const found = [];
  for (const leg of slip.legs) {
    const last = words(leg.player).trim().split(/\s+/).filter((w) => !/^(jr|sr|ii|iii|iv)\.?$/.test(w)).pop();
    if (!last || last.length < 3) continue;
    const num = leg.thr ? `${leg.thr}+` : String(leg.line);
    for (let i = 0; i < lines.length; i++) {
      if (!words(lines[i]).includes(last)) continue;
      const near = lines.slice(i, i + 3).join(" ");
      if (!(leg.yes ? /touchdown|td|double/i.test(near) : near.replace(/\s/g, "").includes(num.replace(/\s/g, "")))) continue;
      const odds = [...near.matchAll(ODDS_RE)].map((m) => oddsNum(m[1])).find((o) => Math.abs(o) >= 100 && Math.abs(o) < 5000);
      if (odds) { found.push({ leg, odds }); break; }
    }
  }
  return found;
}

// The parlay's own price: the biggest plus number next to "Parlay"/"Boost", or the biggest
// plus number on the screen if it's clearly a parlay price (+1000 or more).
function parlayOdds(text) {
  const all = [...text.matchAll(ODDS_RE)].map((m) => oddsNum(m[1])).filter((o) => o >= 1000);
  return all.length ? Math.max(...all) : null;
}

async function importScreenshot(file, status) {
  status("Loading the reader (first time takes a few seconds)…");
  const T = await loadOcr();
  status("Reading your screenshot…");
  const { data } = await T.recognize(file, "eng");
  const text = data?.text || "";
  const matched = matchLegs(text);
  for (const { leg, odds } of matched) {
    leg.odds = odds > 0 ? `+${odds}` : `${odds}`;
    leg.priceSource = "FanDuel (screenshot)";
  }
  const total = parlayOdds(text);
  if (total && slip.legs.length > 1) slip.real = total;
  persist();
  savePref("slipReal", slip.real ? String(slip.real) : "");
  const bits = [];
  if (matched.length) bits.push(`Updated ${matched.length} leg${matched.length === 1 ? "" : "s"} to FanDuel's price`);
  if (total && slip.legs.length > 1) bits.push(`FanDuel's parlay price: +${total}`);
  return bits.length ? `${bits.join(". ")}.` : "Couldn't find your picks in that screenshot. Try one that shows the player names and odds.";
}

// The slip's "FanDuel's real price" box + import button (slip.js puts this under the payout).
function realPriceHtml(m) {
  slip.real ??= parseInt(loadPref("slipReal", ""), 10) || null;
  const real = slip.real ? decimal(slip.real) : null;
  return `<div class="real-price">
      <label>FanDuel's price for this parlay <input id="real-odds" inputmode="numeric" placeholder="+7281" value="${slip.real ? `+${slip.real}` : ""}"></label>
      ${real ? `<div class="slip-pay in">FanDuel pays ${money(slip.stake * real)} <small class="muted">(app's math: ${american(m.dec)})</small></div>` : ""}
      <label class="btn shot-btn">📷 Import FanDuel screenshot<input id="shot-file" type="file" accept="image/*" hidden></label>
      <p id="shot-msg" class="note">Screenshot your FanDuel bet slip or a player's props. The app reads it on your phone and fills in FanDuel's real prices.</p>
    </div>`;
}

document.addEventListener("change", async (e) => {
  if (e.target.id === "real-odds") {
    const v = parseInt(e.target.value.replace(/[^\d-]/g, ""), 10);
    slip.real = Number.isFinite(v) && Math.abs(v) >= 100 ? Math.abs(v) : null;
    savePref("slipReal", slip.real ? String(slip.real) : "");
    renderSlip();
  }
  if (e.target.id === "shot-file" && e.target.files?.[0]) {
    const msg = (t) => { const el = $("shot-msg"); if (el) el.textContent = t; };
    try {
      const done = await importScreenshot(e.target.files[0], msg);
      renderSlip();
      msg(done);
    } catch (err) {
      msg(`Couldn't read it (${err.message}).`);
    }
  }
});
