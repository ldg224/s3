# Press effect

What managers say in the press room (answers to media questions and their own statements) nudges
four numbers for each team before its next match. The effect is small, capped, and computed by
built-in rules only (no outside service). Status: in progress (Alpha), 2026-09-30.

## The four meters

| Meter | Range | Carries over? | What moves it |
|---|---|---|---|
| **Fans** | -100 … +100 | Yes, drifts back toward 0 by 40% per match | Results; respect for the fans; accountability after defeats; arrogance, excuses, rambling and spam annoy them; answering the media's questions |
| **Team happiness** | -100 … +100 | Yes, drifts back 40% per match | Results; praising players (by name counts double); blaming players publicly; unity vs. division talk; confidence |
| **Team performance** | -4.0% … +4.0% | No, next match only | Mostly happiness, a little fans (home games count fans more), minus pressure from overhyping |
| **Opposition performance** | -3.0% … +3.0% | No, next match only | Mind games aimed at the next opponent: a well-aimed, credible jab can rattle them; empty trash talk fires them up (backfires) |

A team's final performance change for a match = its own **team performance** + the **opposition
performance** effect its opponent's manager put on it, clamped to **±5%**.

In the engine, the change scales the skill attributes (not pace/strength, so physics stays
realistic) of the team's players for that match: composure, decisions, passing, first_touch,
finishing, long_shots, tackling, marking, positioning, work_rate, and the goalkeeping attributes.
+5% on a 65 attribute is +3.25, about 0.65 of a 1-10 rating point on those skills only.

## Which statements count

- **Window:** press items dated after the team's previous match kicked off, up to the moment the
  match is simulated (results are simulated in advance, so later statements can't count). The
  first match of the season uses everything before it.
- **Frozen:** when a match is simulated, the full breakdown is stored in `fixture.result.press`
  (`{home: {...}, away: {...}}`), so deleting or editing statements later changes nothing, and
  the carried-over meters start from that snapshot.
- **Dates are the relay's, not the manager's** (`stampPress` in tools/manager-relay.gs): a new item
  is dated now and records the team's tactics at that moment (`tac`); an edited item keeps its
  original date and tactics and gets `edited` (it counts half, and editing can't move an old answer
  into this week); the team-news message gets `message_date` and doesn't count without one.
  Needs the Apps Script redeployed; until then the browser's dates are trusted.
- **Answers are only answers to real questions:** an item counts as a media answer (weight 1, and
  "fronted up to the media") only if its id is a question the team was really asked (league office
  `admin-…`, or the automatic `res-`/`red-`/`pre-`/`table-w`/`scorer-` ids); anything else is a statement.

## Reading a statement (js/press-effect.js, `readStatement`)

Each item becomes a set of bounded **signals** (each -1 … +1) plus flags:

- **confidence**: "we will win", "we're ready", "no fear" (+) vs. "we're struggling", "no chance" (-).
- **arrogance**: guarantees, scorelines, "easy", "walk over them", "nobody can stop us", all caps, "!!!".
- **humility / respect**: "respect", "tough opponent", "one game at a time", credit to the opponent.
- **accountability**: "my fault", "we weren't good enough", "take responsibility", "we'll learn".
- **excuses**: referee, luck, pitch, weather, "robbed", "unfair", "the schedule".
- **fans**: thanking or addressing the fans, "for the supporters" (+); criticising them (-).
- **praise / blame of players**: own squad names (from the league data) near praise or blame
  words; blame of a named player hurts more than general blame.
- **unity vs division**: "together", "family", "the lads" (+) vs. "some players", "not committed",
  "attitude problem", "transfer list" (-).
- **mind games at the next opponent**: the opponent is named (team name, short name, code,
  manager's name or a player's name). The jab is scored for **hostility** and **specificity**:
  - *credible*: it names something checkable that is actually true (they've conceded late goals,
    they're on a losing run, a key player is suspended, or a tactical claim that fits: "they can't
    handle our pressing" when our pressing is set high). Credible jabs rattle the opponent.
  - *empty*: insults without substance, or claims that the data contradicts. These fire the
    opponent up (bulletin-board material) and cost the speaker fans' respect.
- **sarcasm guard:** "yeah right", "sure...", scare quotes and "/s" flip or damp positive signals.
- **negation:** "not", "never", "no", "n't" within the previous three words flip a cue ("we are not
  scared" is confidence, "not good enough" is accountability).
- **intensifiers / softeners:** "very", "really", "absolutely" (×1.3); "maybe", "a bit" (×0.7).
- **quality gate:** fewer than 6 real words, keyboard mashing, one word repeated, or more than 40%
  non-letters means the item is ignored as noise (and counts as rambling).

Answers to media questions weigh 1.0; the manager's own statements weigh 0.8; the team-news message
weighs 0.5.

## Anti-spam limits

1. **Near-duplicates count once.** Items are compared by word overlap (Jaccard over word stems,
   and over the set of detected cues); ≥ 0.55 similar means the same statement. Each repeat adds
   *spam* instead (fans -).
2. **Diminishing returns.** Within a window, items are ranked by strength and weighted
   1, 0.6, 0.36, 0.22 … Only the top 6 count at all.
3. **Per-signal saturation.** Each signal's weighted sum goes through tanh, so no single kind
   of statement can exceed its share.
4. **Mind-games budget.** Only the strongest two *different* jabs at the opponent count (the same
   claim said two ways is one jab); a jab is halved if the opponent's manager answered calmly in
   the same window (a real answer, or one that's respectful to us), and reduced by the opponent's
   own happiness. A jab that never names the opponent ("they…") counts 60%.
   Credibility: facts from the results (losing run, late goals, a suspension) are fully credible;
   claims that rest on our own tactics ("they can't handle our press" with pressing set high) are
   half as credible, checked against the tactics saved when it was said. Only the strongest claim
   in a statement counts.
5. **Hard caps** on every meter (table above), and ±5% on the final performance change.
6. **Volume penalty.** More than 8 items in a window → fans −(n−8)×3, up to −20. Repeats cost
   fans 4 each, up to −25. Only the newest 60 items are read.
7. **Kitchen-sink cap.** One statement's signals add up to at most 2.5.
8. **Text tricks.** Text is NFKC-normalised, invisible characters are removed, and Cyrillic/Greek
   lookalike letters are read as Latin, so they can't dodge the cues or the duplicate check.

## Testing and tuning

`tools/press-effect-test.html` (serve the repo root with `python -m http.server`):
- no hash: the tuning corpus `tools/press-effect-cases.js` (162 statements + 8 spam groups);
- `#holdout`: `tools/press-effect-holdout.js`, written separately to measure how well the rules
  generalise (first run, untuned: 71/110; after general fixes: 104/110);
- `#scenarios`: whole-team runs on the real league, including one jab repeated 8,000 times;
- `#text=…`: one statement with every reason, for debugging.
Keep the corpus passing when changing the rules.

## Where it runs

- `js/press-effect.js`: pure functions, no DOM. `pressEffect(season, teamFiles, fixture)`
  gives `{home, away}`, each `{fans, happiness, perf, oppPerf, final, items: [...why]}`.
- `js/simulate.js`: computes it and passes `tactics[code].form = final` to the engine, then stores
  the breakdown on the result.
- Engine `teams.py`: `form` (a fraction) scales the skill attributes listed above. No `form`, or 0,
  means identical matches to before for the same seed.
- The Python command line doesn't read press items, so it simulates with no press effect.
- Shown with colours (green up, red down) in edit mode (full breakdown per fixture), the press
  room and Manager Hub (the four meters), and the match page (both teams' meters for that match).
