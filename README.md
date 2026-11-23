# awesome-skill-market

**English** · [中文](https://github.com/awesome-market/awesome-skill-market/blob/main/README.zh-CN.md)

**Deslop AI-generated UI. Manage, merge, audit and secure agent skills.** awesome-skill-market is a **skill manager** and automated **skill merge** pipeline that distills the best agent design skills — taste-skill, Hallmark, Anthropic's frontend-design, Vercel's web-design-guidelines — into a single, continuously-updated `SKILL.md` for Claude Code, Cursor, Codex, OpenCode, Pi, Devin and other coding agents. Instead of installing 2–10 overlapping skills whose rules fight each other, you install one arbitrated skill where every conflict has been detected, screenshotted, and decided. On top of the merger it adds a local-first **skill audit** layer and **skill security** controls — static injection checks, capability stripping, version pinning — for every skill on your machine. It also ships **`skillmkt`** (`npm i -g awesome-skill-market`) — a local-first CLI and web UI to search, install, audit, version-switch and merge *any* agent skill across Claude Code, Codex, Cursor, OpenCode, Pi and Devin.

[![npm](https://img.shields.io/npm/v/awesome-skill-market.svg)](https://www.npmjs.com/package/awesome-skill-market)
[![npm downloads](https://img.shields.io/npm/dm/awesome-skill-market.svg)](https://www.npmjs.com/package/awesome-skill-market)
[![ci](https://github.com/awesome-market/awesome-skill-market/actions/workflows/ci.yml/badge.svg)](https://github.com/awesome-market/awesome-skill-market/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![conflicts](https://img.shields.io/github/issues-search/awesome-market/awesome-skill-market?query=label%3Aconflict&label=arbitration%20queue)](https://github.com/awesome-market/awesome-skill-market/issues?q=label%3Aconflict)

## Why does AI-generated UI all look the same?

Ask any coding agent for a landing page and you get the same output: purple-to-blue gradients, glassmorphism cards, Inter, emoji-as-icons, eyebrow labels over every heading. This "AI slop" aesthetic happens because every model converges on the mean of its training data. The community fix is **agent skills** — `SKILL.md` files full of design rules that steer the model away from defaults.

The problem: the best skills contradict each other. taste-skill bans gradients entirely; ui-ux-pro-max ships 194 gradient palettes. Hallmark forbids eyebrow labels; other guides rely on them. Install several and the agent picks whichever rule it read last — you get slop with extra steps.

## What awesome-skill-market does differently

> 📐 Full product design (skill manager + merger + audit + market): [`docs/DESIGN.md`](docs/DESIGN.md)

It doesn't add another opinion. It **referees** the existing ones:

| Step | What happens |
|---|---|
| `sync` | Pins upstream skill repos by SHA (`upstream.lock.json`) and watches for changes |
| `extract` | A local LLM normalizes every upstream doc into a flat rule schema (`extracted/*.yml`) — rewritten, never copied |
| `synthesize` | Per-domain LLM consolidation rewrites thousands of rules into canonical sets (chunked ~50, recursive, `SYNTH_POOL` concurrency); deterministic near-dup fold; genuinely contradictory pairs become `conflicts/*.yml` |
| `arbitrate` | An independent arbiter (fresh context) auto-resolves conflicts whose suggestions are sound, dismisses false conflicts, and escalates only true value tradeoffs to humans |
| `evidence` | The model builds minimal A/B HTML fixtures; Playwright screenshots them so humans judge **rendered output, not prose** |
| `issues` | One GitHub issue per remaining conflict — rule table, AI analysis, screenshot evidence, decision instructions |
| `decide` | Human arbitration lands in `decisions/*.yml` — the repo's real asset |
| `build` | Regenerates `skill/` (SKILL.md + per-scope references + rules manifest) and bumps version |

Pending conflicts hold **both** sides out of the merged output — contradictions never silently ship.

## Quickstart — two ways in

### A) Just use the merged skill (most people)

No model, no pipeline, no keys. `skill/` is the finished product — a standard [Agent Skills](https://agentskills.io) package (`SKILL.md` + `references/`), so it drops into any agent that reads skills.

**One command — installs to every agent it detects:**

```bash
npx skills add awesome-market/awesome-skill-market -g        # global; add -a claude-code codex opencode pi to pick targets
```

**Manual install** — the directory name must be `deslop` (it must match the `name:` field in SKILL.md):

```bash
git clone https://github.com/awesome-market/awesome-skill-market
S=awesome-skill-market/skill

cp -r $S ~/.agents/skills/deslop          # Codex · Devin · Pi · OpenCode (all scan this path)
ln -sfn $PWD/$S ~/.claude/skills/deslop   # Claude Code (symlinks fine)
cp -r $S ~/.codex/skills/deslop           # Codex legacy path — enable [features] skills = true in config.toml
cp -r $S ~/.pi/agent/skills/deslop        # Pi user-level (or: pi --skill $S)
cp -r $S ~/.config/devin/skills/deslop    # Devin user-level
cp -r $S ~/.config/opencode/skills/deslop # OpenCode user-level
```

| Agent | Project dir | Global dir | Notes |
|---|---|---|---|
| Claude Code | `.claude/skills/` | `~/.claude/skills/` | follows symlinks; scans one level only |
| Codex | `.agents/skills/` | `~/.agents/skills/` or `~/.codex/skills/` | **skips symlinks** — copy, or use `npx skills add --copy` |
| OpenCode | `.opencode/skills/` | `~/.config/opencode/skills/` | also auto-scans `.claude/skills` and `.agents/skills` |
| Pi | `.pi/skills/` | `~/.pi/agent/skills/` | also `pi --skill <dir>` per-run, `/skill:deslop` to force |
| Devin | `.devin/skills/` | `~/.config/devin/skills/` | also scans `~/.agents/skills`; `devin skills list` to verify |

**Loading model:** the agent only pays ~100 tokens (frontmatter) until a UI task triggers it; then `SKILL.md` (~14k tokens) loads, and the relevant `references/<domain>.md` loads on demand — never the whole corpus.

`git pull` + copy again to update (symlinked installs update for free). The generated skill carries `sources` provenance on every rule.

### B) Run the pipeline yourself (self-host)

```bash
git clone https://github.com/awesome-market/awesome-skill-market && cd awesome-skill-market
npm run setup            # deps + Playwright chromium
cp .env.example .env     # configure below
gh auth login            # needs issue + push access
npm run daemon           # foreground loop: sync→extract→merge→evidence→issues→poll→build→push
```

`.env` knobs:

| Var | What |
|---|---|
| `OMLX_BASE_URL` / `OMLX_API_KEY` / `OMLX_MODEL` | Any OpenAI-compatible chat endpoint — local (omlx, llama.cpp, vLLM, Ollama) or hosted |
| `GITHUB_REPO` | **Your own repo** (`you/awesome-skill-market`) — conflict issues get filed here |
| `GITHUB_BRANCH` | `main` |
| `DAEMON_INTERVAL_MIN` | Cycle interval, default 30 |

Loop variants: `npm run once` (single cycle) · `npm run once -- --no-llm` (skip model steps; still harvests issue votes and rebuilds). Track different upstreams by editing `config/upstreams.json`. Manual stages: `npm run synthesize` (incremental — unchanged domains are skipped via digest; `--domain color` for one) · `node pipeline/arbitrate.js` (auto-resolve pending conflicts) · `SYNTH_POOL=2 npm run synthesize` (lower LLM concurrency).

## How is this different from installing taste-skill / Impeccable / Hallmark directly?

| | Individual skills | awesome-skill-market |
|---|---|---|
| Rule conflicts | Resolved at runtime, silently, per-session | Resolved once, on the record, by a human |
| Rule inventory | Frozen at install | Re-extracted on every upstream commit |
| Conflict visibility | Invisible — you never know rules fought | Every conflict is a public, screenshotted issue |
| Coverage | One author's taste | Union of N upstreams minus arbitrated contradictions |
| Auditability | Read the markdown, guess the effect | Every rule carries `sources` provenance + decision links |

## Architecture

```
upstream repos ─sync→ work/upstream (pinned SHAs)
               ─extract→ extracted/*.yml     (LLM-normalized rules; committed snapshots)
               ─synthesize→ merged/rules.yml (canonical set)
                        conflicts/*.yml      (held out while pending)
                        auto-arbiter         (fresh-context second opinion)
                        evidence/conf-*/     (A/B fixtures + screenshots)
                        GitHub issues        (human arbitration queue)
humans ─decisions/*.yml→ arbitration records (the durable asset)
               ─build→   skill/              (SKILL.md + references/ + manifest)
```

LLM steps run **locally** in a foreground daemon (`npm run daemon`, Ctrl-C to stop). CI on GitHub runs only deterministic checks: unit tests, YAML schema validation, and a build-reproducibility gate (`build --check` diffs regenerated output against the committed `skill/`).

## Arbitrate a conflict

**Fastest path — reply on the issue.** Look at the A/B screenshots, then comment:

| Reply | Effect |
|---|---|
| `a` or `b` | Ship that side (`a - gradients break print` adds a reason) |
| `merge merged rule text` | Ship your merge |
| `custom rule text` | Ship a fully custom rule |

Only owner/member/collaborator comments count. Each daemon cycle polls open `conflict` issues, writes `decisions/conf-NNNN.yml`, confirms in a comment, closes the issue, and rebuilds the skill.

CLI still works for richer entries (`alternatives_rejected`, explicit provenance):

```bash
npm run decide -- conf-0001 --resolution A --reason "gradients break our print stylesheet"
```

Resolutions: `A` | `B` | `merge` | `custom` (latter two need `--custom "merged rule text"`). `--reason` is mandatory — overturning a decision requires new evidence, which prevents arbitration ping-pong. Overturn anytime by deciding again (reopen the issue and reply again, or re-run `decide`); `supersedes` keeps the history.

## FAQ

**Is this an anti-slop skill itself?**
It's the pipeline that produces one. The output (`skill/`) is a self-contained anti-AI-slop design skill; the repo around it is the machinery that keeps it merged, evidenced, and arbitrated.

**Why local LLM + CI instead of GitHub Actions runners?**
The merge calls an OpenAI-compatible endpoint (`OMLX_BASE_URL`, e.g. an omlx/llama.cpp/vLLM server). Hosted CI can't reach `localhost`, so the daemon runs where the model runs; CI stays a pure verification gate.

**Does it work with models other than Ornith?**
Any chat-completions endpoint works — set `OMLX_BASE_URL`/`OMLX_MODEL`/`OMLX_API_KEY`. Reasoning models are supported (`enable_thinking` is toggled per pipeline stage).

**What happens if two upstreams truly contradict?**
Both rules are held out of the merged skill, an issue is filed with A/B screenshots, and a human decision (`decisions/conf-NNNN.yml`) determines which side ships — or a scoped merge of both.

**License?** MIT. Extracted rule text is rewritten (not verbatim) and every merged rule carries upstream `sources` provenance.

**What is skillmkt?**
The npm CLI shipped by this repo (`npm i -g awesome-skill-market`, Node ≥ 22). A local-first manager for agent skills: it searches public skill markets (skills.sh, GitHub, private `.well-known/agent-skills` sources), installs skills into `~/.skillmkt`, audits them for supply-chain risk, projects them into every AI coding agent's skills directory, and merges multiple skills with human arbitration of contradictions. All state lives on your machine; the optional local web UI (`skillmkt serve`) auto-opens in a browser.

**How do I merge conflicting agent skills?**
`skillmkt merge skill-a skill-b --name merged` extracts rules, deduplicates them, and queues genuinely contradictory pairs in `conflicts/`. You arbitrate each pending conflict in the web UI or with `skillmkt resolve` (optionally `--auto` for LLM-assisted verdicts), then `skillmkt build` writes the merged `SKILL.md`. Pending conflicts keep both sides out of the output — contradictions never silently ship.

**Is it safe to install skills from the internet?**
skillmkt runs a deterministic static audit before install: it strips script-like directories (`scripts/`, `bin/`, `hooks/`, executable extensions) by default and flags secrets, outbound-network instructions, permission escalation and PII harvesting. "Clean" means no known indicators were found — not a safety guarantee. Suspicious findings require explicit confirmation; an optional `--llm` audit adds semantic review on your own local model endpoint.

## Links

- Output skill: [`skill/SKILL.md`](skill/SKILL.md)
- Arbitration queue: [issues labeled `conflict`](https://github.com/awesome-market/awesome-skill-market/issues?q=label%3Aconflict)
- Upstreams: [taste-skill](https://github.com/Leonxlnx/taste-skill) · [hallmark](https://github.com/Nutlope/hallmark) · [frontend-design](https://github.com/anthropics/skills) · [web-design-guidelines](https://github.com/vercel-labs/agent-skills)

---

# skillmkt — the CLI

`skillmkt` is the local-first skill manager from this project: install/adopt skills into `~/.skillmkt`, audit them before install, project copies into every agent's skill directory, detect upstream updates, merge skills with an arbitration queue, and review everything in a local web panel.

```bash
npm i -g awesome-skill-market          # Node ≥ 22
skillmkt doctor            # environment check
skillmkt search design     # skills.sh official API
skillmkt install vercel-labs/agent-skills --path web-design-guidelines
skillmkt install ~/.codex/skills/my-local-skill   # adopt an existing dir
skillmkt list              # matrix: managed / external / drifted
skillmkt update && skillmkt outdated            # apt semantics
skillmkt upgrade my-skill
skillmkt merge a b         # extract → dedupe → conflict queue
skillmkt resolve --auto    # LLM arbiter; leftover tradeoffs go to web UI
skillmkt build             # pending conflicts stay OUT of the output
skillmkt serve             # local web panel (skills/conflicts/review/setup)
```

## 中国用户 / China mirrors

```bash
# 1. 装 CLI（npmmirror 最稳）
npm i -g awesome-skill-market --registry=https://registry.npmmirror.com

# 2. GitHub 拉取走镜像前缀（任意 ghproxy 风格反代均可）
export SKILLMKT_FETCH_MIRROR=https://gh-proxy.com
#    （或 config.yml 里写 fetch_mirror: https://gh-proxy.com）

# 3. skills.sh 搜索不可达时：自建反代后指过去
export SKILLMKT_SEARCH_API=https://your-mirror.example.com
#    （SKILLS_API_URL 兼容官方 npx skills 的同名变量）

# 4. 可选：把 clawhub 配为额外 registry（内容池与 skills.sh 不同）
skillmkt registry add --type clawhub --url https://clawhub.ai --name clawhub
skillmkt search design --registry clawhub
```

Fetch fallback order: GitHub tarball (`gh` → codeload → mirror prefix) → jsdelivr per-file. Search fallback: skills.sh official `/api/search` → `SKILLMKT_SEARCH_API`/`SKILLS_API_URL` mirror → `gh search code filename:SKILL.md` → local library only.

## LLM features (optional, local-first)

Semantic diff, LLM audit, auto-arbitration and merge explanations use any OpenAI-compatible endpoint — **never required** for deterministic operation:

```bash
export OMLX_BASE_URL=http://localhost:8001/v1
export OMLX_MODEL=your-model
export OMLX_API_KEY=env:MY_KEY    # env: references only — no keys in config
skillmkt diff my-skill --semantic
skillmkt audit --all --llm
skillmkt resolve --auto            # confident verdicts auto-apply; real tradeoffs stay pending
```
