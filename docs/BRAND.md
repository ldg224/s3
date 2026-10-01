# vLeague brand (Season 1)

The league was the Heineken C League (HCL). From this season it is **vLeague**, "virtual football";
the season that was HCL Season 3 is **vLeague Season 1**. Don't write "Heineken", "HCL", "C League"
or "Season 3" anywhere a visitor can see it. (The repo and URL stay `s3`.)

## Name

- **vLeague**: lowercase v, capital L, one word. In all-caps display type it's **vLEAGUE** (the v stays lowercase).
- Tagline: **VIRTUAL FOOTBALL**.
- Page titles: `<Page> | vLeague`. Short form in tight spaces: `vLeague`.
- Seasons: "Season 1", "S1". Future seasons add a star to the crest.

## Logo

The crest: a blue shield with a white band and a bold V, three stars above.
Files in `assets/league/`:
- `logo.png`: the crest for dark backgrounds (the site's own logo, favicon, highlights).
- `crest-on-dark.svg`, `crest-on-light.svg`, `crest-navy.svg` (one colour), `crest-white.svg` (reversed).
- `lockup-horizontal-on-dark.png`, `lockup-horizontal-on-light.png`, `app-icon.png`, `avatar.png`.
Never recolour, stretch or outline the crest, or put it on a busy photo without a navy panel.

## Colour

The brand colours are the Material Blue ramp and white. The page is near-black with a navy undertone and cards
are a dark slate; blue is kept for accents (section titles, the active tab, buttons, links, the hero, the
crest). Earlier versions set the limits: bright blue everywhere was too much, flat black too plain, and
blue-washed cards still too much. **Team colours are the teams' own** and stay as they are (logos, kit colours, team accents).

**Blue is the theme, not a rule for everything.** The overall look (page, cards, buttons, links, active tabs,
headings, the crest) stays vLeague blue, navy and white. Anything that carries meaning should use the colour
that reads best, even if it isn't blue: form chips, results, player ratings, live and status markers,
cards and bookings, warnings, charts, highlights. A page with only blue on it is flat and hard to scan. Be smart about it:
- Use a colour where it tells you something (a win, a red card, a poor rating), not just to decorate.
- Keep each meaning the same colour everywhere (one green for a win on every page; use the shared tokens).
- Keep large areas (backgrounds, panels, buttons) in the brand colours; let other colours be small and bold.
- Check it's still readable on the dark background.

| Token | Hex | Use |
|---|---|---|
| Blue 50 | `#e3f2fd` | Lightest tint: text on Blue 700–900 when not pure white, light backgrounds |
| Blue 100 | `#bbdefb` | Success and confirmation text, light chips |
| Blue 200 | `#90caf9` | Played/final states |
| Blue 300 | `#64b5f6` | Links and highlights (`--brand`) |
| Blue 400 | `#42a5f5` | Gradient start, active tab, upcoming |
| Blue 500 | `#2196f3` | Primary fills |
| Blue 600 | `#1e88e5` | Primary buttons, crest body |
| Blue 700 | `#1976d2` | Pressed / borders on light |
| Blue 800 | `#1565c0` | Gradient end, raised panels |
| Blue 900 | `#0d47a1` | Deep panels, headers |
| Navy | `#061a38` | Text on white/light-blue fills (e.g. the LIVE pill), broadcast graphics |
| Page | `#0a0f19` | Page background (`--bg`): near-black with a navy undertone |
| Card | `#111827` | Cards (`--surface`) |
| Raised | `#182133` | Hover rows, inputs, nested panels (`--surface-raised`) |
| Grey text | `#b0bac9` / `#808b9c` | Secondary and faint text (`--muted`, `--faint`) |
| White | `#ffffff` | **The accent**: headings, scores, LIVE, the most important thing on screen |

Rules:
- Background near-black navy, cards dark slate (`--bg`, `--surface`, `--surface-raised`). Text is white; secondary text grey (`--muted`). Section titles (`.card-title`) are Blue 300.
- Blue is for brand accents: the crest, primary buttons and active tabs, links, highlights. Don't use it for large backgrounds on the site (the hero photo and broadcast graphics are the exceptions).
- White is the accent: use it for what matters most (LIVE, the score, the primary heading). Blue does the rest.
- Buttons: Blue gradient (`#42a5f5` → `#1565c0`) with **white** text. Never dark text on the gradient.
- Not everything is blue (see above). Current examples:
  - results/form W/D/L: `--res-w` #22a55b green, `--res-d` #7c8594 grey, `--res-l` #e5484d red, letters kept;
  - player match ratings: green high, amber mid, red low (like FotMob/Sofascore), except **Man of the Match,
    whose rating sits on mid blue #1e88e5 with white text**;
  - yellow and red cards, grass, team colours.
- Match states: LIVE = white pill with navy text and the pulsing dot; upcoming = Blue 400; played = Blue 200;
  postponed = outlined.
- Up/down (press meters, form): up = white ▲, down = Blue 400 ▼, flat = Blue 200 ●. The arrow and sign carry the meaning.

## Type

- Display: **Oswald** 500/700, uppercase for headings, scores and labels.
- Text: **Figtree** 400/500/700 for everything else.
- Google Fonts: `https://fonts.googleapis.com/css2?family=Oswald:wght@500;700&family=Figtree:wght@400;500;600;700;800&display=swap`
