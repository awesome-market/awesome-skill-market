# awesome-skill-market — 设计文档

一个本地优先（local-first）的 skill 管理器、合并器、审核器，面向 Agent Skills 生态。

一句话定位：**"连接所有市场（公共 + 企业私有）的唯一客户端，并且是唯一会仲裁的"**。

不建市场、不建安装器——安装已被 skills.sh 解决（40k star、月下载千万级）；市场的空白在 **兼容性 + 安全**。

> CLI 命令、schema、模块划分、端到端工作流见 [CLI.md](./CLI.md)。

## 1. 为什么做这个项目

`npx skills add`（skills.sh，覆盖 75+ agent）已经解决了**安装**。但没人解决：

| 缺口 | 证据 |
|---|---|
| **skill 之间互相打架** | 同时装 taste-skill + ui-ux-pro-max + web-design-guidelines，规则互相矛盾，agent 读到哪条算哪条。这正是本管线立项的原因。 |
| **skill 是没有审核的供应链** | SKILL.md 是 prompt 级指令注入：可以读密钥、跑捆绑脚本、污染 review 行为。自动搜索/自动安装会拆掉唯一的人工检查点。 |
| **版本漂移不可见** | 上游改动悄悄落地；没有内容钉版，也没人告诉你**变了什么、为什么变**。 |
| **分发面碎片化** | `.claude/`、`.agents/`、`.codex/`、`.pi/`、`.devin/`、`.opencode/`——六套目标目录，没有单一事实源。 |
| **registry 碎片化** | skills.sh 公网、ClawHub 公网、企业自建的 saker/iflytek/netclaw 部署——用户要一套客户端连所有来源，而不是每家一个工具。 |

## 2. 与现有工具的对比定位

### 客户端/管理器类

| 工具 | 做了什么 | 缺什么 |
|---|---|---|
| skills.sh（`npx skills`） | 发现 + 装到 75 个 agent | 冲突、审核、本地库——**我们不重复它，只消费它的索引** |
| skillctl | 装/lint/卸、自定义 registry | lint 是风格评分，不是语义审核 |
| skills-manager-cli | hub + 分发 + 漂移检测 | 无冲突检测、无注入防御 |
| agent-skills-cli | doctor/compose/diff/sandbox 全家桶 | 每个功能都浅——`doctor --deep` 冲突检测也是一遍过 |
| swarmskills | CLI + MCP 覆盖 ~45 个 agent | 只有管理功能 |
| claude/pi 原生 plugin | 官方分发 | 各 harness 各自为战 |

### 合并/冲突类——真实竞争面

| 工具 | 冲突能力 | 实际深度 |
|---|---|---|
| **skillhub compose** | 检测 + AI 合并 | ⚠️ **玩具级**：冲突 = 同名 `##` 标题字符串匹配；默认 `first-wins` 静默丢弃整节；AI 合并无校验无溯源；14 star、发布 3 天后弃坑。**验证了需求，实现深度差数量级** |
| **skillclash** | 只检测 | TF-IDF 词面重叠 + 同名检查，出报告即止——没有裁决、没有合并产物 |
| skillmeld | 任务向合并 | 安全扫描 + 逐字节溯源，但合的是"为任务检索到的"而非已装集合；无仲裁痕迹 |
| agent-skills-cli compose | 段级合并 | 同 skillhub 量级 |
| skill-git | 版本控制 + 两两合并 | merge 相似 skill，无冲突语义 |
| precedent | 规则优先级 | "谁赢"不合并、不仲裁内容 |
| **awesome-skill-market** | **检测 + 仲裁 + 裁决留痕 + 合并产物** | — |

**结论：别人检测冲突，我们仲裁冲突。** 所有撞车项目最多做到"报告冲突给你自己看着办"或"AI 糊一个结果直接收"。我们独有：

1. **证据裁决**——A/B 渲染截图让人看效果而非读文字（全网唯一）
2. **独立仲裁器**——fresh-context 第二意见自动消化误报与可解冲突（实测 22→0 人审）
3. **裁决即数据**——`decisions/*.yml` 带 reason/supersedes，可推翻、可联邦共享
4. **挂起语义**——未裁决的矛盾**双方都不进产物**，矛盾不会静默混入

### 企业私有市场类——不自建，做适配

已有三个严肃实现，**我们不进这个战场**（见 §8）：

| 实现 | 形态 |
|---|---|
| saker-ai/skillhub | 单 Go 二进制、Web UI+REST+CLI、git 版本化、RBAC——**实现 ClawHub 协议** |
| iflytek/skillhub | namespace 治理 + 审计日志 + K8s 部署（私有 API） |
| netclaw skill-server | 实现 Cloudflare Discovery RFC + 私有 manifest |

## 3. 产品形态——已定

**主力：Node 22 ESM CLI + 本地 Web 面板**（`npx awesome-skill-market` → `skillmkt serve` 打开 `http://localhost:PORT`）。

| 选项 | 结论 | 理由 |
|---|---|---|
| CLI | ✅ 核心 | 目标用户全有 Node 22；可脚本化；与融合管线同运行时，引擎直接 import |
| 本地 Web 面板 | ✅ 二期 | 冲突 diff、安装矩阵、审核报告需要真 UI；**UI 层用 AI 生成（v0/bolt），安全引擎人工写**——localhost 页面成本是 Tauri 的 1/5 |
| TUI | ❌ | 两头不靠——不能脚本化，也触达不到非终端用户 |
| MCP server | 后期 | 是**分发面**不是产品——让 agent 在会话中调用管理器；做好本体后顺手包一层 |
| Tauri 桌面 | 后期 | 只有当非终端用户群真的出现时才做；AI 写壳也行，包同一个 Node core 当 sidecar |

## 4. 功能范围——四个核心

| # | 功能 | 说明 |
|---|---|---|
| ① | **搜索 skills.sh 市场** | 不自建公共索引——skills.sh 的 `GET /api/search?q=` 是官方 `npx skills` 同款端点（`SKILLS_API_URL` 可自托管），客户端直接消费 + GitHub 兜底。等自有下载量起来再评估自建 |
| ② | **本地管理 + 版本 AI diff** | hub 管理全部已装 skill；同 skill 不同版本间做**语义 diff**（LLM 讲清"这版改了什么意图"）——现有工具全是行级/段级机械 diff，这是独占点 |
| ③ | **按用户选择合并** | 用户圈定若干 skill → 冲突引擎仲裁 → 产出个人版 merged SKILL.md；或仅出冲突报告不合并 |
| ④ | **导入/导出 + 企业市场连接** | 本地目录/Git URL 导入；连接企业自建 registry——**通过协议适配器（§8），不自建服务端** |

## 5. 架构

```
            ┌──────────── CLI: search / list / show / audit / conflicts / resolve / build / sync ────────────┐
            │                              Node 22 ESM，零原生依赖                                            │
            │                                                                                                │
 检索 ──────┤  search      → 本地（hub+各 harness 目录）优先，远端（skills.sh 索引+GitHub）次之                │
            │  registry    → 适配器层（github | rfc-discovery | clawhub | …）→ 归一化 SkillPackage            │
 发现 ──────┤  scanner     → 遍历每个已检测 harness 的 skill 目录                                              │
            │  hub         → ~/.skillmkt/skills/（单一事实源）                                                │
 审核 ──────┤  static      → scripts/、密钥模式、外联指令、权限请求                                            │
            │  llm-audit   → 可选：用户自己的 OpenAI 兼容端点                                                   │
 版本 ──────┤  lock        → 每个 skill 每个目标的 content-hash 钉版；漂移检测                                  │
            │  ai-diff     → 两次钉版间的语义 diff（LLM 摘要意图变化；降级为行级 diff）                          │
 冲突 ──────┤  engine      → jaccard + 指纹 + LLM 判定（来自融合管线）                                          │
            │  arbitrate   → 全新上下文的独立裁决（复用 arbitrate.js）                                          │
            │  decisions   → ~/.skillmkt/decisions/*.yml                                                      │
 分发 ──────┤  targets     → copy 投影（hub 权威，漂移可检测；--link 可选 symlink）                           │
            │  adapters    → claude-code、codex、opencode、pi、devin、dsh（=pi）                               │
            └──────────────────────────────────────────────────────────────────────────────────────────────────┘
                                   ↑
                    本地 Web UI ──┘（skillmkt serve；React SPA + 轻量 node api）
```

所有 LLM 调用都可选且自带端点（`.env`：`OMLX_BASE_URL`/`OMLX_API_KEY`/`OMLX_MODEL`）。没有模型时整个确定性层照常工作——审核降级为纯静态，冲突检测降级为近重复告警，AI diff 降级为行级 diff。

## 6. 数据布局

```
~/.skillmkt/
├── skills/                    # 规范副本（hub 库）
│   └── deslop/
│       ├── SKILL.md
│       └── references/
├── library.yml                # 清单：名称、来源、版本钉、目标、审核状态
├── lock.yml                   # 每个 skill 每个目标的 content-hash（漂移+完整性）
├── scans/<skill>.yml          # 审核结果：静态发现、LLM 判定、模型 id、日期
├── conflicts/<id>.yml         # 冲突记录
├── decisions/<id>.yml         # 仲裁记录——与融合管线同 schema，可导出
├── merged/                    # 合并产物中间态
├── state/upstream.yml         # update 刷新的远端元数据
├── cache/                     # download 的未装包缓存
├── quarantine/                # 被拒/可疑 skill 隔离区，不参与分发
├── daemon.json                # serve 单例锁 {pid,port,token}
└── config.yml                 # 端点、registry 列表、适配器、策略（strict|balanced|permissive）
```

完整字段级 schema 见 [CLI.md §4](./CLI.md)。

原则：hub 是唯一可写副本；harness 目录是投影。`skillmkt sync` 从 hub + lock 重新生成所有目标。

## 7. 安全模型——控制优于检测

默认开启的确定性闸门，**无需模型**：

| 控制 | 机制 | 为什么模型绕不过 |
|---|---|---|
| scripts/ 剥离 | 可执行目录/文件永不写入目标 | 通道不存在，不是"被检测出来" |
| 密钥出口过滤 | 对出向 agent 上下文做字节模式扫描（`sk-`、`PRIVATE KEY`、`~/.ssh/`、`.env` 路径） | 模式匹配器不是模型 |
| 网络白名单 | 文档化的 devcontainer/profile 隔离加固方案 | 内核层，不是 prompt 层 |
| 禁自我授权 | skill 无法扩展自身工具权限——权限配置在 skills/ 之外 | 权限是宿主配置 |
| 钉版+重过闸 | content-hash 变化 = 重新过审再分发 | 上游劫持混不进已钉环境 |
| 溯源下限 | 安装量低于阈值/未知发布者 → `quarantine` 档，需显式 opt-in | 攻击者有社会成本 |

**LLM 审核层**（可选，用户自己的模型）：对 SKILL.md + references 做语义审查——注入内容当数据包裹，只输出结构化 `{verdict, findings[]}`。**阻断决定由代码基于 verdict 字段做，绝不交给模型自由发挥。** 分布式自查优于集中审核：攻击者要同时骗过各家模型，绕过成本指数上升。

**已知残余风险**（诚实记录）：一条写得温和的指令仍可能带偏单次会话的输出。open 档 skill 只进沙箱 profile；curated 档才进有真实密钥的环境。AI 审查是控制能力**之上**的概率过滤层，永远不是替代品。

## 8. Registry 适配器层——企业连接方案

**不建服务器。** 企业自建市场已有三个严肃实现（§2），而且协议层在标准化——客户端做适配器通吃：

```yaml
# ~/.skillmkt/config.yml
registries:
  - {type: github,        default: true}                        # owner/repo 直装（覆盖现实 90%+，含 skills.sh 索引）
  - {type: rfc-discovery, url: https://skills.internal.corp}    # 企业内网只读索引
  - {type: clawhub,       url: https://hub.corp.io, token: env:CORP_TOKEN}
```

| 协议 | 规范状态 | 能力 | 适配器工作量 |
|---|---|---|---|
| **github** | 事实标准 | 拉取即安装 | 极简（git clone / tarball） |
| **rfc-discovery**（Cloudflare） | draft v0.2.0；`.well-known` 合入 PR 仍 open，v0.1→v0.2 已破过兼容 | **只读**：`/.well-known/agent-skills/index.json` 列 name/url/sha256——无搜索（索引内本地过滤）、无发布、无认证 | 极简（fetch + sha256 校验 + `$schema` 版本探测降级） |
| **clawhub** | OpenAPI spec 现成（`/api/v1/openapi.json`）；**公共实例 clawhub.ai 实测可联调** | **全功能**：`/packages/search`（含 score/categories/official 标）/versions/download + `POST /skills` 发布 + Bearer 鉴权 + `/security` 平台安检数据 | ~200 行，spec 可生成客户端 |
| iflytek 私有 API | 私有 | — | 遇到真实部署再写 |

统一接口：

```js
interface RegistryAdapter {
  search(query)    → SkillMeta[]
  versions(name)   → Version[]
  fetch(name, ver) → {files, sha256, provenance}
  publish?(pkg)    → void            // 仅 clawhub——"本地合并完发布到公司市场"
}
```

所有适配器归一化成同一个 `SkillPackage`，下游 install/lock/audit/merge 完全不感知来源。

**价值**：企业**不需要换基础设施**——已部署 saker（ClawHub 协议）或 netclaw（RFC）的公司，`skillmkt registry add` 一行配置即接入。比"说服企业部署你的服务器"容易一个数量级。

**认证**：企业会挂 SSO/代理在前——适配器 auth 做成"注入 header 配置"而非写死 Bearer。

## 9. 版本管理

- `lock.yml` = `{skill, source, ref, content_hash, installed_at, targets[]}`
- **apt 两阶段**：`skillmkt update` 只刷新上游元数据（拉远端 ref+算 tree-hash 入 `state/upstream.yml`，不碰已装）；`skillmkt outdated` 离线对比出报告（exit 4 有更新）；`skillmkt upgrade` 才应用——拉取 → **AI diff 摘要**（语义层：意图变化而非行号）→ **重过审**（新内容是新攻击面）→ 重分发
- `skillmkt rollback <skill>` → 回滚上一份 hub 副本（保留一版深度）

**AI 语义 diff** 是独占点：现有 diff 全是行级/段级（agent-skills-cli、skillhub preview），没人回答"这次更新把哪条规则的意图改了、会不会影响我的裁决"。LLM 缺席时降级为结构 diff（节增删 + 计数）。

## 10. 冲突与合并引擎

从融合管线平移（`pipeline/lib`、`synthesize.js`、`arbitrate.js`）：

1. **扫描**全部已装 skill → 扁平规则语句（可选 LLM 抽取；静态分节为兜底）。
2. **近重复折叠**——确定性 jaccard≥0.9 并查集（已实现：`dedupeMerged`）。
3. **域级综合**——按域合并；或客户端更省的默认：候选过滤（token jaccard≥0.15 + scope 加分）后只对真候选对调 LLM。
4. **独立仲裁**——fresh-context 第二意见：`dismiss`（误报）、`approve`（含合并文本）、`human`（真价值权衡 → 进 CLI/web 队列）。
5. **裁决落盘**——`decisions/*.yml`，与融合管线同 schema，可 PR 回上游或进团队共享 decisions 仓。

交互式裁决队列（`skillmkt resolve`）：`[a]选A [b]选B [m]采纳合并文本 [e]自写合并 [d]误报 [s]跳过 [o]打开证据 [q]退出`。证据 `open evidence/conf-XXXX/` 看 A/B 截图，或在 Web 面板看图。

交付结果：**个人版合并 skill**（`skillmkt build` 产出）= 已装 skill 的并集减去冲突；或仅出报告（`--report`）。pending 冲突双方都被挡在产物外。

## 11. 安装与分发矩阵

默认传输**一律 copy**：hub 是唯一权威副本，各 harness 目录为 copy 投影——本地改动经 lock 对比为可检测 drift，不静默污染 hub；内容可随用户项目 git 提交；无 Windows symlink 权限依赖。`--link` 保留 Unix symlink 选项。

| 目标 | 路径 |
|---|---|
| claude-code | `~/.claude/skills/` |
| codex | `~/.agents/skills/`、`~/.codex/skills/` |
| opencode | `~/.config/opencode/skills/` |
| pi / dsh | `~/.pi/agent/skills/` |
| devin | `~/.config/devin/skills/`、`~/.agents/skills/` |
| gemini / cursor | `~/.gemini/skills/`、`~/.cursor/skills/` |
| 项目级 | `<repo>/.agents|/.claude|/.devin/skills/` |

完整 harness 探测表（含 windsurf 等"只探测不投影"行）见 [CLI.md §3.1](./CLI.md)。

约束：目标目录名必须等于 frontmatter `name:`——安装器改的是**目录名**，绝不改文件。

## 12. 路线图

| 阶段 | 交付 |
|---|---|
| 0（现在） | 仓库 + 本文档；融合管线持续产出 `skill/`（v0.4.44, 884 rules） |
| 1 — CLI MVP | `doctor`/`scanner`（全部 harness 探测）、`list`/`show`、`audit`（纯静态）、`install`（hub→目标）、`remove`/`targets`/`sync`；**registry 适配器：github + rfc-discovery** |
| 2 — 冲突+版本 | `conflicts` + `resolve` 交互队列 + `merge`/`build` 个人合并 skill；`update`/`outdated`/`upgrade`/`download`/`diff`/`rollback`；BYO-LLM 审核；**AI 语义 diff** |
| 3 — 本地 Web | `skillmkt serve` daemon + 自动接管：安装矩阵、冲突队列（含证据图）、审核报告——UI 层 AI 生成 |
| 4 — registry 扩展 | **clawhub 适配器**（搜索+`publish` 发布，对接 saker 自托管）；iflytek 适配器按需 |
| 5 — 分发面 | MCP server（agent 自助）、Tauri 壳、daemon 常驻监听 |
| 6 — 仲裁联邦 | 用户/团队间共享 decisions 记录；curated 索引视下载量再定 |

## 13. 与融合管线的关系

管线不死——它变成市场的**内容工厂**：

- `skill/`（被仲裁过的设计 skill）作为 flagship curated skill 出厂，也是面向大众的产品入口——**普通用户只需 `npx skills add`，管线是信用背书不是使用门槛**
- `pipeline/` 代码是客户端 import 的冲突/审核引擎（`client/` 引 `pipeline/lib`）
- `decisions/` schema 是共享仲裁格式——市场聚合各客户端的产出
- 项目赌法：**skill 面向大众走量，管理器做信任故事 + 深度用户入口**——管理器小众不是失败是定位

## 14. SEO / 发现渠道

- skills.sh 自动索引 GitHub 上的 SKILL.md——`skill/` 留在仓库根目录，`npx skills add awesome-market/awesome-skill-market` 持续可用
- 后期补 plugin manifest（`.claude-plugin/plugin.json`、`.codex-plugin/plugin.json`）进入 plugin 原生分发渠道
- 实现 `/.well-known/agent-skills/index.json` 让 RFC 客户端也能发现我们（出站+入站双向兼容）
- 描述关键词：skill manager、skill merge、skill audit、skill security、agent skills、anti-AI-slop、claude code、codex、opencode、pi、devin
