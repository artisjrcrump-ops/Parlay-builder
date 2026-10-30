# Parlay Builder

A phone-first web app for building player-prop parlays.

## What works now
- Daily board for NBA, men's college basketball, NFL and college football
- Scores, start times, spread / total / moneyline
- Each team's offense and defense rank (points scored and allowed per game)
- Sort by start time, weakest defense in the game, or highest total
- Tap a game for rosters (leaders starred, injuries flagged); tap a player for the last 5 games, season average and an estimate for this game
- FanDuel prop lines next to the estimate, once you add a free SportsGameOdds key in ⚙︎ Settings (stored only on your device)

## Coming next
- Slip builder with tap-to-add legs and payout math
- Saved slips and results tracking

## Data
- [ESPN public JSON feeds](https://gist.github.com/akeaswaran/b48b02f1c94f873c6655e7129910fc3b): unofficial, free, no key. Game lines come from DraftKings.
- [SportsGameOdds](https://sportsgameodds.com/docs) free plan: FanDuel player props. Cached 10 minutes per league per day.

## Running
It's a static site with no build step. Open `index.html` through any web server, or use the GitHub Pages link.
