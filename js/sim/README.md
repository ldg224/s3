# Match engine (copied)

`hcl_sim/` is an unmodified copy of the engine from https://github.com/ldg224/S3_Simulator
(commit 49fe078). It runs in the browser through `js/sim-worker.js` (Pyodide) and is used by
edit mode's "Simulate" via `js/simulate.js`. Public pages never load it.

To update after changing the simulator, copy these files from `S3_Simulator/hcl_sim/` over the
ones here: `__init__ config geometry physics models ratings tactics decisions engine output
validate teams sheet run` (`.py`).
