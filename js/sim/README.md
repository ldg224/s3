# Match engine

`hcl_sim/` is the HCL match engine (physics-based; possession only changes by physical contact).
It runs in the browser through `js/sim-worker.js` (Pyodide) and is used by edit mode's "Simulate"
via `js/simulate.js`. Public pages never load it.

It used to live in its own repo, https://github.com/ldg224/S3_Simulator (archived 2026-09-30 at
commit 1384ba2). This folder is now the only copy.

## Files

- `hcl_sim/*.py`: the engine. `js/sim-worker.js` loads the files in its `ENGINE_FILES` list;
  add any new engine module there. `__main__.py` and `calibrate.py` are command-line only and
  are not loaded in the browser.
- `tests/test_engine.py`: engine tests, including the no-teleport invariant.
- `docs/`: `DESIGN.md` (how the engine works), `OUTPUT_FORMAT.md` (match file format, used by
  the replay and highlights), `CALIBRATION.md` (latest calibration results).
- `league.json`: where the command line reads teams from. It still points at the old league
  Google Sheet, not `data/season.json`.

## Command line (Python 3.11, stdlib only), run from this folder

```
python -m unittest discover -s tests            # after any engine change
python -m hcl_sim --offline calibrate --matches 44   # then update docs/CALIBRATION.md
python -m hcl_sim simulate TUR SKS              # one match; also: teams, week N, validate FILE, ratings-template
```

`--offline` uses the cached sheet in `.cache/` (git-ignored).
