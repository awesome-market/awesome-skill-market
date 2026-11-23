# awesome-skill-market — design

A local-first skill manager, merger, auditor and market for the Agent Skills ecosystem.

One-line pitch: **the missing compatibility & security layer between "install a skill" and "trust your agent".**

## 1. Why this exists

`npx skills add` (skills.sh, 75+ agents) already solved *install*. What nobody solved:

| Gap | Evidence |
|---|---|
| **Skills conflict with each other** | Install taste-skill + ui-ux-pro-max + web-design-guidelines → contradictory rules, agent picks whichever it read last. No tool detects this — it's exactly what the deslop-fusion pipeline was built to find. |
| **Skills are an unreviewed supply chain** | SKILL.md is prompt-level instruction injection: it can read secrets, run bundled scripts, poison reviews. Auto-search/auto-install removes the only human checkpoint. |
| **Version drift is silent** | Upstream edits land via `git pull` copies; nothing pins content, nothing diffs what changed. |
| **Distribution is fragmented** | `.claude/`, `.agents/`, `.codex/`, `.pi/`, `.devin/`, `.opencode/` — six target trees, no single source of truth. |

## 2. Positioning vs existing tools

| Tool | What it does | What it lacks |
|---|---|---|
| skills.sh (`npx skills`) | discovery + install to 75 agents | conflicts, audit, local hub |
| skillctl | install/lint/remove, registries | lint = style score, not semantic audit |
| skills-manager-cli | hub + distribute | no conflict detection, no injection defense |
| swarmskills | CLI + MCP across ~45 agents | management only |
| claude/pi plugins | native distribution | per-harness silo |
| **awesome-skill-market** | **hub + merge + audit + secure distribute** | — |

Differentiator, in order of importance:

1. **Conflict engine** — semantic contradiction detection across a user's *installed* skills (not just upstream merges). The deslop-fusion engine becomes a client-side feature.
2. **Audit layer** — deterministic + optional LLM semantic review at install time, not a registry-side gate.
3. **Security posture** — capability stripping (scripts/ removed, secrets egress filter, no self-granted tools) instead of "detect malice" (unwinnable — see §6).
4. **Arbitration memory** — user decisions recorded locally, exportable back to a fusion pipeline (`decisions/` YAML) — the client is a distributed arbitration network feeding the market.

## 3. Form factor — decided

**Primary: Node 22 ESM CLI + local web dashboard** (`npx asm` → `asm serve` opens `http://localhost:PORT`).

| Option | Verdict | Why |
|---|---|---|
| CLI | ✅ core | every target user has Node 22; scriptable; same runtime as deslop-fusion (direct import of the whole engine) |
| Local web panel | ✅ phase 2 | conflict diffs, install matrix, audit reports need real UI; localhost page costs 1/5 of Tauri |
| TUI | ❌ | worst of both worlds — not scriptable, not accessible |
| MCP server | later | a *distribution surface* for the agent to call the manager mid-session; a feature, not the product |
| Tauri desktop | later | only if non-terminal users materialize; wraps the same Node core as sidecar |

## 4. Architecture

```
            ┌──────────── CLI: scan / audit / conflicts / install / serve ────────────┐
            │                         Node 22 ESM, no native deps                      │
            │                                                                        │
 discover ──┤  scanner     → walk skill roots of every detected harness               │
            │  hub         → ~/.awesome-skill-market/skills/ (single source of truth) │
 audit ─────┤  static      → scripts/, secret patterns, egress instructions, perms    │
            │  llm-audit   → optional: user's own OpenAI-compat endpoint              │
 conflicts ─┤  engine      → jaccard + fingerprint + LLM judge (from deslop-fusion)   │
            │  arbitrate   → fresh-context independent verdict (reuse arbitrate.js)   │
            │  decisions   → ~/.awesome-skill-market/decisions/*.yml                  │
 version ───┤  lock        → content-hash pin per skill per target; drift detection   │
            │  changelog   → git-diff of upstream skill content between pins          │
 distribute ┤  targets     → symlink|copy per harness (codex = copy only)             │
            │  adapters    → claude-code, codex, opencode, pi, devin, dsh(=pi)        │
            └────────────────────────────────────────────────────────────────────────┘
                                   ↑
                    local web UI ──┘ (asm serve; React SPA + tiny node api)
```

All LLM work is optional and BYO-endpoint (`.env`: `OMLX_BASE_URL`/`OMLX_API_KEY`/`OMLX_MODEL`). Without a model the entire deterministic layer still works — audit degrades to static-only, conflicts degrade to near-dup warnings.

## 5. Data layout

```
~/.awesome-skill-market/
├── skills/                    # canonical copies (the hub)
│   └── deslop/
│       ├── SKILL.md
│       └── references/
├── library.yml                # inventory: name, source, version pin, targets, audit status
├── lock.yml                   # content hashes per skill per target (drift + integrity)
├── scans/<skill>.yml          # audit results: static findings, llm verdict, model id, date
├── decisions/<pair-id>.yml    # arbitration records — deslop-fusion schema, exportable
├── quarantine/                # rejected/suspicious skills held out of distribution
└── config.yml                 # endpoints, adapters, policy (strict|balanced|permissive)
```

Principle: the hub is the only writable copy; harness dirs are projections. `asm sync` regenerates every target from hub + lock.

## 6. Security model — containment over detection

Deterministic gate, installed-by-default, no model required:

| Control | Mechanism | Why it can't be talked around |
|---|---|---|
| scripts/ strip | executable dirs/files never written to targets | channel doesn't exist, not "detected" |
| secret egress filter | byte-pattern scan on outgoing agent context (`sk-`, `PRIVATE KEY`, `~/.ssh/`, `.env` paths) | pattern matcher, not a model |
| network allowlist | documented hardening profile for devcontainer/profile isolation | kernel-level, not prompt-level |
| no self-grant | skill cannot expand tool permissions — that config lives outside skills/ | permissions are host config |
| pin + re-gate | content-hash change = back through audit before redistributing | upstream hijack can't slip into a pinned install |
| provenance floor | below N installs / unknown publisher → `quarantine` tier requiring explicit opt-in | social cost for attacker |

**LLM audit layer** (optional, user's own model): semantic review of SKILL.md+references — injected content wrapped as data, structured `{verdict, findings[]}` output only. Blocking decisions made by code on the verdict field, never by model freeform.

**Known residual risk** (documented honestly): a subtle "polite" instruction can still bias a single session's output. Open-tier skills are for sandboxed profiles; curated tier for anything with real secrets. AI review is a probabilistic filter *on top of* containment, never a substitute.

## 7. Conflict & merge engine

Imported from deslop-fusion (`pipeline/lib`, `synthesize.js`, `arbitrate.js`):

1. **Scan** all installed skills → flat rule-ish statements (LLM extraction optional; static section split as fallback).
2. **Near-dup fold** — deterministic jaccard≥0.9 union-find (already built: `dedupeMerged`).
3. **Domain synthesis** — per-domain consolidation or, cheaper default for the client: pairwise candidate filter (token jaccard≥0.15, scope boost) → LLM judge on real candidates only.
4. **Arbitrate** — fresh-context independent verdict: `dismiss` (false conflict), `approve` (with merged text), `human` (true tradeoff → CLI/web queue).
5. **Decisions** — `decisions/*.yml`, schema identical to deslop-fusion so a client arbitration can be PR'd upstream or into a team-shared decisions repo.

Result delivered to user: a **personal merged skill** (`merged/` → `asm build`) = union of their installed skills minus conflicts, or per-skill conflict report without merging (`--report` mode).

## 8. Version management

- `lock.yml` = `{skill, source, ref, content_hash, installed_at, targets[]}`
- `asm update --check` → fetch upstream HEAD, hash skill subtree, compare → update available / local-modified / clean (tree-SHA granularity, not repo SHA — upstream noise outside the skill dir doesn't flag)
- Update flow: fetch → diff summary → **re-audit** (new content is new attack surface) → redistribute
- `asm rollback <skill>` → restore previous hub copy (kept one version deep)

## 9. Install & distribution matrix

| Target | Path | Transport |
|---|---|---|
| claude-code | `~/.claude/skills/` | symlink ✅ |
| codex | `~/.agents/skills/`, `~/.codex/skills/` | **copy only** (skips symlinks) |
| opencode | `~/.config/opencode/skills/` | symlink ✅ |
| pi / dsh | `~/.pi/agent/skills/` | symlink ✅ |
| devin | `~/.config/devin/skills/`, `~/.agents/skills/` | symlink ✅ |
| project-level | `<repo>/.agents|/.claude|/.devin/skills/` | copy (committed) |

Constraint: target dir name must equal frontmatter `name:` — installer renames the *directory*, never edits the file.

## 10. Roadmap

| Phase | Deliverable |
|---|---|
| 0 (now) | repo + this doc; deslop-fusion pipeline keeps producing `skill/` |
| 1 — CLI MVP | `scan` (all adapters), `audit` (static-only), `install` (hub→targets), `lock` |
| 2 — conflicts | `conflicts --report` on installed set + `build` personal merged skill; BYO-LLM audit |
| 3 — local web | `asm serve`: install matrix, conflict queue, audit report UI |
| 4 — surfaces | MCP server (agent self-service), Tauri shell, `asm daemon` watcher |
| 5 — market | curated index + publisher signing; decisions federation (share/merge arbitration records between users/teams) |

## 11. Relationship to deslop-fusion

The pipeline doesn't die — it becomes the **content factory** for the market:

- `skill/` (the arbitrated design skill) ships as the market's flagship curated skill
- `pipeline/` code is the conflict/audit engine imported by the client (`client/` imports `pipeline/lib`)
- `decisions/` schema is the shared arbitration format — the market aggregates what clients produce
- Repo scope widens: name `awesome-skill-market`, tagline covers manager + merge + audit + security

## 12. SEO / discovery plan

- skills.sh auto-indexes GitHub SKILL.md — `skill/` stays at repo root so `npx skills add terry2010/awesome-skill-market` keeps working
- Plugin manifests later (`.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`) for the plugin-native distribution channels
- Description keywords: skill manager, skill merge, skill audit, skill security, agent skills, anti-AI-slop, claude code, codex, opencode, pi, devin
