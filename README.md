# Parlay Builder

A phone-first web app for building player-prop parlays.

## What works now
- Daily board for NBA, men's college basketball, NFL and college football
- Scores, start times, spread / total / moneyline
- Each team's offense and defense rank (points scored and allowed per game)
- Sort by start time, weakest defense in the game, or highest total
- Tap a game for rosters (leaders starred, injuries flagged); tap a player for the last 5 games, season average and an estimate for this game
- FanDuel prop lines next to the estimate, once you add a free SportsGameOdds key in ⚙︎ Settings (stored only on your device)

- Slip builder: tap Over/Under on a player to add a leg, tap legs on and off, set your stake, and see the payout against a $400–$2,500 target (with a same-game warning)
- 📋 My slips: saved slips with editable lines, odds, stake and book (FanDuel/DraftKings), results graded automatically from ESPN box scores after games end (or set by hand), and a running record with profit and leg hit rate
- 🎯 Same-game parlays: pick a game (or tap the button inside a game) for 5 SGPs, each following one game script (shootout, favorite rolls, underdog hangs around, grind it out, best value), with no shared picks
- Defense vs position, per stat: basketball compares points, rebounds, assists and 3s allowed to guards/forwards/centers; football compares passing yards allowed (QB/WR/TE) and rushing yards allowed (RB) and offensive TDs allowed. Warns at 15%+ below the slate average over the last 5 games
- Football props: passing/rushing/receiving yards, pass TDs, completions, attempts, interceptions, receptions, longest reception, rush+rec yards, Anytime TD and 2+ TDs
- Basketball props: points, rebounds, assists, 3s, PRA, steals, blocks, P+R, P+A, R+A, double-double
- 🔥 Hottest 10: the day's 10 best single props for the sport you pick in the dropdown, one per player, tap to add.
- ⚡ Auto parlays (and 🎯 SGPs, 🔥 Hottest 10) skip any pick already in a saved slip. pick from a dropdown: mixed (5 themed parlays) or a single prop type (basketball: 3s, rebounds, assists, points, PRA; football: Anytime TD, passing, rushing, receiving yards, receptions). Mixed = 5 themed parlays (weak defense overs, hot hands, shootout games, lockdown unders, best value) built from the day's FanDuel props, with no pick shared between them, sized toward your payout target

## Data
- [ESPN public JSON feeds](https://gist.github.com/akeaswaran/b48b02f1c94f873c6655e7129910fc3b): unofficial, free, no key. Game lines come from DraftKings.
- [SportsGameOdds](https://sportsgameodds.com/docs) free plan: FanDuel player props. Cached 10 minutes per league per day.

## Running
It's a static site with no build step. Open `index.html` through any web server, or use the GitHub Pages link.
