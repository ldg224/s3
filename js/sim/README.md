# Match engine

`hcl_sim/` is the HCL match engine (physics-based; possession only changes by physical contact).
It runs in the browser through `js/sim-worker.js` (Pyodide) and is used by edit mode's "Simulate"
via `js/simulate.js`, which builds the engine's league input from `data/season.json` (`toLeague`).
Public pages never load it.

It used to live in its own repo, https://github.com/ldg224/S3_Simulator (archived 2026-09-30 at
commit 1384ba2). This folder is now the only copy.

## Files

- `hcl_sim/*.py`: the engine. `js/sim-worker.js` loads the files in its `ENGINE_FILES` list;
  add any new module that the engine imports there. `__main__.py`, `calibrate.py` and
  `season.py` are command-line only and are not loaded in the browser.
- `hcl_sim/season.py`: the command line's version of `toLeague`: reads `data/season.json` and the
  managers' files in `data/teams/`. Keep the two in step.
- `tests/test_engine.py`: engine tests, including the no-teleport invariant.
- `docs/`: `DESIGN.md` (how the engine works), `OUTPUT_FORMAT.md` (match file format, used by
  the replay and highlights), `CALIBRATION.md` (latest calibration results).

## Command line (Python 3.11, stdlib only), run from this folder

```
python -m unittest discover -s tests          # after any engine change
python -m hcl_sim calibrate --matches 44      # then update docs/CALIBRATION.md
python -m hcl_sim teams                       # teams and squad sizes
python -m hcl_sim simulate TUR SKS            # one match (codes or full names; --seed N)
python -m hcl_sim week 2                      # every fixture in week 2 -> matches/<fixture id>.json.gz
python -m hcl_sim validate FILE ...           # check match files
```

Output goes to `matches/` here (git-ignored). Teams with fewer than 7 players are skipped.
The site's own match files are made in edit mode, not here.
