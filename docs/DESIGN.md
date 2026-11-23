# awesome-skill-market — 设计文档

一个本地优先（local-first）的 skill 管理器、合并器、审核器与市场，面向 Agent Skills 生态。

一句话定位：**补上"装 skill"和"信任你的 agent"之间缺失的那层兼容性与安全**。

## 1. 为什么做这个项目

`npx skills add`（skills.sh，覆盖 75+ agent）已经解决了**安装**。但没人解决：

| 缺口 | 证据 |
|---|---|
| **skill 之间互相打架** | 同时装 taste-skill + ui-ux-pro-max + web-design-guidelines，规则互相矛盾，agent 读到哪条算哪条。没有工具检测这件事——而这正是本管线立项的原因。 |
| **skill 是没有审核的供应链** | SKILL.md 是 prompt 级指令注入：可以读密钥、跑捆绑脚本、污染 review 行为。自动搜索/自动安装会拆掉唯一的人工检查点。 |
| **版本漂移不可见** | 上游改动靠 `git pull` 手动同步悄悄落地；没有内容钉版，也没人告诉你变了什么。 |
| **分发面碎片化** | `.claude/`、`.agents/`、`.codex/`、`.pi/`、`.devin/`、`.opencode/`——六套目标目录，没有单一事实源。 |

## 2. 与现有工具的对比定位

| 工具 | 做了什么 | 缺什么 |
|---|---|---|
| skills.sh（`npx skills`） | 发现 + 装到 75 个 agent | 冲突、审核、本地库 |
| skillctl | 装/lint/卸、registry | lint 是风格评分，不是语义审核 |
| skills-manager-cli | hub + 分发 | 无冲突检测、无注入防御 |
| swarmskills | CLI + MCP 覆盖 ~45 个 agent | 只有管理功能 |
| claude/pi 原生 plugin | 官方分发 | 各 harness 各自为战 |
| **awesome-skill-market** | **hub + 合并 + 审核 + 安全分发** | — |

差异化，按重要性排序：

1. **冲突引擎**——对用户**已安装**的 skill 做语义矛盾检测（不只是上游合并）。deslop-fusion 引擎下沉为客户端能力。
2. **审核层**——安装时跑确定性检查 + 可选 LLM 语义审查，审核发生在本地而不是 registry 侧。
3. **安全姿态**——能力剥夺（剥掉 scripts/、密钥出口过滤、禁自我授权）替代"检测恶意"（打不赢，见 §6）。
4. **仲裁记忆**——用户裁决记录在本地，可导出回流融合管线（`decisions/` YAML）——客户端成为喂养市场的分布式仲裁网络。

## 3. 形态——已定

**主力：Node 22 ESM CLI + 本地 Web 面板**（`npx asm` → `asm serve` 打开 `http://localhost:PORT`）。

| 选项 | 结论 | 理由 |
|---|---|---|
| CLI | ✅ 核心 | 目标用户全有 Node 22；可脚本化；与 deslop-fusion 同运行时，引擎直接 import |
| 本地 Web 面板 | ✅ 二期 | 冲突 diff、安装矩阵、审核报告需要真 UI；localhost 页面成本是 Tauri 的 1/5 |
| TUI | ❌ | 两头不靠——不能脚本化，也触达不到非终端用户 |
| MCP server | 后期 | 是**分发面**不是产品——让 agent 在会话中调用管理器；做好本体后顺手包一层 |
| Tauri 桌面 | 后期 | 只有当非终端用户群真的出现时才做；包同一个 Node core 当 sidecar |

## 4. 架构

```
            ┌──────────── CLI: scan / audit / conflicts / install / serve ────────────┐
            │                     Node 22 ESM，零原生依赖                              │
            │                                                                        │
 发现 ──────┤  scanner     → 遍历每个已检测 harness 的 skill 目录                       │
            │  hub         → ~/.awesome-skill-market/skills/（单一事实源）             │
 审核 ──────┤  static      → scripts/、密钥模式、外联指令、权限请求                    │
            │  llm-audit   → 可选：用户自己的 OpenAI 兼容端点                          │
 冲突 ──────┤  engine      → jaccard + 指纹 + LLM 判定（来自 deslop-fusion）           │
            │  arbitrate   → 全新上下文的独立裁决（复用 arbitrate.js）                  │
            │  decisions   → ~/.awesome-skill-market/decisions/*.yml                  │
 版本 ──────┤  lock        → 每个 skill 每个目标的 content-hash 钉版；漂移检测          │
            │  changelog   → 两次钉版之间上游 skill 内容的 git-diff                   │
 分发 ──────┤  targets     → 按 harness 选 symlink|copy（codex 只能 copy）             │
            │  adapters    → claude-code、codex、opencode、pi、devin、dsh（=pi）       │
            └────────────────────────────────────────────────────────────────────────┘
                                   ↑
                    本地 Web UI ──┘（asm serve；React SPA + 轻量 node api）
```

所有 LLM 调用都可选且自带端点（`.env`：`OMLX_BASE_URL`/`OMLX_API_KEY`/`OMLX_MODEL`）。没有模型时整个确定性层照常工作——审核降级为纯静态，冲突检测降级为近重复告警。

## 5. 数据布局

```
~/.awesome-skill-market/
├── skills/                    # 规范副本（hub 库）
│   └── deslop/
│       ├── SKILL.md
│       └── references/
├── library.yml                # 清单：名称、来源、版本钉、目标、审核状态
├── lock.yml                   # 每个 skill 每个目标的 content-hash（漂移+完整性）
├── scans/<skill>.yml          # 审核结果：静态发现、LLM 判定、模型 id、日期
├── decisions/<pair-id>.yml    # 仲裁记录——与 deslop-fusion 同 schema，可导出
├── quarantine/                # 被拒/可疑 skill 隔离区，不参与分发
└── config.yml                 # 端点、适配器、策略（strict|balanced|permissive）
```

原则：hub 是唯一可写副本；harness 目录是投影。`asm sync` 从 hub + lock 重新生成所有目标。

## 6. 安全模型——控制优于检测

默认开启的确定性闸门，**无需模型**：

| 控制 | 机制 | 为什么模型绕不过 |
|---|---|---|
| scripts/ 剥离 | 可执行目录/文件永不写入目标 | 通道不存在，不是"被检测出来" |
| 密钥出口过滤 | 对出向 agent 上下文做字节模式扫描（`sk-`、`PRIVATE KEY`、`~/.ssh/`、`.env` 路径） | 模式匹配器不是模型 |
| 网络白名单 | 文档化的 devcontainer/profile 隔离加固方案 | 内核层，不是 prompt 层 |
| 禁自我授权 | skill 无法扩展自身工具权限——权限配置在 skills/ 之外 | 权限是宿主配置 |
| 钉版+重过闸 | content-hash 变化 = 重新过审再分发 | 上游劫持混不进已钉环境 |
| 溯源下限 | 安装量低于阈值/未知发布者 → `quarantine` 档，需显式 opt-in | 攻击者有社会成本 |

**LLM 审核层**（可选，用户自己的模型）：对 SKILL.md + references 做语义审查——注入内容当数据包裹，只输出结构化 `{verdict, findings[]}`。**阻断决定由代码基于 verdict 字段做，绝不交给模型自由发挥。**

**已知残余风险**（诚实记录）：一条写得温和的指令仍可能带偏单次会话的输出。open 档 skill 只进沙箱 profile；curated 档才进有真实密钥的环境。AI 审查是控制能力**之上**的概率过滤层，永远不是替代品。

## 7. 冲突与合并引擎

从 deslop-fusion 平移（`pipeline/lib`、`synthesize.js`、`arbitrate.js`）：

1. **扫描**全部已装 skill → 扁平规则语句（可选 LLM 抽取；静态分节为兜底）。
2. **近重复折叠**——确定性 jaccard≥0.9 并查集（已实现：`dedupeMerged`）。
3. **域级综合**——按域合并；或客户端更省的默认：候选过滤（token jaccard≥0.15 + scope 加分）后只对真候选对调 LLM。
4. **独立仲裁**——fresh-context 第二意见：`dismiss`（误报）、`approve`（含合并文本）、`human`（真价值权衡 → 进 CLI/web 队列）。
5. **裁决落盘**——`decisions/*.yml`，与 deslop-fusion 同 schema，可 PR 回上游或进团队共享 decisions 仓。

交付给用户的结果：**个人版合并 skill**（`asm build` 产出）= 已装 skill 的并集减去冲突；或仅出冲突报告不合并且（`--report` 模式）。

## 8. 版本管理

- `lock.yml` = `{skill, source, ref, content_hash, installed_at, targets[]}`
- `asm update --check` → 拉上游 HEAD、对 skill 子目录算 hash、对比 → 可更新 / 本地有改动 / 干净（tree-SHA 粒度而非 repo SHA——skill 目录外的上游噪声不误报）
- 更新流程：拉取 → diff 摘要 → **重过审**（新内容是新攻击面）→ 重分发
- `asm rollback <skill>` → 回滚上一份 hub 副本（保留一版深度）

## 9. 安装与分发矩阵

| 目标 | 路径 | 传输方式 |
|---|---|---|
| claude-code | `~/.claude/skills/` | symlink ✅ |
| codex | `~/.agents/skills/`、`~/.codex/skills/` | **只能 copy**（跳过 symlink） |
| opencode | `~/.config/opencode/skills/` | symlink ✅ |
| pi / dsh | `~/.pi/agent/skills/` | symlink ✅ |
| devin | `~/.config/devin/skills/`、`~/.agents/skills/` | symlink ✅ |
| 项目级 | `<repo>/.agents|/.claude|/.devin/skills/` | copy（随仓库提交） |

约束：目标目录名必须等于 frontmatter `name:`——安装器改的是**目录名**，绝不改文件。

## 10. 路线图

| 阶段 | 交付 |
|---|---|
| 0（现在） | 仓库 + 本文档；deslop-fusion 管线持续产出 `skill/` |
| 1 — CLI MVP | `scan`（全部适配器）、`audit`（纯静态）、`install`（hub→目标）、`lock` |
| 2 — 冲突 | `conflicts --report`（对安装集）+ `build` 个人合并 skill；BYO-LLM 审核 |
| 3 — 本地 Web | `asm serve`：安装矩阵、冲突队列、审核报告界面 |
| 4 — 分发面 | MCP server（agent 自助）、Tauri 壳、`asm daemon` 监听 |
| 5 — 市场 | curated 索引 + 发布者签名；仲裁联邦（用户/团队间共享合并裁决记录） |

## 11. 与 deslop-fusion 的关系

管线不死——它变成市场的**内容工厂**：

- `skill/`（被仲裁过的设计 skill）作为市场 flagship curated skill 出厂
- `pipeline/` 代码是客户端 import 的冲突/审核引擎（`client/` 引 `pipeline/lib`）
- `decisions/` schema 是共享仲裁格式——市场聚合各客户端的产出
- 仓库范围拓宽：改名 `awesome-skill-market`，描述覆盖 manager + merge + audit + security

## 12. SEO / 发现渠道

- skills.sh 自动索引 GitHub 上的 SKILL.md——`skill/` 留在仓库根目录，`npx skills add terry2010/awesome-skill-market` 持续可用
- 后期补 plugin manifest（`.claude-plugin/plugin.json`、`.codex-plugin/plugin.json`）进入 plugin 原生分发渠道
- 描述关键词：skill manager、skill merge、skill audit、skill security、agent skills、anti-AI-slop、claude code、codex、opencode、pi、devin
