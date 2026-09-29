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
data/*.csv          Sample data and the column template for each sheet tab
assets/league/      Season logo, banner, title image
assets/teams/       Team logos: <code>.png and <code>-alt.png, e.g. tur.png, tur-alt.png
```

New pages (match, awards, team) should import `js/data.js` and `js/ui.js`,
not copy them, so a fix only ever has to be made once.

## The Google Sheet

Make one spreadsheet with four tabs. The easiest way is to import each file in `data/`
(File > Import > Upload > "Insert new sheet"), which creates the tab with the right headers.

Columns are matched **by header name**, so you can reorder columns or add extra ones
(notes, formulas) without breaking the site. Header names aren't case-sensitive.

| Tab | Columns | Notes |
|---|---|---|
| **teams** | Code, Name, Manager, Colour, Logo, Logo Alt | Code is the 3-letter team code. Colour is a hex code like `#0cf6f3`. Logo columns are optional; leave blank to use `assets/teams/<code>.png`. |
| **fixtures** | ID, Week, Date, Time, Home, Home Score, Away, Away Score, Status, Video | Home/Away accept the code or full name. Date as `7/11/2026` (d/m/yyyy) or `TBA`. Time as `12:00 PM` or `14:00`. |
| **players** | ID, Name, Team, Position, Offense, Defense, Weekly Cost | Team is the team code. Position is `GK`, `DEF`, `MID` or `FWD`. Ratings and cost are plain numbers. |
| **events** | Match ID, Minute, Type, Player ID, Assist ID | One row per goal or card. Type is `goal`, `own goal`, `yellow` or `red`. Match ID matches the fixtures ID. No limit on goals per match, and assists are tracked. |

**Entering results:** type the two scores. That's it: the match shows as full time and the
ladder updates. The **Status** column is only for exceptions: `postponed`, `cancelled`, or
`live` (to show a live score before the final whistle).

**The ladder is calculated automatically** from results (points, then goal difference, then
goals for), so there is no standings tab to keep in sync. Points per win/draw/loss are set in
`js/config.js`.

### Connecting the sheet

1. File > Share > **Publish to web**.
2. Pick a tab, choose **Comma-separated values (.csv)**, click Publish, copy the link.
3. Paste it into the matching entry in `SOURCES` in `js/config.js`. Repeat for each tab.
4. Set `sampleData: false` in `js/config.js` to remove the preview banner.

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

Copy this folder, bump `number` and `year` in `js/config.js`, make a new sheet from the `data/`
templates, and swap the logos and the colour tokens.
