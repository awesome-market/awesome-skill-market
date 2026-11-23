# skillmkt CLI — 开发文档

本文档是 `skillmkt`（awesome-skill-market 客户端）的完整开发规格：命令面、输出契约、数据 schema、模块划分、工作流程。设计背景见 [DESIGN.md](./DESIGN.md)。

**不变量**（与 AGENTS.md 一致，客户端额外遵守）：

- hub（`~/.skillmkt/`）是唯一可写副本；harness 目录只投影不回写
- 所有中间态都是 YAML/JSON 文件——中断可恢复，无隐藏进程态
- 任何来源（search/import/registry）的 skill 都必须过审核闸门才可落盘
- LLM 永远可选：无 `OMLX_*` 配置时确定性功能全部可用
- 所有命令支持 `--json`；人读输出走 stderr 装饰、数据走 stdout，可 pipe

---

## 1. 命令总表

| 命令 | 一句话 | LLM | 阶段 |
|---|---|---|---|
| `skillmkt init` | 交互式初始化：探测端点→选模型→冒烟→写 config | 是 | 1 |
| `skillmkt config <sub>` | `set/get/list` 读写 config.yml（脚本用） | 否 | 1 |
| `skillmkt doctor` | 环境自检：harness 目录、hub、端点、权限 | 否 | 1 |
| `skillmkt search <q>` | 本地+远端检索 skill | 否 | 1 |
| `skillmkt list` | 已装 skill × harness 矩阵 | 否 | 1 |
| `skillmkt show <name>` | 详情卡 / 原文 / 文件 / 规则 | 否 | 1 |
| `skillmkt install <ref>` | 装 skill：拉取→审核→hub→投影 | 可选 | 1 |
| `skillmkt remove <name>` | 卸 skill：删投影+hub 副本 | 否 | 1 |
| `skillmkt sync` | 从 hub+lock 重建全部投影 | 否 | 1 |
| `skillmkt audit [name]` | 审核：静态+可选 LLM | 可选 | 1 |
| `skillmkt update [--check]` | 上游漂移检测+更新 | 可选 | 2 |
| `skillmkt diff <name>` | 版本 diff：`--semantic` 出意图摘要 | 可选 | 2 |
| `skillmkt rollback <name>` | 回滚上一版 hub 副本 | 否 | 2 |
| `skillmkt conflicts` | 冲突队列（对已装集合） | 可选 | 2 |
| `skillmkt resolve` | 交互式裁决走查 | 否 | 2 |
| `skillmkt decide <id> <v>` | 非交互单条裁决 | 否 | 2 |
| `skillmkt merge <names…>` | 圈定 skill 跑合并管线 | 是 | 2 |
| `skillmkt build` | 按 decisions 产出 merged skill | 否 | 2 |
| `skillmkt import <src>` | 本地目录/git URL 导入 | 否 | 1 |
| `skillmkt export <name>` | 导出/发布到 registry | 否 | 4 |
| `skillmkt registry <sub>` | registry 适配器管理 | 否 | 1 |
| `skillmkt serve` | 本地 Web 面板 | — | 3 |

---

## 2. 全局参数与约定

```
skillmkt <cmd> [args] [--json] [--hub <path>] [--verbose] [--no-llm]
                     [--base-url <url>] [--model <id>] [--api-key-env <NAME>]
```

| 参数 | 说明 |
|---|---|
| `--json` | 机器输出：stdout 只出 JSON，装饰信息去 stderr |
| `--hub <path>` | 覆盖默认 `~/.skillmkt/`（测试/多库场景） |
| `--no-llm` | 本次运行禁一切 LLM 调用（即便端点已配） |
| `--verbose` | 打印每个决策点的理由到 stderr |

**退出码**：

| code | 含义 |
|---|---|
| 0 | 成功 |
| 1 | 一般错误（参数错、网络失败） |
| 2 | **审核闸门拒绝**（quarantine/malicious——CI 可据此阻断） |
| 3 | 存在 pending 冲突（`conflicts`/`build` 用于断言场景） |

**hub 目录**（对应 DESIGN.md §6，名字以实际为准）：

```
~/.skillmkt/
├── skills/<name>/           # 规范副本
├── library.yml              # 清单
├── lock.yml                 # content-hash 钉版
├── scans/<name>.yml         # 审核结果
├── conflicts/<id>.yml       # 冲突记录
├── decisions/<id>.yml       # 裁决记录
├── merged/                  # 合并产物中间态
├── quarantine/              # 隔离区
└── config.yml               # 端点、registries、策略
```

`SKILLMKT_HOME` 环境变量 = `--hub` 的持久版。

**LLM 配置解析链**（实现细节，用户只面对 `init`）：flag(`--base-url/--model/--api-key-env`) > env(`SKILLMKT_LLM_*`，向后兼容 `OMLX_*`) > `config.yml` 的 `llm:` 节 > `.env`。密钥一律存引用 `api_key: env:VAR_NAME`，永不写真值——config 可进 dotfiles。

```yaml
# ~/.skillmkt/config.yml
llm:
  base_url: http://localhost:8001/v1
  model: Ornith-1.5-35B-A3B
  api_key: env:SKILLMKT_API_KEY
  concurrency: 2
  timeout_ms: 60000
```

**LLM 需求边界**：`init`/`audit --llm`/`conflicts`(语义判定)/`diff --semantic`/`merge` 需要端点；其余命令永远不需要。端点不可达时非 `--llm` 命令降级静态模式+stderr 提示；显式 `--llm` 才硬失败。

**命令行参数配置**（最高优先级，单次生效不写盘）：

```bash
# 临时换端点/模型——本次运行覆盖 config.yml
skillmkt conflicts --base-url http://localhost:11434/v1 --model qwen3:32b
skillmkt audit deslop --llm --base-url https://api.openai.com/v1 \
                   --model gpt-5 --api-key-env OPENAI_API_KEY

# 纯环境变量（CI/容器场景，连 config 都不用写）
SKILLMKT_LLM_BASE_URL=http://gpu-box:8000/v1 \
SKILLMKT_LLM_API_KEY=$KEY \
SKILLMKT_LLM_MODEL=qwen3 \
  skillmkt audit --all --llm
```

| flag | env | config.yml 键 | 说明 |
|---|---|---|---|
| `--base-url` | `SKILLMKT_LLM_BASE_URL`（兼容 `OMLX_BASE_URL`） | `llm.base_url` | OpenAI 兼容端点根 |
| `--model` | `SKILLMKT_LLM_MODEL`（兼容 `OMLX_MODEL`） | `llm.model` | 模型 id |
| `--api-key-env` | `SKILLMKT_LLM_API_KEY`（兼容 `OMLX_API_KEY`） | `llm.api_key` | flag 形式传的是**变量名**不是 key 本体：`--api-key-env OPENAI_API_KEY` |
| — | — | `llm.concurrency` | 本地模型并发上限（默认 2） |
| — | — | `llm.timeout_ms` | 单次调用超时（默认 60000） |

---

## 3. 命令详规

### 3.0 `skillmkt init`——交互式初始化（用户唯一入口）

零依赖手写 readline（~40 行键盘上下选择），不拉 inquirer。三步：

```
$ skillmkt init

? 检测到 2 个本地 LLM 端点：
  ❯ http://localhost:8001/v1    OMLX · 3 models · 推荐
    http://localhost:11434/v1   Ollama · 12 models
    ─────────────────────────
    手动输入 URL
    跳过（不使用 LLM，静态模式运行）

? 选择模型（拉自 /v1/models）：
  ❯ Ornith-1.5-35B-A3B
    qwen3-32b

? 该端点需要 API key 吗？[y/N] y
  key: ••••••••
  → 建议 export SKILLMKT_API_KEY（已写入 config 引用）

✓ 测试调用成功 (147ms)
✓ 已写入 ~/.skillmkt/config.yml
```

| 步 | 实现 |
|---|---|
| 探测 | 并发 HEAD 常见端口：`8001`(OMLX) `11434`(Ollama) `1234`(LM Studio) `8000`(vLLM)；存活端点拉 `/v1/models` 填模型列表 |
| 手动输入 | 先 `GET /v1/models` 验证再进选择——URL 打错当场报错，不存坏配置 |
| 落盘 | 写 `config.yml`（key 存 `env:` 引用）+ 真 `/v1/chat` 冒烟 + shell rc export 建议 |
| 全空 | 探测零命中直接跳"手动输入/跳过" |

`init` 同时也初始化 hub 目录（`~/.skillmkt/` 骨架 + harness 探测写 `default_targets`）。重复跑 = 重配，幂等。

### 3.0b `skillmkt config`——脚本化读写

```bash
skillmkt config set llm.base_url http://localhost:8001/v1
skillmkt config set llm.model Ornith-1.5-35B-A3B
skillmkt config get llm                    # 读一节
skillmkt config list                       # 全量（api_key 值脱敏显示 env:NAME）
```

只读写 `config.yml` 不做解析链合并——脚本改配置用；读生效值用 `doctor --json`。

### 3.1 `skillmkt doctor`

自检。装/用之前先跑，输出全绿才继续。

```
$ skillmkt doctor
✓ node 22.14.0
✓ hub ~/.skillmkt (writable, empty)
✓ harnesses detected:
    claude-code  ~/.claude/skills            (3 skills, symlink ok)
    codex        ~/.agents/skills            (1 skill, copy only)
    pi           ~/.pi/agent/skills          (not found — skipped)
✓ registries: github (default), rfc-discovery ×1
⚠ llm not configured — LLM features disabled (audit/conflicts/diff 降级静态)
  → 跑 skillmkt init 一键配置
```

检查项：node≥22、hub 可写、每个已知 harness 目录存在性+可写性+symlink 能力探测、registry 连通性、`.env` 端点。`--json` 给结构化结果供 `serve` 复用。

### 3.2 `skillmkt search <query>`

两级检索，本地优先：

```
$ skillmkt search landing
LOCAL
  deslop            design rules · anti-AI-slop · →claude,pi
REMOTE (skills.sh index + github)
  vercel-labs/agent-skills/web-design-guidelines   ★12.3k  894k
  → skillmkt install vercel-labs/agent-skills --path web-design-guidelines
```

- 本地源：hub `skills/` + 全部已探测 harness 目录（已装 > 未装排序）
- 远端源：skills.sh 索引 API + `gh search code filename:SKILL.md`，stars/installs 降序
- 匹配：name → description → 全文；token 交集打分
- 参数：`--local`（只搜本地）、`--remote`、`--limit N`

### 3.3 `skillmkt list`

矩阵视图：

```
$ skillmkt list
skill           version  claude  codex  opencode  pi    devin  audit    conflicts
deslop          0.4.44   ●sym    ●copy  ●sym      ●sym  ●sym   clean    0
taste-skill     a3f2     ●sym    —      —         —     —      suspect  2
weird-thing     —        ●       —      —         —     —      ⚠strip   —
```

`●sym`=symlink 落位、`●copy`=copy、`—`=未装、`⚠strip`=scripts/ 已剥离。冲突列 = 与其他已装 skill 的 pending 冲突数。

### 3.4 `skillmkt show <name>`

详情卡（默认）：

```
$ skillmkt show deslop
deslop 0.4.44 · terry2010/awesome-skill-market@d2a5086
Anti-AI-slop design skill · 884 rules

files     SKILL.md (57KB) + references/ ×9 (408KB)
installed claude(sym) codex(copy) …
lock      sha1:9f3e… · upstream: clean
audit     clean (static: 0 · llm: not run)
conflicts none
```

| flag | 输出 |
|---|---|
| `--raw` | SKILL.md 原文（可 pipe） |
| `--files` | 文件树+大小 |
| `--rules` | 抽取后的规则列表（有 merged 数据时） |
| `--audit` | 完整审核报告（findings 明细） |

### 3.5 `skillmkt install <ref>`——主线一

**ref 语法**：

```
skillmkt install owner/repo                    # github 适配器（默认 registry）
skillmkt install owner/repo --path skills/foo  # monorepo 子目录
skillmkt install owner/repo@v1.2.0             # ref/tag/sha
skillmkt install corp:auth-skill               # 命名 registry 前缀
skillmkt install ./local/dir                   # 本地目录
skillmkt install <name> --from skills.sh       # 指定适配器
```

**流程**（每一步落盘，中断可续）：

```
resolve ref → adapter.fetch() → SkillPackage
    → ① 静态审核：scripts/?密钥模式?外联指令?（确定性）
    → ② LLM 审核（可选）：{verdict, findings}，代码按 verdict 决定
    → ③ 闸门：clean→放行 / suspicious→交互确认(--yes 视为拒绝) / malicious→quarantine
    → ④ 剥除 scripts/ + 可执行文件
    → ⑤ 写 hub skills/<name>/ + scans/<name>.yml
    → ⑥ 投影到 targets（library.yml 记录或 --target 指定）
    → ⑦ lock.yml 写 content_hash
```

| flag | 说明 |
|---|---|
| `--target claude,codex` | 指定投影目标（默认：config 里 `default_targets`） |
| `--yes` | 非交互；suspicious 时等同拒绝（安全默认） |
| `--audit-only` | 走完审核就停，不落盘不投影 |
| `--keep-scripts` | 显式保留 scripts/（写入 scans 标记，strict 策略下无效） |

输出收尾：`✓ installed deslop → claude(sym) codex(copy) · audit:clean · locked 9f3e`

### 3.6 `skillmkt remove <name>` / `sync` / `audit`

- `remove`：删各 harness 投影 → 移 hub 副本进 `.trash/`（保留一版供后悔）→ library/lock 除名
- `sync`：按 library.yml+lock.yml 重放全部投影；`--check` 只报漂移不动手
- `audit [name|--all]`：重跑审核层刷新 `scans/`；`--llm` 强制含语义审

### 3.7 `skillmkt update` / `diff` / `rollback`

```
$ skillmkt update --check
deslop       clean
taste-skill  upstream changed (a3f2 → 9c11) · rules +12/-3 · re-audit required
```

- `update [name|--all]`：拉新 → **`--semantic` diff 摘要** → 重过审 → 重投影 → 改 lock
- `diff <name>`：当前 pin vs 上游 HEAD。默认结构 diff（节增删/计数）；`--semantic` 走 LLM 出"意图变化"摘要（**独占功能**，无模型降级行级）
- `rollback`：hub 里留一版历史副本（`.history/<name>/`），一键换回

### 3.8 `skillmkt conflicts` / `resolve` / `decide`——主线二人审面

```
$ skillmkt conflicts
id         domain  sev    sides                    suggestion   status
conf-0007  motion  floor  taste--731 ~ hallma-204   keep-b       pending
           1 pending · 41 auto-resolved · skillmkt resolve 走查
```

**`resolve` 交互规范**（终端全键盘）：

```
── conf-0007 · motion · floor ── 3/12 ──────────────────────
 A  taste-skill:taste--731
    Decorative elements must stay still while idle.
 B  hallmark:hallma-204
    Ambient idle cycles allowed when pointer-reactive.
 AI: 同 scope 真矛盾 · 建议 keep-b · 证据 evidence/conf-0007/

 [a]选A [b]选B [m]采纳合并文本 [e]自写合并
 [d]误报 [s]跳过 [o]开证据 [q]退出 >
```

- `m`：`suggestion.kind=merge` 时预填合并文本可编辑；无建议则空白自写
- `e`：进入行编辑，回车存
- `o`：macOS `open` 证据目录（或提示 `skillmkt serve` 看图）
- 理由：选边后顺口一问，回车跳过记 `"manual pick"`
- 全部决定即时写 `decisions/<id>.yml`——**中途 q 不丢进度**

**`decide` 非交互**：

```bash
skillmkt decide conf-0007 b --reason "pointer-reactive 满足双方意图"
skillmkt decide conf-0011 merge "violet 只允许在 hero accent" --reason "scope-split"
skillmkt decide conf-0013 dismiss --reason "不同生命周期的指令"
skillmkt decide --from bulk.txt        # 每行: conf-XXXX a|b|merge|dismiss [text]
```

### 3.9 `skillmkt merge` / `build`

```bash
skillmkt merge taste-skill ui-ux-pro-max --name my-design   # 圈定→跑管线
skillmkt conflicts                                          # 看余下人审
skillmkt resolve                                            # 裁决
skillmkt build                                              # 产出
```

`merge` 顺序执行：extract→canonicalize→dedupe→candidate→judge→arbitrate（自动消化），输出统计后停在人审队列。`build` 是纯确定性重放：读 merged/ + decisions/ → 产出 `skills/<name>/SKILL.md + references/` → 投影+lock。pending 双方不进产物（不变量）。

### 3.10 `skillmkt import` / `export` / `registry`

- `import <dir|git-url>`：包成 SkillPackage 走**同一条审核闸门**入 hub
- `export <name> [--to <registry>]`：打包 hub 目录；`--to clawhub:xxx` 走适配器 `publish()`（阶段 4）
- `registry add <url> --type clawhub` / `list` / `remove <alias>`：管理 config.yml 的 registries

---

## 4. 数据 Schema

全部 YAML，字段与融合管线对齐（可直接 PR 回上游）。

### 4.1 `SkillPackage`（内存归一化对象）

```js
{
  name, version,
  files: { "SKILL.md": Buffer, "references/x.md": Buffer },
  sha256,                                   // artifact 级
  provenance: { registry, url, ref, fetched_at }
}
```

### 4.2 `library.yml`

```yaml
skills:
  deslop:
    source: {registry: github, ref: "terry2010/awesome-skill-market", path: "skill"}
    version: "0.4.44"
    installed_at: "2026-11-23T…"
    targets: [claude, codex, pi]
    audit: clean              # clean|suspicious|stripped|manual
    transport: {claude: symlink, codex: copy}
```

### 4.3 `lock.yml`

```yaml
deslop:
  content_hash: "sha1:9f3e…"        # hub 目录树 hash
  targets:
    claude: "sha1:9f3e…"            # 投影点实况（漂移检测基线）
  upstream_ref: "d2a5086"
```

### 4.4 `scans/<name>.yml`

```yaml
skill: deslop
scanned_at: "…"
static:
  scripts_present: true        # → stripped
  secret_patterns: []
  outbound_refs: []
  perm_requests: []
llm:                           # 无模型时省略整节
  verdict: clean               # clean|suspicious|malicious
  findings: []
  model: "Ornith-1.5-35B-A3B"
action: installed-stripped
```

### 4.5 `conflicts/<id>.yml` / `decisions/<id>.yml`

**直接复用管线 schema**（见仓库 `conflicts/`、`decisions/` 实例）：`fingerprint`、`sides[{key,source,rule_id,hash,severity,text}]`、`suggestion{kind,note}`、`status: pending|dismissed|decided`、`evidence_files`；decisions 的 `resolution`、`custom`、`reason`、`decided_by`、`supersedes`。**客户端裁决与管线裁决同构**——导出即可贡献回上游或团队共享仓。

---

## 5. 模块划分与复用映射

```
client/
├── bin/skillmkt.js          # 入口：argv 解析、全局 flag、dispatch、exit code
├── commands/
│   ├── doctor.js  search.js  list.js  show.js
│   ├── install.js remove.js  sync.js   audit.js
│   ├── update.js  diff.js    rollback.js
│   ├── conflicts.js resolve.js decide.js merge.js build.js
│   ├── import.js  export.js  registry.js serve.js
├── lib/
│   ├── hub.js               # 路径、library/lock 读写、history
│   ├── scanner.js           # harness 探测+遍历（矩阵数据源）
│   ├── project.js           # symlink/copy 投影 + 漂移校验
│   ├── audit.js             # 静态闸门 + verdict 判定逻辑
│   ├── package.js           # SkillPackage 归一化 + sha256
│   ├── registries/
│   │   ├── index.js         # 按 ref/type 路由适配器
│   │   ├── github.js        # MVP
│   │   ├── rfc.js           # MVP：.well-known/index.json + sha256 校验
│   │   └── clawhub.js       # 阶段4：OpenAPI client + publish
│   ├── conflicts.js         # 候选过滤 + 队列读写
│   ├── decide.js            # decisions 写入 + supersedes
│   ├── extract.js           # 规则抽取（LLM/静态双通道）
│   └── render.js            # 终端表格/详情卡渲染（~50行零依赖md）
└── serve/                   # 阶段3：node http api + 静态 SPA
```

**复用 `pipeline/` 的现成函数**（`import` 直接用，不重写）：

| 需求 | 复用 |
|---|---|
| YAML/hash/规范化/指纹 | `pipeline/lib/util.js`：`readYAML/writeYAML/sha1/normText/ruleHash/conflictFingerprint` |
| 去重/相似度 | `tokens/jaccard` + `dedupeMerged`（merge 阶段） |
| 并发池 | `mapPool`（受限并发） |
| LLM 客户端 | `pipeline/lib/llm.js`（`OMLX_*` 端点、重试、JSON 修复） |
| 独立仲裁 | `pipeline/arbitrate.js` 的 SYSTEM prompt + verdict 处理逻辑 |
| git/shell | `sh/git/gitDirty` |
| shell 打开证据 | `sh('open', …)`（macOS） |

**新写**：全部 commands、hub/project/scanner/audit/package/registries/render——这些是客户端独有的确定性代码，也是安全边界所在，**不外包给 AI 生成**（serve/ 的 SPA 可以）。

---

## 6. 端到端工作流

### 流程 A：装一个新 skill（最常见路径）

```
skillmkt search "design"        → 看到 taste-skill，REMOTE ★高
skillmkt install Leonxlnx/taste-skill --target claude,pi
   fetch → static(clean) → [LLM skip: 未配] → strip scripts/
   → hub → 投影×2 → lock
skillmkt list                   → 矩阵确认落位
```

### 流程 B：检出+裁决冲突（差异化路径）

```
skillmkt conflicts              → 或先 skillmkt merge a b --name mine
   extract(静态或LLM) → dedupe → 候选对 → judge+arbitrate(自动)
   → "3 pending · 41 auto-resolved"
skillmkt resolve                → 走查 3 条：a、b、merge 自写
skillmkt build                  → skills/mine/ 产出 → 投影 → lock
skillmkt list                   → mine 在矩阵里，audit:clean
```

### 流程 C：版本更新（AI diff 路径）

```
skillmkt update --check         → taste-skill upstream changed
skillmkt diff taste-skill --semantic
   → "v9c11: 放宽了 motion floor——'idle 静止'改为'建议静止'；
      你 conf-0007 的裁决(b)不受影响"
skillmkt update taste-skill     → 重过审 → 重投影 → lock
```

### 流程 D：企业 registry（适配器路径）

```
skillmkt registry add https://hub.corp.io --type clawhub --token env:CORP_TOKEN
skillmkt search "onboarding" --remote     → 结果含 corp:xxx
skillmkt install corp:onboarding          → clawhub.fetch → 同一条闸门 → 装
skillmkt export my-design --to clawhub    → publish() 发回企业市场
```

### 流程 E：CI/脚本模式（全确定性）

```bash
skillmkt install deslop --yes              # suspicious 即失败(exit 2)
skillmkt conflicts --json | jq '.pending | length'
skillmkt sync --check                      # 投影漂移 → exit 1
```

---

## 7. 开发顺序

| 里程碑 | 范围 | 验收 |
|---|---|---|
| **M1 骨架** | bin/dispatch、`doctor`、`scanner`、`hub`、github 适配器、`install`（静态闸门+投影）、`list`、`show` | `doctor` 全绿；`install owner/repo` 真装一个 skill 到 claude+codex，`list` 矩阵正确 |
| **M2 管理面** | `remove`/`sync`/`update`/`rollback`/`diff`（行级）、`import`、`registry add/list`、rfc 适配器 | drift 检测正确（tree-hash 粒度）；rfc 服务器可列可装 |
| **M3 冲突** | `extract`/`conflicts`/`decide`/`resolve`/`merge`/`build`——引擎从 pipeline 平移 | 两个真 skill 跑通全链，pending 不泄漏，`build` 产物可装 |
| **M4 智能** | LLM 审核、semantic diff、arbitrate 平移 | 接 OMLX 端点全链路；断网降级验证 |
| **M5 面板** | `serve`：矩阵/冲突裁决/审核报告三屏 | 浏览器完成一次完整 resolve 走查 |

M1 是纯确定性代码、零 LLM、零 registry 魔法——先把"装得进、看得见"跑通。
