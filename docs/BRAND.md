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

The brand colours are the Material Blue ramp and white. Page backgrounds and cards are dark neutrals
(near-black with a slight cool tone), so blue stays special. No green, lime, gold, red, orange or purple for
the league's own UI. **Team colours are the teams' own** and stay as they are (logos, kit colours, team accents).

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
| Page | `#0b0e13` | Page background (`--bg`), not a brand colour |
| Card | `#13171e` | Cards (`--surface`) |
| Raised | `#1a1f28` | Hover rows, inputs, nested panels (`--surface-raised`) |
| Grey text | `#aab4c3` / `#7d8898` | Secondary and faint text (`--muted`, `--faint`) |
| White | `#ffffff` | **The accent**: headings, scores, LIVE, the most important thing on screen |

Rules:
- Background near-black, cards dark grey (`--bg`, `--surface`, `--surface-raised`). Text is white; secondary text cool grey (`--muted`).
- Blue is for brand accents: the crest, primary buttons and active tabs, links, highlights, the W chip. Don't use it for large backgrounds on the site (the hero photo and broadcast graphics are the exceptions).
- White is the accent: use it for what matters most (LIVE, the score, the primary heading). Blue does the rest.
- Buttons: Blue gradient (`#42a5f5` → `#1565c0`) with **white** text. Never dark text on the gradient.
- Match states without red or green: LIVE = white pill with navy text and the pulsing dot; upcoming =
  Blue 400; played = Blue 200; postponed = outlined. Results W/D/L carry the letter (W filled Blue 400,
  D Blue 800, L outlined), so they never rely on colour alone.
- Up/down (press meters, form): up = white ▲, down = Blue 400 ▼, flat = Blue 200 ●. The arrow and sign carry the meaning.

## Type

- Display: **Oswald** 500/700, uppercase for headings, scores and labels.
- Text: **Figtree** 400/500/700 for everything else.
- Google Fonts: `https://fonts.googleapis.com/css2?family=Oswald:wght@500;700&family=Figtree:wght@400;500;600;700;800&display=swap`
