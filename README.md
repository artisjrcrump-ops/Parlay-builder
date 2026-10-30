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
- Save slips on your device and load them again later
- Defense vs position (basketball): warns when tonight's opponent holds a player's position (G/F/C) 15%+ below the slate average over its last 5 games
- ⚡ Auto parlays: 5 themed parlays (weak defense overs, hot hands, shootout games, lockdown unders, best value) built from the day's FanDuel props, with no pick shared between them, sized toward your payout target

## Coming next
- Results tracking for saved slips

## Data
- [ESPN public JSON feeds](https://gist.github.com/akeaswaran/b48b02f1c94f873c6655e7129910fc3b): unofficial, free, no key. Game lines come from DraftKings.
- [SportsGameOdds](https://sportsgameodds.com/docs) free plan: FanDuel player props. Cached 10 minutes per league per day.

## Running
It's a static site with no build step. Open `index.html` through any web server, or use the GitHub Pages link.
