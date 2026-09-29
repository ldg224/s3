# Heineken C League: Season 3

Season 3 website. Plain HTML, CSS and JavaScript with no build step, hosted on GitHub Pages.
All league data comes from a Google Sheet, so results are updated by editing the sheet, not the code.

## Folder layout

```
index.html          Home: next match, fixtures by week, ladder
404.html            Shown for missing pages
css/styles.css      All styles. Season colours are the tokens at the top.
js/config.js        Season number, points rules, and the sheet links  <- the file you edit
js/data.js          Loads and parses the sheet, works out match states and the ladder
js/ui.js            Shared helpers (team badges, dates, escaping)
js/home.js          Home page rendering
assets/league/      Season logo, banner, title image
assets/teams/       Team logos: <code>.png and <code>-alt.png, e.g. tur.png, tur-alt.png
```

New pages (match, awards, team) should import `js/data.js` and `js/ui.js`,
not copy them, so a fix only ever has to be made once.

## The Google Sheet

The site runs on the HCL league spreadsheet, in the same format used to run Season 2.
Columns are matched **by header name**, so columns can be reordered, and extra columns
(notes, formulas) can be added without breaking the site. Header names aren't case-sensitive.

| Tab | Columns the site reads | Notes |
|---|---|---|
| **Teams** | TEAM NAME, TEAM CODE, MANAGER NAME, PRIMARY HEX CODE | Code is the 3-letter team code; its logo is `assets/teams/<code>.png`. |
| **Schedule & Results** | WEEK, DATE, TIME, STATUS, HOME, HOME SCORE, AWAY, AWAY SCORE, YOUTUBE LINK, GOAL 1 MIN, GOAL 1 ID, GOAL 2 MIN, … | HOME/AWAY take the full team name or code. DATE as `15/9/2026` or `TBA`. TIME as `12:00 PM` or `14:00`. Add more GOAL columns (GOAL 7 MIN, GOAL 7 ID, …) whenever a match needs them. |
| **Standings** | POSITION, TEAM, PLAYED, WON, DRAW, LOSS, GF, GA, GD, POINTS | Only used when `LADDER` is `'sheet'` in `js/config.js`. |
| **Roster** | PLAYER ID, PLAYER NAME, POSITION, ASSIGNED TEAM, OFFENSE RATING, DEFENSE RATING, WEEKLY COST | Formats like `[FWD] Forward`, `[TUR] FC Turtle`, `(9) Nine` and `$7,800.00` are understood. |

**Entering results:** type the two scores. The match shows as full time and the ladder updates.
STATUS only matters for exceptions: `postponed`, `cancelled`, or `live` (to show a live score
before the final whistle).

**The ladder** is calculated from the scores by default (points, then goal difference, then
goals for). To use the Standings tab instead, for example if points are adjusted by hand,
set `LADDER = 'sheet'` in `js/config.js`.

### Connecting a new season's sheet

1. File > Share > **Publish to web**.
2. Pick a tab, choose **Comma-separated values (.csv)**, click Publish, copy the link.
3. Paste it into `js/config.js` (the `SHEET` link and the tab `gid` numbers in `SOURCES`).
4. Set `notice: ''` in `js/config.js` to remove the preview banner.

Google caches published sheets, so edits can take up to about 5 minutes to appear.
If Google can't be reached, the site shows the last data that browser loaded.

## Preview locally

The site loads data with `fetch`, which browsers block for files opened directly from disk,
so preview it through a local server:

```
python -m http.server 8000
```

Then open http://localhost:8000.

## Publish

```
.\publish.ps1 "What changed"
```

Commits everything, pulls any edits made on github.com, and pushes. GitHub Pages updates in about a minute.

## Starting a new season

Copy this folder, bump `number` and `year` in `js/config.js`, copy the league spreadsheet
(clear the results), publish it and paste its links into `js/config.js`, then swap the logos
and the colour tokens.
