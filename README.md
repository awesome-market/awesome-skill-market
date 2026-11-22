# skill-fusion

Continuous-merge pipeline that distills several agent **design skills** into one arbitrated skill — resolving rule conflicts through human arbitration instead of letting them fight at runtime.

Upstream skills in v1: `taste-skill`, `hallmark`, `frontend-design` (anthropics/skills), `web-design-guidelines` (vercel-labs/agent-skills).

## The one idea

The durable asset is `decisions/` — human arbitration records. Everything in `skill/` is generated and can be rebuilt at any time.

```
upstream repos ──sync──> work/upstream/ (pinned SHAs in upstream.lock.json)
                 ──extract──> extracted/*.yml   (LLM-normalized rules, committed snapshots)
                 ──merge───> merged/rules.yml   (deduped canonical set)
                            + conflicts/*.yml   (contradictions, held out of merged set)
                            + evidence/conf-*/  (A/B fixtures + screenshots)
                            + GitHub issues     (one per pending conflict)
human ──decisions/*.yml──> arbitration records (the asset)
                 ──build───> skill/             (SKILL.md + references/ + rules-manifest)
```

LLM steps run **locally** (a foreground daemon against a local OpenAI-compatible endpoint). CI on GitHub runs only deterministic checks: schema validation, unit tests, build reproducibility.

## Setup

```bash
npm run setup          # npm install + playwright chromium
cp .env.example .env   # fill OMLX_* and GITHUB_REPO
```

## Run the pipeline

```bash
npm run daemon         # foreground loop; Ctrl-C stops
npm run once           # single cycle
npm run once -- --no-llm   # cycle without LLM calls (sync/build/validate only)
```

Individual stages: `npm run sync|extract|merge|evidence|issues|build`.

## Arbitrate a conflict

The daemon files one GitHub issue per pending conflict, with A/B evidence screenshots for visual disputes. Decide by either:

```bash
npm run decide -- conf-0001 --resolution A --reason "gradients break the print stylesheet"
```

or by editing `decisions/conf-0001.yml` directly (resolution: `A` | `B` | `merge` | `custom`; `merge`/`custom` require `custom:` rule text). `--reason` is mandatory — overturns must cite new evidence, which prevents decision ping-pong. Overturn by deciding again; the file records `supersedes`.

Pending conflicts hold **both** sides out of the merged skill (never silently ship a contradiction).

## Layout

| path | what | authored/generated |
|---|---|---|
| `config/upstreams.json` | upstream repo list + paths | authored |
| `upstream.lock.json` | pinned SHAs | generated (committed) |
| `extracted/` | normalized rules per upstream | generated (committed) |
| `merged/rules.yml` | canonical merged set | generated |
| `conflicts/` | pending/decided conflicts | generated |
| `decisions/` | arbitration records | **authored — the asset** |
| `evidence/` | fixtures + screenshots | generated (committed) |
| `skill/` | final SKILL.md + references | generated (committed, CI-verified) |
| `lint/` | deterministic rule checker | authored (`rules.json`) + `run.mjs` |

## CI

`.github/workflows/ci.yml`: `npm test`, `node pipeline/validate.js` (schema check), `node pipeline/build.js --check` (skill/ must be reproducible).

## License notes

Derived-rule texts are **rewritten during extraction** (not verbatim copies) and each merged rule carries `sources` provenance back to its upstream. MIT.
