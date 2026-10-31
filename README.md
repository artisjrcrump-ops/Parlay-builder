# Parlay Builder

A phone-first web app for building player-prop parlays.

## What works now
- Daily board for NBA, men's college basketball, NFL and college football
- Scores, start times, spread / total / moneyline
- Each team's offense and defense rank (points scored and allowed per game)
- Sort by start time, weakest defense in the game, or highest total
- Tap a game for rosters (leaders starred, injuries flagged); tap a player for the last 5 games, season average and an estimate for this game
- FanDuel prop lines next to the estimate, once you add a free SportsGameOdds key in ⚙︎ Settings (stored only on your device)

- Slip builder: tap Over/Under on a player to add a leg, tap legs on and off, set your stake, and see the payout against a $800–$1,500 target (with a same-game warning)
- 📋 My slips: saved slips with editable lines, odds, stake and book (FanDuel/DraftKings), results graded automatically from ESPN box scores after games end (or set by hand), and a running record with profit and leg hit rate
- 🎯 Same-game parlays: pick a game (or tap the button inside a game) for 5 SGPs, each following one game script (shootout, favorite rolls, underdog hangs around, grind it out, best value), with no shared picks
- Defense vs position, per stat: basketball compares points, rebounds, assists and 3s allowed to guards/forwards/centers; football compares passing yards allowed (QB/WR/TE) and rushing yards allowed (RB) and offensive TDs allowed. Warns at 15%+ below the slate average over the last 5 games
- Football props: passing/rushing/receiving yards, pass TDs, completions, attempts, interceptions, receptions, longest reception, rush+rec yards, Anytime TD and 2+ TDs
- Basketball props: points, rebounds, assists, 3s, PRA, steals, blocks, P+R, P+A, R+A, double-double
- 🌐 All sports: ⚡ Auto parlays, 🔥 Top 10 ("All sports") and 🏦 Bank builder mix NBA, NCAAB, NFL and NCAAF for the day on the board; tap the sport chips to turn sports on or off. Same-game parlays stay one game.
- 💥 Blowout bench overs (⚡ Auto parlays dropdown): games with a big spread (NBA 10+, NCAAB 14+, NFL 10+, NCAAF 17+) add both teams' bench players to the pool; parlays of their overs, since backups play more when starters sit. Starters' overs in those games get a small minutes-risk penalty.
- 🏦 Bank builder: a ladder of 2-pick parlays (default $50 → $1,000 in 8 bets, about 1.45x back each, stake included). Each rung suggests 3 two-pick options from different games at short prices, ranked by the chance both hit; tap Won to roll the return into the next bet, Lost to restart.
- 🔥 Hottest 10: the day's 10 best single props for the sport you pick in the dropdown, one per player, tap to add.
- 🎯 Best lines pool (in ⚡ Auto parlays): for each player the app picks the line it thinks is most worth playing from the lines FanDuel actually offers (main or alternate), so every leg works in a multi-game parlay. Same-game parlays can also use YourWay custom lines, with estimated prices. Pool of up to 15 legs; uncheck the ones you don't want and the payout and whole-ticket hit chance update. Moonshot presets to about $1,000 back, Survivor to the 4 likeliest legs.
- ⚡ Auto parlays (and 🎯 SGPs, 🔥 Hottest 10) skip any pick already in a saved slip. Pick from a dropdown: mixed (5 themed parlays) or a single prop type (basketball: 3s, rebounds, assists, points, PRA; football: Anytime TD, passing, rushing, receiving yards, receptions). Mixed = 5 themed parlays (weak defense overs, hot hands, shootout games, soft matchup overs, best value) built from the day's FanDuel props, with no pick shared between them, sized toward your payout target

## Data
- [ESPN public JSON feeds](https://gist.github.com/akeaswaran/b48b02f1c94f873c6655e7129910fc3b): unofficial, free, no key. Game lines come from DraftKings.
- [SportsGameOdds](https://sportsgameodds.com/docs) free plan: FanDuel player props. Cached 10 minutes per league per day.

## Running
It's a static site with no build step. Open `index.html` through any web server, or use the GitHub Pages link.
