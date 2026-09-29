# Heineken C League: Season 3

The Season 3 website: https://ldg224.github.io/s3/

Plain HTML, CSS and JavaScript, no build step, hosted on GitHub Pages. League data lives in
this repository (no spreadsheet) and is managed from the site's **edit mode**.

## Pages

| Page | What it shows |
|---|---|
| `index.html` | Live or next match, today's and tomorrow's matches, fixtures by week, leaderboard with movement, full ladder, top scorers |
| `match.html?id=…` | Scoreboard, 2D match replay (live during the broadcast window), timeline, match stats, player of the match, win chance, squads with ratings, lineups, form, next match |
| `awards.html` | Golden Boot, Playmaker, Golden Glove, Player of the Season, Best Offense, Best Defense, season leaders |

## Data

```
data/season.json      teams, rosters, fixtures (week, date, kick-off time) and each result's summary
matches/<id>.json.gz  full match files from the HCL simulator (github.com/ldg224/S3_Simulator)
assets/teams/         team logos: <code>.png and <code>-alt.png (watermark)
```

A fixture's result stays hidden until its kick-off time. From kick-off the match plays out
live on the site over `live_minutes` (the 90 minutes sped up to fit), then shows as full time
with the complete replay. Anyone determined could still find match files in the repository
before kick-off.

## Edit mode

Click **🔒 Edit** in the top-right corner of any page.

**First time on a device:** create a GitHub fine-grained token
(github.com/settings/personal-access-tokens/new) with access to only the `ldg224/s3` repository
and **Contents: Read and write**. Paste it in and choose a PIN. The token is encrypted with the
PIN and stored only in that browser.

**After that:** enter the PIN. You can:

* **Fixtures:** add, edit and delete fixtures; set week, date and kick-off time.
* **Upload match:** drop a simulator match file (.json or .json.gz), pick its fixture and kick-off time.
* **Teams:** names, managers, colours, logos; add teams.
* **Settings:** season number, live broadcast length, points, banner message.

Changes preview on the page straight away and go live when you press **Publish**. That makes
one commit to this repository, and GitHub Pages updates within about a minute.

## Files

```
index.html, match.html, awards.html
css/styles.css   shared visuals and colour tokens (--brand-*)
css/match.css    match centre
css/admin.css    edit mode
js/data.js       loading, match status, ladder, form, win chance, awards, match summaries
js/replay.js     2D replay renderer
js/admin.js      edit mode (PIN, GitHub commits)
js/home.js, js/match.js, js/awards.js, js/ui.js, js/config.js
```

Preview locally with `python -m http.server 8000`.
