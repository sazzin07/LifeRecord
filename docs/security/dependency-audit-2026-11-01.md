# Dependency audit, 2026-11-01 (roadmap S-05)

Tools: `pip-audit` (run with `uvx`, so the project environment was not touched) and `yarn audit --groups dependencies`.
Previous audits: 2026-10-13 (backend clean; frontend 0 critical / 46 high / 28 moderate, all build tooling).

## Backend (Python)

| Scope | Result |
|---|---|
| `requirements.txt` resolved fresh | **No known vulnerabilities** |
| The installed virtual environment (`pip-audit --path backend/.venv/Lib/site-packages`) | 42 advisories **before**, **none after** |

The installed environment carried leftovers that `requirements.txt` never asked for. What was done, all in the
virtual environment (nothing in the project's files changed except the audit record):

| Package | Finding | Action |
|---|---|---|
| `pymongo` 4.6.3, `motor` | 5 advisories; remnants of the project's earlier MongoDB stack, imported nowhere | uninstalled |
| `python-jose` 3.5.0, `ecdsa` 0.19.2 | 3 advisories with **no fixed version**; imported nowhere (JWTs use `PyJWT`) | uninstalled |
| `filelock` 4.1.1 | 17 advisories; required by nothing | uninstalled |
| `certifi`, `dnspython`, `pyasn1`, `setuptools`, `black` | patched versions exist | upgraded (`certifi` 2026.10.23, `dnspython` 2.9.1, `pyasn1` 0.6.5, `setuptools` 84.2.1, `black` 26.10.1) |

`pip check`: no broken requirements. Full backend suite after the change: 632 passed (then 651 with the later tests).
New in this audit window and checked: `aiosmtplib`, `cryptography` (both clean).

## Frontend (JavaScript)

Before: 95 advisory paths (44 high). After: **71 (28 high), all of them inside the CRA build toolchain
(`react-scripts`), none in code that ships to the browser.**

Fixed, because they are in the shipped bundle:

| Package | Change | Why |
|---|---|---|
| `axios` | 1.18.0 → 1.21.0 | 15 advisories (9 high); patched from 1.20.0 |
| `react-router` / `react-router-dom` | 7.15 → 7.18.5 (the `resolutions` pin for `react-router` was holding the vulnerable 7.15.1) | 5 advisories (2 high) |
| `follow-redirects` | 1.16.0 → 1.16.2 (`resolutions` pin updated) | 3 high, reached through axios |
| `zod`, `@hookform/resolvers` | **removed**: imported nowhere in `src/` | `zod` had a high advisory; one less dependency to patch |

Newly added since the last audit and checked: `@zxing/browser`, `@zxing/library`, `@axe-core/playwright` (clean).

Accepted, with reasons (build-time only; they run on the developer's machine while building or serving the dev server,
never in the user's browser):

| Package (severity) | Reached through | Reason accepted |
|---|---|---|
| `js-yaml` (high ×4) | ESLint / PostCSS config loading | parses only the project's own config files |
| `svgo` (high ×2, moderate) | CSS/asset minimiser | processes only the project's own assets at build |
| `body-parser` (high) | `webpack-dev-server` | dev server only; not part of the production build or the backend |
| `launch-editor` (high, moderate ×2) | dev-server "open in editor" overlay | dev server only |
| `fast-uri`, `qs`, `minimatch`, `postcss-selector-parser`, `serialize-javascript`, `deepmerge` (moderate/low) | build tooling | same; several are already pinned in `resolutions` to the newest compatible version |

The build tool itself is the root cause: Create React App 5 is no longer maintained, so these will keep appearing. The
real fix is moving off it (for example to Vite), which is a rewrite of the build, not a dependency bump, and is out of
scope for this roadmap (decision recorded in `IMPLEMENTATION_PLAN.md`, task T5.2). Until then: run
`yarn audit --groups dependencies` before each release and re-check that nothing new appears **outside** `react-scripts`.

Verification after the frontend changes: unit tests 22 passed; `CI=true yarn build` compiled with no warnings; the full
browser suite (107 non-live tests) ran afterwards: 106 passed and 1 failed on a timing race inside the spec itself (not the
app), which was then made deterministic and re-run twice without a failure.
