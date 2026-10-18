# Throwaway stress test (NOT part of the demo)

Python scratch code used on 2026-10-18 to sanity-check the design in `../../PROTOTYPE_SPEC.md` before it was handed over.
It produced the findings in spec section 5.3 and the Appendix A fixture ranges.

- `proto.py`: tiny simulator (policies: fixed, quiz, rule, naive, smart, oracle), pantry particle filter, analytic churn calibration.
  Run: `python3 proto.py 300` (N subscribers per source). Env: `PHIS=0,0.4,1.0`, `UNI=1` for uniform phi.
- `fixtures.py`: runs the Maya and Dev fixtures through the particle filter (needs `proto.py` on the path; run with `python3 fixtures.py`).

Rules: this is the builder's reference, not the source of truth. The TypeScript implementation is. Do not tune the TypeScript
parameters to reproduce these numbers; they came from one set of assumptions and a small sample. Needs only numpy.
