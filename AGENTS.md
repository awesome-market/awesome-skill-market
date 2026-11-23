# awesome-skill-market — agent notes

## What this repo is

A pipeline that merges several agent design skills into one arbitrated anti-AI-slop skill (`skill/`). LLM work happens ONLY in the local daemon against an OpenAI-compatible endpoint (`OMLX_BASE_URL`); CI must stay deterministic — never call the model from `.github/workflows`.

## Invariants

- `decisions/` is hand-authored (or `npm run decide`); everything else under `extracted/`, `merged/`, `conflicts/`, `evidence/`, `skill/` is generated. Don't hand-edit generated files — change inputs and rebuild.
- `skill/` must always equal `node pipeline/build.js` output — CI enforces via `--check`.
- Pending conflicts keep both sides OUT of `merged/rules.yml` (matched by rule `hash`, not id — ids churn on re-extract).
- New conflicts are deduped by `fingerprint` (sorted normalized side-texts); don't reopen decided conflicts unless upstream text actually changed.
- Extraction rewrites rules in new words (license hygiene); keep `sources` provenance on every merged rule.
- Every active decision needs `reason`; overturns record `supersedes`.

## Verify

`npm test` + `node pipeline/validate.js` + `node pipeline/build.js --check` — all three must pass before commit.

## Conventions

Plain Node 22 ESM, no build step. YAML via `yaml` package. GitHub ops via `gh` CLI. Playwright only in `pipeline/evidence.js`.
