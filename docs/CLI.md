# skillmkt CLI — 开发文档

本文档是 `skillmkt`（awesome-skill-market 客户端）的完整开发规格：命令面、输出契约、数据 schema、模块划分、工作流程。设计背景见 [DESIGN.md](./DESIGN.md)。

**不变量**（与 AGENTS.md 一致，客户端额外遵守）：

- hub（`~/.skillmkt/`）是唯一可写副本；harness 目录只投影不回写
- 所有中间态都是 YAML/JSON 文件——中断可恢复，无隐藏进程态
- 任何来源（search/install/registry）的 skill 都必须过审核闸门才可落盘
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
| `skillmkt list` | 已装 skill × harness 矩阵（别名 `ls`） | 否 | 1 |
| `skillmkt show <name>` | 详情卡 / 原文 / 文件 / 规则（别名 `view`/`info`） | 否 | 1 |
| `skillmkt install <ref>` | 装 skill：拉取→审核→hub→投影（hub 缺席时静默自建；`<path>` 收编已装外部 skill） | 可选 | 1 |
| `skillmkt remove <name>` | 卸 skill：删投影+hub 副本（别名 `uninstall`/`un`/`rm`） | 否 | 1 |
| `skillmkt targets <sub>` | `list/add/remove` 管理投影目标（含纳入新 harness） | 否 | 1 |
| `skillmkt sync` | 从 hub+lock 重建全部投影 | 否 | 1 |
| `skillmkt audit [name]` | 审核：静态+可选 LLM | 可选 | 1 |
| `skillmkt update` | 刷新上游元数据（=apt update）：拉远端 ref+算 tree-hash 入本地 state，不动已装 | 否 | 2 |
| `skillmkt outdated` | 拿刷新结果对比 pin 出报告（=npm outdated / apt list --upgradable） | 否 | 2 |
| `skillmkt upgrade [name]` | **应用升级**（=apt upgrade）：拉新→diff→重审→重投影→改 lock | 可选 | 2 |
| `skillmkt download <ref>` | 只下载不装（=apt download）：fetch+审核→入缓存 | 可选 | 2 |
| `skillmkt diff <name>` | 版本 diff：`--semantic` 出意图摘要 | 可选 | 2 |
| `skillmkt rollback <name>` | 回滚上一版 hub 副本 | 否 | 2 |
| `skillmkt conflicts` | 冲突队列（对已装集合） | 可选 | 2 |
| `skillmkt resolve` | 交互式裁决走查 | 否 | 2 |
| `skillmkt decide <id> <v>` | 非交互单条裁决 | 否 | 2 |
| `skillmkt merge <names…>` | 圈定 skill 跑合并管线 | 是 | 2 |
| `skillmkt build` | 按 decisions 产出 merged skill | 否 | 2 |
| `skillmkt pack <name>` | 打 tarball 导出（=npm pack） | 否 | 4 |
| `skillmkt publish <name>` | 发布到 registry（=npm publish） | 否 | 4 |
| `skillmkt registry <sub>` | registry 适配器管理 | 否 | 1 |
| `skillmkt serve` | 本地 Web 面板 + daemon（长任务自动拉起，§3.11） | — | 3 |

---

## 2. 全局参数与约定

```
skillmkt <cmd> [args] [--json] [--hub <path>] [--verbose] [--no-llm] [--dry-run]
                     [--base-url <url>] [--model <id>] [--api-key-env <NAME>]
```

| 参数 | 说明 |
|---|---|
| `--json` | 机器输出：stdout 只出 JSON，装饰信息去 stderr |
| `--hub <path>` | 覆盖默认 `~/.skillmkt/`（测试/多库场景） |
| `--no-llm` | 本次运行禁一切 LLM 调用（即便端点已配） |
| `--verbose` | 打印每个决策点的理由到 stderr |
| `--ui` / `--cli` | 强制走 Web 面板 / 强制留终端（覆盖 §3.11 自动判定） |
| `--dry-run` | 只演示不落地（apt -s 语义；install/remove/sync/upgrade 均认） |

**退出码**：

| code | 含义 |
|---|---|
| 0 | 成功 |
| 1 | 一般错误（参数错、网络失败） |
| 2 | **审核闸门拒绝**（quarantine/malicious——CI 可据此阻断） |
| 3 | 存在 pending 冲突（`conflicts`/`build` 用于断言场景） |
| 4 | **存在可更新项**（`outdated` 专用——npm outdated exit 1 语义的单列版；`sync --dry-run` 投影漂移同用） |

**hub 目录**（默认 `~/.skillmkt/`）：

```
~/.skillmkt/
├── skills/<name>/           # 规范副本
├── library.yml              # 清单
├── lock.yml                 # content-hash 钉版
├── scans/<name>.yml         # 审核结果
├── conflicts/<id>.yml       # 冲突记录
├── decisions/<id>.yml       # 裁决记录
├── merged/                  # 合并产物中间态
├── state/upstream.yml       # update 刷新的远端元数据（ref+tree-hash+ts）
├── cache/                   # download 的未装包缓存
├── .history/<name>/         # rollback 的上一版副本（一版深度）
├── .trash/                  # remove 的回收站（--purge 跳过）
├── quarantine/              # 隔离区
├── daemon.json              # {pid, port, token, started_at}——serve 单例锁
└── config.yml               # 端点、registries、策略
```

`SKILLMKT_HOME` 环境变量 = `--hub` 的持久版。

**裸运行（无参数）——智能入口，不甩 help**：

| 状态 | 行为 |
|---|---|
| 未初始化（无 hub） | 打欢迎卡：`install <ref>` 开始装 skill / `init` 配 LLM（可选）——**init 非前置** |
| 已初始化 + TTY | **状态仪表盘**：只显示"需要注意力"的项（pending 冲突/可更新/审核告警置前）+ 下一步命令建议 |
| `ui.enabled: always` | 拉起 daemon 开面板首页，不打终端仪表盘 |
| 非 TTY | 单行状态摘要 exit 0 |

```
$ skillmkt
skillmkt · hub ~/.skillmkt · llm Ornith-1.5-35B-A3B ✓

skills      4 installed · 1 update available · audit 3✓/1⚠
harnesses   claude●  codex●  pi○available  devin○
conflicts   2 pending — 需要裁决
project     ~/code/myrepo · 2 project skills (.claude/skills) · deslop stale

下一步：
  skillmkt conflicts --ui     裁决 2 条冲突（开面板看图）
  skillmkt outdated           看 1 个可更新项
  skillmkt list               安装矩阵
```

**项目上下文——cwd 语义**：

从 cwd 向上找 `.git` 或任一 harness 目录（`.claude/`、`.agents/`、`.devin/`、`.opencode/`…）即"在项目里"。项目上下文改变以下命令行为：

| 命令 | 项目内行为 |
|---|---|
| 裸跑/`list` | 多报 project 块：项目级 skill（受管 `●managed` / 野生 `◌external`——`show` 能读、library 不登记） |
| `install --scope project` | copy 进 `<repo>/.claude|agents/skills/`——随仓共享，不进 default_targets |
| `conflicts`/`merge` | 项目级 skill 计入分析集（该项目实际生效的 skill 集） |
| `sync`/`upgrade` | 项目副本仅在 cwd 位于该仓库或 `--project <path>` 时刷新——不扫盘找仓库 |
| `remove --scope project` | 仅删项目副本，不动 hub |

原则：**项目级是"给团队的"（copy+commit），全局级是"给自己的"（symlink→hub）**——同一 skill 两边共存互不影响，各自钉版。

**LLM 配置解析链**（实现细节，用户只面对 `init`）：flag(`--base-url/--model/--api-key-env`) > env(`SKILLMKT_LLM_*`，向后兼容 `OMLX_*`) > `config.yml` 的 `llm:` 节 > `.env`。密钥一律存引用 `api_key: env:VAR_NAME`，永不写真值——config 可进 dotfiles。

```yaml
# ~/.skillmkt/config.yml
llm:
  base_url: http://localhost:8001/v1
  model: Ornith-1.5-35B-A3B
  api_key: env:SKILLMKT_API_KEY
  concurrency: 2
  timeout_ms: 60000
ui:
  enabled: auto              # auto|always|never——init 首问写入，控 §3.11 自动接管与裸跑形态
policy: balanced             # strict|balanced|permissive——审核闸门严格度
default_targets: [claude, codex]        # init/探测写入；install 默认投影目标
targets:                              # 自定义路径目标（targets add --path）
  team-shared: {path: ~/dotfiles/skills, transport: copy}
registries:                           # §8 适配器层
  - {type: github, default: true}
daemon:
  idle_minutes: 30                    # serve 无活动自退
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

### 3.0 `skillmkt init`——交互式配置（LLM/偏好，非装 skill 前置）

**首问选形态**（TTY 且未给 `--ui/--cli` 时）：

```
$ skillmkt init
? 初始化方式：
  ❯ Web 面板（推荐——探测结果、模型列表、harness 勾选可视化）
    终端向导（纯键盘，适合 SSH/无浏览器环境）
```

选 **Web**：拉起 daemon → `open /setup?t=<token>` → 面板内完成全流程（端点探测卡片、模型下拉、key 表单+测试连接、**harness 勾选矩阵直接选首批投影目标**、"下一步"引导进首装）。选**终端**：走下面的向导。选择写入 `config.yml` 的 `ui.enabled: always|auto|never`——之后 §3.11 所有自动接管听它的。非 TTY 不问；浏览器不可达自动回退终端向导。

零依赖手写 readline（~40 行键盘上下选择），不拉 inquirer。终端向导三步：

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
| 探测 | **只在用户进入"添加 LLM 配置"步骤时探测**——doctor/裸跑/其余命令只读 config 状态永不主动扫。探测方式：并发 300ms 扫常见端口，能回 `/v1/models` 即可用端点，服务名仅作展示标签 |
| 探测清单 | `8001` OMLX · `11434` Ollama（`GET /api/version` 特征端点识别，走 `/v1`）· `1234` LM Studio · `8000` vLLM · `8080` mlx-lm/llama.cpp/LocalAI（撞端口不分辨，谁应答谁可用）· `1337` Jan · `5000` text-gen-webui |
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
    claude-code  ~/.claude/skills      installed   (3 skills, symlink ok)
    codex        ~/.agents/skills      installed   (1 skill, copy only)
    devin        ~/.config/devin       available   (bin only — dir will create)
    windsurf     ~/.codeium/windsurf   likely      (dir only — 装过?)
    pi           ~/.pi/agent/skills    absent
✓ registries: github (default), rfc-discovery ×1
⚠ llm not configured — LLM features disabled (audit/conflicts/diff 降级静态)
  → 跑 skillmkt init 一键配置
```

检查项：node≥22、hub 可写、每个已知 harness 探测（见下）、registry 连通性、`.env` 端点。`--json` 给结构化结果供 `serve` 复用。

#### Harness 探测矩阵——每次运行都活探，不是 init 快照

对每条 harness 记录 `{id, bins[], dirs[], env_overrides[]}` 做双信号判定：

| 状态 | 条件 | 语义 |
|---|---|---|
| `installed` | bin∈PATH 且配置目录存在 | 投影目标，直接可用 |
| `available` | bin∈PATH 但目录未建 | 装了没用过——sync 时建目录 |
| `likely` | 目录在但 bin 不在 | 装过/残留，doctor 提示确认 |
| `absent` | 都没有 | 跳过 |

- **env 覆盖优先**：`CLAUDE_CONFIG_DIR`、`CODEX_HOME` 等 harness 自带目录变量先查
- **symlink 实测**：在目标目录建临时符号链接试，失败（Windows/权限）自动降级 copy 并记入 library——不写死平台假设
- **共享目录去重**：codex/devin 都指 `~/.agents/skills/` 时矩阵只投一次
- **动态纳入**：init 后新装的 harness 自动出现在 `list`/`doctor`（`available`）；交互式 `sync` 询问是否把全部 skill 投过去；`skillmkt targets add <harness>` 写入 `default_targets` 并立即投影。**非交互/CI 永不自动扩面**——"出现在矩阵"自动，"成为目标"必须显式

已知 harness 表（一行一条，新增 harness = 加一行）：

| id | bin | 全局目录 | 项目级目录 | 传输 |
|---|---|---|---|---|
| claude-code | `claude` | `~/.claude/skills/` | `<repo>/.claude/skills/`（含 monorepo 嵌套级） | symlink |
| codex | `codex` | `~/.agents/skills/`、`~/.codex/skills/` | `<repo>/.agents/skills/` | copy only |
| opencode | `opencode` | `~/.config/opencode/skills/` | `<repo>/.opencode/` | symlink |
| pi / dsh | `pi` | `~/.pi/agent/skills/` | `<repo>/.pi/` | symlink |
| devin | `devin` | `~/.config/devin/skills/`、`~/.agents/skills/` | `<repo>/.devin/skills/` | symlink |
| gemini | `gemini` | `~/.gemini/skills/` | `<repo>/.gemini/` | symlink |
| cursor | `cursor` | `~/.cursor/skills/` | `<repo>/.cursor/` | symlink |
| windsurf | — | `~/.codeium/windsurf/`（规则目录非 skills） | — | 仅探测不投影 |

项目级语义（Claude Code 官方六级模型对齐）：**全局=symlink 到 hub**（本机私有），**项目级=copy 进仓库**（commit 共享团队——symlink 指向的 hub 路径在别人机器不存在）。项目级目标不参与 `default_targets`，必须 `--scope project` 显式指定。

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

`◌external` 行尾部显示实际路径并给提示：`→ skillmkt install ~/.claude/skills/x 收编`。批量收编用管道：`skillmkt list --json | jq -r '.external[].path' | xargs -n1 skillmkt install`。

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
skillmkt install ./local/dir                   # 本地目录（npm install ./dir 语义）
skillmkt install ~/.claude/skills/x            # harness 里的 external = 收编（§3.5b）
skillmkt install git@github.com:o/r.git        # git URL
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
| `--scope project` | 项目级安装：copy 进 `<repo>/` 对应目录（不进 default_targets，随仓共享） |
| `--to <dir>` | 直指路径安装：落成 `<dir>/<name>/`，默认 copy，`--link` 强制 symlink；与 `--target` 互斥；登记为 `custom:<abs>` 目标纳入 sync/update/remove |
| `--yes` | 非交互；suspicious 时等同拒绝（安全默认） |
| `--path <subdir>` | monorepo 子目录定位 skill（`install owner/repo --path skills/foo`） |
| `--from <registry>` | 强制指定 registry 适配器（默认按 ref 前缀推断） |
| `--dry-run` | 只演示计划（fetch+审核+投影计划打印），不落盘——apt -s 语义，`remove`/`sync`/`upgrade` 同认 |
| `--keep-scripts` | 显式保留 scripts/（写入 scans 标记，strict 策略下无效） |

**无前置要求**：`install` 永远能跑——hub 缺席时静默创建骨架（仅建目录+harness 探测，不触发任何向导）。`init` 只负责 LLM 配置与偏好，**不是装 skill 的前置**。`--to`/`--scope`/`--target` 只是目的地修饰，安装语义不变：fetch → 审核闸门 → hub 登记 → 投影。

输出收尾：`✓ installed deslop → claude(sym) codex(copy) · audit:clean · locked 9f3e`

### 3.5b 收编已装的外部 skill——`install <path>`

scanner 在 harness 目录发现的非受管 skill 标记 `◌external`；收编**就是 `install` 本地路径**（npm install ./dir 语义）：

```bash
skillmkt install ~/.claude/skills/weird-thing    # 收编单个
skillmkt list --json | jq -r '.external[].path' | xargs -n1 skillmkt install   # 批量
```

流程：读原目录 → **尽力恢复来源**（目录内 `.git` remote、skills.sh 的 `skills-lock.json`、frontmatter homepage/repo 字段）→ 过静态审核闸门 → copy 进 `skills/<name>/` → 原位目录换成 symlink 指回 hub（transport 升级，harness 无感）→ library 登记 `adopted_from: <原路径>` + `adopted_at`。源路径已是 hub 内 symlink 时跳过（幂等）。

**收编默认目标 = 仅原所在 harness**（最小惊讶——不擅自扩散到其他 agent；显式 `--target` 才投多目标）。

| 来源恢复 | 结果 |
|---|---|
| 成功（git remote/lock 记录/frontmatter） | 完全受管：`outdated`/`upgrade`/`diff`/`rollback` 可用 |
| 失败 | `source: adopted`——sync/conflicts/audit 参与，`outdated` 显示 `n/a`，`show` 里标注"来源不明建议重装" |

本地有改动也收——当前内容就是被管版本；恢复出 upstream 后 `outdated`/`diff` 会显示与上游的差异供取舍。

### 3.6 `skillmkt remove <name>` / `sync` / `audit`

- `remove`：删各 harness 投影 → 移 hub 副本进 `.trash/`（保留一版供后悔）→ library/lock 除名；`--purge` 不留 trash 直接删（apt purge 语义）；`--scope project` 仅删项目副本不动 hub
- `sync`：按 library.yml+lock.yml 重放全部投影；`--dry-run` 只报漂移不动手（apt -s/simulate 语义）
- `audit [name|--all]`：重跑审核层刷新 `scans/`；`--llm` 强制含语义审

### 3.7 `skillmkt update` / `outdated` / `upgrade` / `download` / `diff` / `rollback`

apt 两阶段语义——**刷新与变更分离**（检查更新是重活：fetch+算 hash；可缓存可定时，应用升级才是受控时刻）：

```
$ skillmkt update            # apt update：拉远端 ref + 算远端 tree-hash → 写 state
refreshed 4 skills (2.3s)
$ skillmkt outdated          # apt list --upgradable：离线秒出对比
deslop       clean
taste-skill  upstream changed (a3f2 → 9c11) · rules +12/-3 · re-audit required
$ skillmkt upgrade taste-skill   # apt upgrade：应用（唯一改系统的动词）
```

- `update [name|--all]`：刷新远端元数据入 `state/upstream.yml`（ref+tree-hash+时间戳），**不碰任何已装文件**——daemon/cron 定时跑这条
- `outdated [name]`：离线对比出报告——**发现有更新项时 exit 4**，CI `skillmkt outdated || notify` 断言
- `upgrade [name|--all]`：拉新 → **`--semantic` diff 摘要** → 重过审 → 重投影 → 改 lock；`--dry-run` 只演示计划
- `download <ref>`：fetch → 审核 → 入 hub 缓存不写 targets——"先审后装"的独立动词；审完 `install` 命中缓存不重复拉
- `diff <name>`：当前 pin vs 上游 HEAD。默认结构 diff；`--semantic` 走 LLM 出"意图变化"摘要（**独占功能**，无模型降级行级）
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

### 3.10 `skillmkt pack` / `publish` / `registry`

- `pack <name> [-o <dir>]`：hub 目录打成 tarball（npm pack 语义）——`./dir` 导入用 `install ./dir`，不单设命令
- `publish <name> --to <registry>`：走适配器 `publish()` 发到 registry（clawhub 适配器，阶段 4）
- `registry add <url> --type clawhub` / `list` / `remove <alias>`：管理 config.yml 的 registries
- `targets list` / `targets add <harness>` / `targets add --path <dir> <alias>` / `targets remove <name>`：自定义路径目标写进 `config.yml` 的 `targets:`（`{path, transport, scope}`），之后当内置 harness 用

### 3.11 `skillmkt serve` + daemon 自动接管

**分工规则：终端干得快的事留在终端；要交互/要看图/跑得久的事自动开网页。**

| 触发命令 | 网页接管内容 |
|---|---|
| `merge` / `resolve` / `conflicts` | 证据截图并排 + 批量裁决 + 实时进度 |
| `install --to` / `targets` | 路径 picker + harness 勾选矩阵 |
| `diff --semantic` / `upgrade` | 语义 diff 双栏 + 审阅→确认→重分发流 |
| `init --ui` | 端点探测/模型选择做成表单（CLI 向导保留给纯终端） |
| 长任务（extract/arbitrate） | SSE 实时进度/日志，断线重连不丢 |

**生命周期**：

```
$ skillmkt resolve
  → 读 ~/.skillmkt/daemon.json {pid, port, token}
  → 未跑：spawn 后台 `skillmkt serve --daemon`
  → open http://localhost:PORT/resolve?t=<token>（darwin open/linux xdg-open）
  → CLI 打印 URL 兜底 → 默认立即返回；--wait 阻塞轮询到任务完
```

- **单例**：daemon.json 先查活再拉，不重复启动；僵死记录自动清理重启
- **token 鉴权**：localhost 也不裸奔——开页 URL 带一次性 token，API 请求全部校验（防本地任意网页 POST）
- **状态即文件**：daemon 无内存真理——`decisions/`、`merged/` 落盘即持久；daemon 崩溃 CLI 照读，重启续跑。**CLI 和 Web 是同一个文件系统的两个视图**
- **退出**：`skillmkt serve --stop`；或 `daemon.idle_minutes`（config，默认 30）无活动自退
- **边界**：非 TTY（CI/pipe/`--cli`）永不自动开浏览器；daemon 里跑的 LLM 工作遵守 `llm.concurrency` 限流，Ctrl-C `serve` 前台模式 = 全停

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
  weird-thing:                # 收编条目（install <harness-path>）
    source: {registry: adopted, adopted_from: "~/.claude/skills/weird-thing", adopted_at: "…"}
    targets: [claude]         # 默认仅原 harness（§3.5b）
    audit: stripped
    transport: {claude: symlink}
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
│   ├── init.js    config.js  doctor.js  search.js
│   ├── list.js    show.js    install.js remove.js
│   ├── targets.js sync.js    audit.js
│   ├── update.js  outdated.js upgrade.js download.js diff.js rollback.js
│   ├── conflicts.js resolve.js decide.js merge.js build.js
│   ├── pack.js    publish.js registry.js serve.js
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
│   ├── state.js             # state/upstream.yml 读写（update 刷新/outdated 对比）
│   ├── daemon.js            # daemon.json 单例锁、spawn、token、open URL（§3.11）
│   ├── llm.js               # 端点解析链 + 调 pipeline/lib/llm.js（可整体缺席）
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
skillmkt update                 → 刷新元数据（可挂 cron/daemon 定时）
skillmkt outdated               → taste-skill upstream changed
skillmkt diff taste-skill --semantic
   → "v9c11: 放宽了 motion floor——'idle 静止'改为'建议静止'；
      你 conf-0007 的裁决(b)不受影响"
skillmkt upgrade taste-skill    → 重过审 → 重投影 → lock
```

### 流程 D：企业 registry（适配器路径）

```
skillmkt registry add https://hub.corp.io --type clawhub --token env:CORP_TOKEN
skillmkt search "onboarding" --remote     → 结果含 corp:xxx
skillmkt install corp:onboarding          → clawhub.fetch → 同一条闸门 → 装
skillmkt publish my-design --to clawhub   → 适配器 publish() 发回企业市场
```

### 流程 E：CI/脚本模式（全确定性）

```bash
skillmkt install deslop --yes              # suspicious 即失败(exit 2)
skillmkt conflicts --json | jq '.pending | length'
skillmkt sync --dry-run                    # 投影漂移 → exit 4
skillmkt outdated                          # 有可更新项 → exit 4
```

### 流程 F：CLI→Web 接力（daemon 自动接管）

```
skillmkt merge taste-skill ui-ux-pro-max --name mine
   → CLI 内跑确定性阶段（extract/dedupe/候选）
   → 进入 LLM judge 长任务：自动拉起 daemon + open 浏览器到进度页
   → 浏览器看实时进度；跑完停在冲突裁决页
   → 用户看图裁决 3 条 → decisions/ 落盘
skillmkt build                    → CLI 纯确定性产出 → 投影+lock
（中途关浏览器？再跑 skillmkt conflicts --ui 重开同队列，状态零丢失）
```

---

## 7. 开发顺序

| 里程碑 | 范围 | 验收 |
|---|---|---|
| **M1 骨架** | bin/dispatch、`doctor`、`scanner`、`hub`、github 适配器、`install`（静态闸门+投影）、`list`、`show` | `doctor` 全绿；`install owner/repo` 真装一个 skill 到 claude+codex，`list` 矩阵正确 |
| **M2 管理面** | `remove`/`sync`/`update`(刷新)/`outdated`/`upgrade`/`download`/`rollback`/`diff`（行级）、收编（install 路径语义）、`registry add/list`、rfc 适配器 | drift 检测正确（tree-hash 粒度）；rfc 服务器可列可装 |
| **M3 冲突** | `extract`/`conflicts`/`decide`/`resolve`/`merge`/`build`——引擎从 pipeline 平移 | 两个真 skill 跑通全链，pending 不泄漏，`build` 产物可装 |
| **M4 智能** | LLM 审核、semantic diff、arbitrate 平移 | 接 OMLX 端点全链路；断网降级验证 |
| **M5 面板** | `serve` daemon + 自动接管（§3.11）：矩阵/冲突裁决/审核报告三屏 | 浏览器完成一次完整 resolve 走查；`resolve` 从 CLI 自动开页 |

M1 是纯确定性代码、零 LLM、零 registry 魔法——先把"装得进、看得见"跑通。
