# DEV.md — skillmkt 开发文档

本文档是实现的唯一依据。产品语义见 [DESIGN.md](./DESIGN.md)，命令 UX/schema 见 [CLI.md](./CLI.md)——三方冲突时以本文档实现细节为准并回改那两份。

> 阅读顺序：§1 环境事实 → §2 包改造 → §3 目录树 → §4-6 数据层 → §7 lib 模块 → §8 命令实现表 → §9 引擎泛化 → §10 daemon/Web → §11 测试 → §12 开发顺序 → §13 发布。

---

## 1. 已验证的环境事实（开发常量，勿再猜）

| 项 | 实测值 |
|---|---|
| Node | ≥22，plain ESM，无 build step |
| LLM 端点 | `http://localhost:8001/v1`，OpenAI 兼容，key `sk-omlx-IwR34vV1H4dzFvIX0EA510Ra`，模型 `Ornith-1.5-35B-A3B-BigBang-MTP-mlx-4bit`（models 列表实测在列） |
| skills.sh API | `GET https://skills.sh/api/search?q=<q>[&owner=<o>]` → `{skills:[{id:"owner/repo/skill-id", source, skillId, name, installs}]}`——`npx skills` 官方同款，`SKILLS_API_URL` 可指向自托管 |
| skills.sh 托管 | Vercel——大陆间歇不通；搜索回退链见 §7.6 |
| clawhub.ai | 公共实例活，`GET /api/v1/packages/search?q=`、`/api/v1/openapi.json` 可用（二期适配器联调对象） |
| npm | 本机已登录 `terry2010`；`skillmkt` 包名空闲 |
| 本机 harness 实况 | opencode `installed`（25 skills，最大收编样本）、codex `installed`（`~/.codex/`+共享 `~/.agents/`）、devin 经共享目录 `installed`、claude/pi/gemini `available`、windsurf `likely`、cursor `absent` |
| 收编取证源 | `.git` remote、skills.sh `skills-lock.json`、`.market-skills.json`（opencode 实测存在）、frontmatter homepage/repo |
| 测试旗舰夹具 | 本仓 `skill/`（设计域，884 rules）——`install ./skill` 与远端 `--path skill` 两条路径都能测 |

**范围**：M1-M5 全做。二期排除：clawhub 适配器实现（spec 留接口）、企业 registry 联调、自建反代 VPS 部署、modelscope/gitee 源、MCP/Tauri。

---

## 2. package.json 改造

```jsonc
{
  "name": "skillmkt",                    // 改：发布名=可执行名
  "version": "0.1.0",
  "private": false,                      // 改：去掉 private
  "type": "module",
  "bin": { "skillmkt": "client/bin/skillmkt.js" },
  "files": ["client/", "pipeline/lib/", "skill/"],   // 发布只带需要的；pipeline 其它阶段脚本不发布
  "engines": { "node": ">=22" },
  "description": "Local-first agent skill manager: install, audit, merge, distribute.",
  "keywords": ["agent-skills","skill-manager","claude-code","codex","opencode","devin","skill-audit","skill-merge"],
  "scripts": {
    // 现有管线 scripts 全部保留；新增：
    "skillmkt": "node client/bin/skillmkt.js"
  },
  "dependencies": { "yaml": "^2.6.1" },
  "devDependencies": { "playwright": "^1.49.0" }     // devDep 保持——evidence 才用，发布不进生产依赖
}
```

注意：`pipeline/lib/` 要进 `files` 因为 client 会 import 其中纯函数；`pipeline/*.js` 阶段脚本**不发布**（它们耦合本仓数据目录）。若 client 需要的 pipeline 内部函数未 export，**在 client/lib 里重写或复制**——不为发布而改 pipeline 的私有结构。

---

## 3. client/ 目录树与文件职责

```
client/
├── bin/
│   └── skillmkt.js            # 入口：shebang、全局 flag 解析、命令 dispatch、bare-run 仪表盘
├── commands/                  # 一文件一命令；导出 async function run(ctx)
│   ├── init.js  config.js  doctor.js
│   ├── search.js  list.js   show.js
│   ├── install.js remove.js targets.js sync.js
│   ├── audit.js  update.js  outdated.js upgrade.js download.js diff.js rollback.js
│   ├── conflicts.js resolve.js decide.js merge.js build.js
│   ├── pack.js   publish.js registry.js serve.js
├── lib/
│   ├── ctx.js                 # 构造命令上下文 {hub, config, llm, flags, tty, cwd, projectRoot}
│   ├── hub.js                 # hub 路径解析、骨架创建、library/lock 原子读写、history/trash
│   ├── scanner.js             # harness 探测矩阵 + skill 目录扫描 + external 发现
│   ├── project.js             # copy 投影 + drift 校验（--link 可选 symlink）
│   ├── package.js             # SkillPackage 归一化、tree-hash、frontmatter 解析
│   ├── audit.js               # 静态闸门规则 + verdict 归并 + strip
│   ├── ref.js                 # install 引用语法解析 → {kind, owner, repo, ref, path, registry, localPath}
│   ├── registries/
│   │   ├── index.js           # resolve(ref, config) → adapter 路由 + fetch mirror 前缀
│   │   ├── skillssh.js        # /api/search 消费 + 多词降级归并
│   │   ├── github.js          # gh api/tarball 拉取、ref/path 定位、provenance
│   │   └── rfc.js             # .well-known index.json + sha256 校验（只读）
│   ├── state.js               # state/upstream.yml、cache/ 索引
│   ├── conflicts.js           # 候选过滤、fingerprint 去重、conflicts/*.yml 队列读写
│   ├── extract.js             # 规则抽取：LLM 通道 + 静态分节兜底（泛化版，§9）
│   ├── arbitrate.js           # 仲裁调用封装（fresh-context prompt，移植）
│   ├── evidence.js            # 设计域才生成截图（playwright 动态 import，缺席降级）
│   ├── decide.js              # decisions/*.yml 写入 + supersedes
│   ├── mergebuild.js          # merged/ 中间态 + SKILL.md 产物生成 + --check
│   ├── llm.js                 # 端点解析链 + chatJSON 调用 + 按命令懒探测
│   ├── daemon.js              # daemon.json 锁、spawn serve、token、open URL、SSE client
│   └── render.js              # 终端表格、frontmatter 卡、裸跑仪表盘、进度条（stderr 装饰）
└── serve/                     # M5：node:http api + SSE + 静态 SPA
    ├── server.js  api.js  sse.js
    └── public/                # index.html + app.js（无构建 SPA）
```

约定：commands 只做参数→lib 调用→渲染三步，零业务逻辑；lib 之间单向依赖（registries→package→hub；conflicts→extract/arbitrate/state）。

---

## 4. 数据层 schema（写死，测试按此断言）

`hubPath()` 解析：`--hub` > `SKILLMKT_HOME` > `~/.skillmkt`。`ensureHub()` 幂等建骨架（不弹任何交互）。

```
~/.skillmkt/
├── skills/<name>/           # 权威副本（含 .skillmkt-meta.yml? —— 不，元数据全在 library.yml）
├── library.yml  lock.yml  config.yml  daemon.json
├── scans/<name>.yml         # 审核结果
├── conflicts/<id>.yml       # 冲突记录
├── decisions/<id>.yml       # 裁决记录
├── merged/                  # {rules.yml, manifest.yml} 合并中间态
├── state/upstream.yml       # update 刷新结果
├── cache/<name>-<hash>/     # download 未装包
├── .history/<name>/         # rollback 一版深度
├── .trash/<name>-<ts>/      # remove 回收站
└── quarantine/<name>-<ts>/  # 隔离区
```

### 4.1 library.yml

```yaml
version: 1
skills:
  <name>:
    source:                                # 二选一形态
      registry: github                     # github|skillssh|rfc|clawhub|adopted|local
      ref: "vercel-labs/agent-skills"
      path: "web-design-guidelines"        # monorepo 子目录可空
      pin: "a3f2c1"                        # ref/tag/commit
      adopted_from: "~/.codex/skills/x"    # 仅 registry: adopted
      adopted_at: "…"
    version: "0.4.44"                      # frontmatter version 或 "0.0.0"
    installed_at: "ISO"
    targets: [claude, codex]               # 投影目标 id 或 "custom:<abs>"
    scope: global                          # global|project（project 时 targets 记 repo 相对）
    project_root: null                     # project scope 时的仓库绝对路径
    audit: clean                           # clean|suspicious|stripped|manual|quarantined
    transport: {claude: copy, codex: copy} # copy|link；默认全 copy
```

### 4.2 lock.yml

```yaml
version: 1
skills:
  <name>:
    content_hash: "sha256:…"               # hub 副本 tree-hash
    targets:
      claude:  {hash: "sha256:…", projected_at: "…", mode: copy}
      codex:   {hash: "sha256:…", projected_at: "…", mode: copy}
```

tree-hash 算法：`sha256( 排序(join(相对路径 + "\0" + sha256(file内容) + "\n")) )`——目录名不参与（可重命名稳定）。

### 4.3 scans/<name>.yml

```yaml
name: <name>
scanned_at: "ISO"
static:
  findings: [{rule: scripts-dir|secret-pattern|egress-cmd|perm-escalation, file, line?, excerpt}]
  stripped: [scripts/]                     # 被剥离项
verdict: clean|suspicious|malicious
llm: {model, at, verdict, findings: []}    # 可选节
```

### 4.4 conflicts/<id>.yml（与管线 schema 一致）

```yaml
id: conf-0001
status: pending|dismissed|resolved
fingerprint: <sha1-12>
detected_at: ISO
evidence: screenshot|text|none
sides:
  - {key: A, source: <skill名>, rule_id, hash, severity, text, text_zh?}
  - {key: B, ...}
domain: <动态域标签>
ai_explanation: …      # LLM 判定输出
suggestion: {kind: keep-a|keep-b|merge|human, note, merge_text?}
evidence_files: [option-a.png]
```

### 4.5 decisions/<id>.yml

```yaml
id: conf-0001
resolution: a|b|merge|custom|dismissed
reason: "必填"
decided_at: ISO
merged_text: "resolution=merge|custom 时的文本"
supersedes: {resolution, reason, at} | null
```

### 4.6 state/upstream.yml

```yaml
refreshed_at: ISO
skills:
  <name>: {ref: "a3f2c1", tree_hash: "sha256:…", latest: "1.2.0"|null, checked_at: ISO}
```

### 4.7 config.yml

```yaml
llm: {base_url, model, api_key: "env:VAR", concurrency: 2, timeout_ms: 60000}
ui: {enabled: auto}                        # auto|always|never
policy: balanced                           # strict|balanced|permissive
default_targets: [claude, codex]
targets: {<name>: {path, transport}}
registries: [{type, url?, token?, default?}]
daemon: {idle_minutes: 30}
```

### 4.8 daemon.json

```json
{"pid": 1234, "port": 4173, "token": "<random-32>", "started_at": "ISO"}
```

---

## 5. Harness 探测表（scanner.js 的数据源）

```js
export const HARNESSES = [
  { id:'claude',  bins:['claude'],   envs:['CLAUDE_CONFIG_DIR'], // env→$V/skills/
    dirs:['~/.claude/skills'], projectDirs:['.claude/skills'] },
  { id:'codex',   bins:['codex'],    envs:['CODEX_HOME'],
    dirs:['~/.agents/skills','~/.codex/skills'], projectDirs:['.agents/skills'] },
  { id:'opencode',bins:['opencode'], envs:['OPENCODE_CONFIG_DIR'],
    dirs:['~/.config/opencode/skills'], projectDirs:['.opencode'] },
  { id:'pi',      bins:['pi','dsh'], envs:[],
    dirs:['~/.pi/agent/skills'], projectDirs:['.pi'] },
  { id:'devin',   bins:['devin'],    envs:['DEVIN_CONFIG_DIR'],
    dirs:['~/.config/devin/skills','~/.agents/skills'], projectDirs:['.devin/skills'] },
  { id:'gemini',  bins:['gemini'],   envs:['GEMINI_HOME'],
    dirs:['~/.gemini/skills'], projectDirs:['.gemini'] },
  { id:'cursor',  bins:['cursor'],   envs:[],
    dirs:['~/.cursor/skills'], projectDirs:['.cursor'] },
  { id:'windsurf',bins:['windsurf'], envs:[],
    dirs:['~/.codeium/windsurf'], projectDirs:[], detectOnly:true },
];
```

四态判定（每条 `dir` 独立判，取最好）：
`installed`=bin∈PATH ∧ dir 存在；`available`=bin∈PATH ∧ dir 缺；`likely`=dir∃ ∧ bin∉PATH；`absent`=双无。
规则：env 覆盖优先（值是 harness 根目录，skill 目录=`$ENV/skills`）；共享路径去重（codex/devin 的 `~/.agents/skills` 只投影一次，library targets 记归属 id 列表）；env override 的目录算 `installed` 当且仅当 bin 存在。

**主目录规则**（实现期补）：同一 harness 声明多个 `dirs` 时，**扫描吃全部、投影只投主目录**（`primaryDir`=首个存在的，否则首个）——codex 主目录为 `~/.codex/skills`（`~/.agents/skills` 是共享约定目录，仍入扫描与共享去重）。这保证 lock targets 键=harness id 唯一，不会同 id 多目录互相覆盖。

`scanSkillDir(dir)`：遍历一级子目录，读 `SKILL.md` frontmatter 得 `name/version/description`，返回 `{name, path, version, fileCount, contentHash}`。

`detectProject(cwd)`：向上找 `.git` 或任一 `projectDirs` → `{root, dirs[]}`。

---

## 6. Ref 解析器（lib/ref.js）——install 的全部输入

```js
parseRef(input, flags) → one of:
  {kind:'github',   owner, repo, ref?, path?}        // "o/r" "o/r@v1" "o/r" + --path  "git@github.com:o/r.git"
  {kind:'named',    name, registry?}                  // "deslop" / "deslop --from skills.sh" / "corp:x" → registry 前缀
  {kind:'local',    absPath}                          // "./dir" "../x" "/abs" "~/x" —— 目录必须含 SKILL.md
  {kind:'harness',  absPath, harnessId}               // local 且路径位于某 harness skills 目录下 → 收编流
  {kind:'cache',    name}                             // 命中 cache/ 的复用（download 后 install）
```

判定序：`existsSync(expand(input))` → local/harness；含 `:` 前缀且前缀∈registries → named+registry；匹配 `^[\w.-]+/[\w.-]+(@\S+)?$` 或 git URL → github；其余 → named（默认 registry=skillssh→github 索引）。

---

## 7. lib 模块接口（按依赖序）

### 7.1 ctx.js
```js
makeCtx(argv) → {
  flags: {json, hub, verbose, noLlm, dryRun, ui: 'auto'|'force'|'off', baseUrl, model, apiKeyEnv, yes, ...},
  hub: hubPath, config: Config, llm: LLMConfig|null,
  tty: process.stdout.isTTY, ci: !!process.env.CI,
  cwd, project: detectProject(cwd)
}
```

### 7.2 hub.js
```js
hubPath(flags) → abs
ensureHub(hub) → void                       // mkdir -p 全部子目录，幂等
readLibrary(hub)/writeLibrary(hub, data)    // yaml；写=tmp+rename
readLock(hub)/writeLock(hub, data)
registerSkill(hub, entry) / unregisterSkill(hub, name)
trashPath(hub, name) / historySnapshot(hub, name)  // copy skills/<n> → .history 前存
```

### 7.3 package.js
```js
parseFrontmatter(file) → {name, version, description, ...rest}
treeHash(dir) → 'sha256:…'
normalizePackage({files, provenance}) → SkillPackage
readSkillDir(absPath) → {name, version, files:[], hash}
```

### 7.4 scanner.js —— §5 表 + `detectHarnesses()`、`scanAll()`（hub+各 dir+project→统一 `[{name, state:managed|external, ...}]`）、shared-dir 去重

### 7.5 project.js
```js
projectSkill(pkg, targetDir, {mode='copy', dryRun}) → {target, hash, action: created|updated|skipped}
checkDrift(hub) → [{name, target, expected, actual}]   // lock vs 实测
unproject(name, targetDir) → void
```
copy = `fs.cpSync(src, dst, {recursive:true})` 前先比对 hash 相等跳过；目标存在异内容且无登记 → 报 `unmanaged content` 需 `--force`。

### 7.6 registries/
```ts
interface Adapter { search(q):SkillMeta[]; meta(name):Meta; versions(name):Ver[]; fetch(name,ref):{files,sha256,provenance}; }
```
- `index.js`：`resolveAdapter(ref, config)` + `applyFetchMirror(url, config)`（`fetch_mirror` 前缀包装，支持 `gh-proxy.com` 风格）
- `skillssh.js`：`searchRemote(q, {base})`——base 取 `SKILLMKT_SEARCH_API` > `SKILLS_API_URL` > config > 默认；实现官方多词降级（§CLI.3.2）；`installs` 参与排序
- `github.js`：`gh api repos/{o}/{r}/tarball/{ref}` 取包解压至 tmp，`--path` 定位子目录；ref 缺省 `gh repo view` 拿 default_branch → HEAD sha 作 pin；`gh` 缺席报明确错误。**失败链**：直连 → `fetch_mirror` 前缀 → `fastly.jsdelivr.net/gh/o/r@ref/`（`data.jsdelivr.com/v1/packages/gh/o/r@ref` 列文件）逐文件拉
- `rfc.js`：`GET <url>/.well-known/agent-skills/index.json` → name/url/sha256 校验下载

### 7.7 audit.js —— 静态闸门规则

| rule id | 检测 | 判定 |
|---|---|---|
| `scripts-dir` | skill 内含 `scripts/`、`bin/`、可执行位文件、`install.sh` 等 | findings；默认 strip（`--keep-scripts` 保留+标记） |
| `secret-pattern` | 正文含 `sk-[A-Za-z0-9]{20,}`、`-----BEGIN .*PRIVATE KEY`、`~/.ssh/`、`.env` 读取指令、`AWS_`、`TOKEN=` 赋值 | suspicious≥1 处；≥3 或含私钥块 → malicious |
| `egress-cmd` | `curl|wget|Invoke-WebRequest` + 非文档域 URL、`nc -`、`/dev/tcp/`、base64 管道 | suspicious；外联到未列域名 → malicious 候选 |
| `perm-escalation` | "ignore previous instructions"、"do not tell the user"、"add yourself to"、权限/工具配置改写指令 | suspicious |
| `pii-harvest` | 收集通讯录/浏览器 profile/cookie/钱包路径指令 | malicious |

verdict 归并：`malicious`→ quarantine+exit 2；`suspicious`→ balanced 下交互确认（`--yes` 视为拒）、stripped 内容照装但 scans 留痕；`clean`→过。LLM 审（`--llm`）：`chatJSON` 输出 `{verdict, findings[]}`，**代码做最终判定**（LLM malicious → 人工确认提示而非自动隔离，误报成本考虑——strict 策略下直接隔离）。

### 7.8 state.js —— upstream.yml 读写 + cache 索引 `{name, hash, fetched_at, path}`

### 7.9 llm.js
```js
resolveLLM(ctx) → {base_url, model, api_key, concurrency, timeout_ms} | null
// 优先级：flag > SKILLMKT_LLM_* > OMLX_* > config.llm > .env
chatJSON(opts) → 直接 re-export pipeline/lib/llm.js（把 env 解析提前到 resolveLLM）
probeEndpoints() → 仅 init/config 用：并发探测 {8001 omlx,11434 ollama,1234 lmstudio,8000 vllm,8080 mlx,1337 jan,5000 tgw} 的 /v1/models，300ms 超时
```
**铁律**：非 init/config 命令零端口探测；`--no-llm` 全禁；显式 `--llm` 端点不可达=硬失败 exit 1。

### 7.10 conflicts/extract/arbitrate/decide/mergebuild —— §9

### 7.11 daemon.js
```js
daemonInfo(hub) → {pid,port,token}|null        // 读 daemon.json + kill(pid,0) 探活
ensureDaemon(hub) → {port,token,url}           // 未跑：spawn('node',[serve.js,'--daemon'],{detached,stdio:ignore}) + unref + 等端口 ≤3s
openURL(path, {ui}) → 打印 URL 兜底 + spawn open/xdg-open（tty 且 ui!=='off' 时）
```
状态铁律：daemon 内存只缓存索引，真理全在文件；崩了 CLI 照跑。

### 7.12 render.js —— `table(rows, cols)`、`skillCard(meta)`、`dashboard(hub, scan, state)`（裸跑）、`kv(lines)`；全部装饰走 stderr，`--json` 时 stdout 纯 JSON。

---

## 8. 命令实现表（dispatch → 行为 → 关键 lib → exit）

| 命令 | 实现要点 |
|---|---|
| `bin/skillmkt.js` | `#!/usr/bin/env node`；argv[2]→commands 表（含别名 ls/view/info/uninstall/un/rm/f/s）；`--help`/`-h`/`-V`；bare-run→§8.0 |
| **bare-run** | 无 hub→TTY 进 `init` 首问（非 TTY 打 `run 'skillmkt init'` exit1）；`ui.enabled=always`→ensureDaemon+open dashboard 页；否则 render.dashboard：skills/update/conflicts/audit 摘要+下一步建议；非 TTY 单行 exit0 |
| `init` | tty 首问 Web/终端（`--ui`/`--cli` 跳过）；终端：probeEndpoints→列模型→`chatJSON` 冒烟（"reply OK"）→写 config.llm+ui.enabled；detectHarnesses→default_targets；hub 骨架 |
| `config <get\|set\|list> [k] [v]` | config.yml 读写；set 支持 `llm.base_url` 点路径 |
| `doctor` | node≥22/hub 可写/harness 矩阵（§5 活探）/registries 连通（HEAD 3s）/llm 已配状态（不探端口）/checkDrift 摘要；`--json` 结构化 |
| `search <q>` | 本地 scanAll 子串匹配 → `LOCAL` 段；`--remote`/默认 tty 时追加 `REMOTE` 段（skillssh.searchRemote，超时降级提示）；`--registry`、`--json` |
| `list` | skills×targets 投影矩阵（`●copy/●sym/—`）+ external 行 + pending 冲突数 + project 块 |
| `show <name>` | frontmatter 卡+版本+audit+targets；`--raw`(打 SKILL.md 原文)`--files``--rules``--audit` |
| `install <ref>` | parseRef→ensureHub→adapter.fetch（local=harness 走 §8.1）→audit 闸门→strip→写 skills/<n>→registerSkill→projectSkill×targets→lock→汇总行；exit2 隔离 |
| `remove <n>` | unproject×targets→skills/<n>→.trash（`--purge` 直删）→unregister+lock 除名；`--scope project` 仅删项目副本 |
| `targets` | `list`（harness+custom 矩阵）/`add <id>`（写 default_targets+全量投影）/`add --path <dir> <name>`（写 config.targets）/`remove <id>`（退投影+除 default_targets） |
| `sync` | 全量 projectSkill 重放；`--dry-run`=checkDrift 报告 exit4；tty 遇新 available harness 问是否纳入（CI 不问） |
| `audit [n\|--all]` | 重跑 audit.js→scans/；`--llm` 含语义层 |
| `update` | 对每个 library source≠adopted 的 skill：adapter 拉远端 ref+tree-hash→state/upstream.yml；**不写 skills/不投影** |
| `outdated` | state vs lock 对比→报告；有更新 exit4 |
| `upgrade [n\|--all]` | 拉新包→diff 摘要（`--semantic` 走 LLM）→重过审→historySnapshot→写 skills→重投影→lock；`--dry-run` 只演示 |
| `download <ref>` | fetch→audit→cache/；提示 `install` 命中缓存 |
| `diff <n>` | lock pin vs upstream：默认结构 diff（节增删计数），`--semantic`→LLM 意图摘要，无 LLM 降级行级 |
| `rollback <n>` | .history/<n>/ 有副本→换回 skills/→重投影→lock |
| `conflicts` | 引擎跑（§9）→写 conflicts/*.yml（fingerprint 去重）→队列渲染；pending>0 exit3；`--json` |
| `resolve [id]` | 队列交互：`[a][b][m 取合并][e 编辑合并][d 误报][s 跳过][o 证据][q]`；`e`→`$EDITOR` 临时文件 或 `--ui` 网页 |
| `decide <id> --resolution … --reason …` | decide.js 写 decisions/（supersedes 自动记） |
| `merge <a> <b> [--name n]` | 圈选→extract→dedupe→LLM 判定+仲裁→merged/ 中间态 |
| `build [--check]` | merged/+decisions→`skill-out/`（默认 `~/.skillmkt/merged/` 产物 + 可选 `--out`）；pending 双边排除；`--check` 供 CI 比对 |
| `pack <n>` | hub/local skill→`<n>-<ver>.tar.gz` |
| `publish <n> --to <reg>` | 二期：clawhub `POST /skills`；一期报"adapter 未实现"友好错误 |
| `registry` | `list`/`add --type <t> --url <u> [--token env:X]`/`remove <n>`→config.registries |
| `serve` | §10；`--daemon`（被 spawn 的内部模式）/`--stop`/`--port`/`--wait` |

### 8.1 收编流（install 的 kind:'harness' 分支）

`readSkillDir`→取证来源（`.git` remote → `skills-lock.json` → `.market-skills.json` → frontmatter homepage）→audit→copy 入 hub→**原目录就地登记为受管投影**（hash 已在）→library `registry:adopted|github` + `adopted_from/at`。目标默认=仅原 harness；已受管幂等跳过；来源恢复失败 `source:adopted`（参与 sync/conflicts，`outdated` 显示 n/a）。

### 8.2 交互兜底

非 TTY：一切确认类交互（suspicious 审核、新 harness 纳入、Web/终端选择）**默认安全项**（拒绝/不扩面/终端模式）并 stderr 注明；`--yes` 只对安装确认说 yes，**不对 suspicious 放行**。

---

## 9. 冲突引擎泛化（pipeline → client 移植方案）

管线是为设计域调的（`synthesize.js` 硬编码 `DOMAINS=[color,type,layout,motion,a11y,copy,imagery,code,process]`）。客户端面对任意 skill，**去固定域**：

| 管线 | 客户端做法 |
|---|---|
| `extract` 按 SKILL.md 抽规则带 severity | **直接移植**，prompt 改通用（"任何 agent skill"）；静态兜底=按 `##` 分节，每节首句候选；severity 词表保留 floor/standard/reflex |
| 9 固定域 | **动态域**：extract 时让 LLM 给每条规则自由 `domain` 标签（≤12 字符），静态兜底用节标题 slug 化；冲突只在**同域或 token-jaccard≥0.15** 的候选对里跑 |
| `detectDilemmas` LLM 判定 | 移植 prompt（去 DOMAIN 前缀，用动态标签） |
| `arbitrate` fresh-context | **近乎原样移植**——它本来就域无关（输入=pair+context） |
| `dedupeMerged` jaccard≥0.9 | 移植（`lib/conflicts.js` 内实现，util 的 tokens/jaccard 直接 import pipeline/lib/util.js） |
| `conflictFingerprint`/`ruleHash`/`nextId` | 直接 import pipeline/lib/util.js ✅ |
| decide.js | 逻辑移植 client/lib/decide.js（resolution/reason/supersedes 不变量保持） |
| evidence.js playwright | **设计域限定**：`isDesignDomain(d)` = d∈{design,ui,ux,css,layout,color,motion,type,typography,frontend,a11y,visual} 才跑截图；其余 `evidence: text`（纯文本 A/B）+ `ai_explanation` 充解说 |
| `skill/` 产物 build | mergebuild.js 简化版：merged/rules.yml → 单文件 SKILL.md（域分组+provenance 注释）；pending 双边排除用 rule `hash` 匹配（**不是 id**） |

不变量保持（AGENTS.md 同约束）：conflict 新发现按 fingerprint 去重不复活已决项（除非侧文本实际变了）；decision 必有 reason；pending 双边不进产物。

---

## 10. daemon / Web（M5）

```
serve.js --daemon: 读 config→端口 0 起 node:http→写 daemon.json{pid,port,token}
api.js: 全 API 校验 Authorization: Bearer <token>（URL token 仅一次性换取 cookie/session）
  GET  /api/state        → hub+scan+conflicts+decisions 汇总（文件读，无内存真理）
  GET  /api/skills/:name → show 数据
  GET  /api/conflicts    → 队列+evidence 路径
  POST /api/decide       → lib/decide.js 写盘
  POST /api/install|update|resolve → 长任务：spawn 内部 job，SSE 推进度
  GET  /api/events       → SSE（last-event-id 重连续播）
  GET  /*                → public/ 静态（setup/install-matrix/conflicts/review 四屏）
idle: 最后活动时间 > config.daemon.idle_minutes(30) 自退
```

CLI 接管表（daemon.ensureDaemon+openURL）：`merge resolve conflicts install--to targets diff--semantic upgrade init--ui`；`--cli` 绕过；非 TTY 永不触发。

SPA 无构建：单 `app.js` fetch API 渲染（M5 时可用 AI 生成 UI，接口按上表钉死先写）。

---

## 11. 测试策略

**unit（node:test，`test/client/*.test.js`）**：
- `ref.test.js`：§6 每种输入形态
- `scanner.test.js`：fixture HOME 目录造四种状态 + env override + 共享目录去重
- `treehash.test.js`：确定性、目录名无关、内容变动敏感
- `audit.test.js`：每条规则正/负样本、verdict 归并、strip 行为
- `library/lock.test.js`：schema 往返、原子写
- `conflicts.test.js`：fingerprint 去重、pending 排除、decision supersedes
- `ref-parse.test.js`：corp: 前缀、@ref、--path、git URL

**e2e（`test/client/e2e.test.js`）**：`SKILLMKT_HOME=<tmp>` + `HOME=<tmp fixture>` 全程不动真目录：
- `install ./skill`（本仓夹具）→ assert 落 hub+library+lock+投影
- `install <tmp>/external-skill`（在假 harness 目录下）→ 收编流断言 adopted_from
- `remove` → .trash 存在 + `--purge` 不存在
- `sync --dry-run` 造漂移 → exit4
- `download`→cache→`install` 命中缓存
- `conflicts`/`decide`/`build` 闭环（静态 extract 兜底，无 LLM）
- 别名 + `--json` 纯度（stdout 可 `JSON.parse`）

**真机冒烟（手动，不进 CI）**：`init` 探 8001 出 Ornith → `install ~/.codex/skills/whalechan-image-character` → `search design --remote` → `install vercel-labs/agent-skills --path web-design-guidelines` → `conflicts` → `merge`+`build` → `resolve --ui` 开面板。

**CI**：`npm test` + `node pipeline/validate.js` + `node pipeline/build.js --check`——**零 LLM、零网络**（e2e 里网络调用全部 mock/skip）。

---

## 12. 开发顺序（每步可验证）

| # | 批次 | 验证点 |
|---|---|---|
| 1 | package.json 改造 + bin 骨架 + ctx/hub/scanner | `skillmkt doctor`/`list`（空 hub+真 harness 探测）跑通 |
| 2 | package/audit/ref + github+skillssh adapter + install/remove/targets/sync | `install ./skill`+`install owner/repo --path`+收编+e2e |
| 3 | config/init/render + search/list/show | `init` 全流程（含 LLM 探测+冒烟）+ dashboard |
| 4 | state + update/outdated/upgrade/download/diff/rollback + rfc + registry cmd | apt 四件套 e2e + exit4 |
| 5 | extract/conflicts/decide/resolve/mergebuild | 静态引擎闭环：`conflicts`→`decide`→`build` |
| 6 | llm.js + arbitrate + evidence（设计域）+ 语义 diff/audit | 真 Ornith 联调 `--llm`/`--semantic` |
| 7 | daemon.js + serve/ 四屏 + CLI 接管 | `resolve --ui` 开页裁决落盘 |
| 8 | npm publish + README 补 npmmirror/镜像说明 | `npm i -g awesome-skill-market` 真装回测 |

依赖关系：1→2→3 是地基可连做；4 依赖 2；5 依赖 1+hub 数据；6 依赖 5；7 依赖 3+5；8 最后。

---

## 13. 发布与已知边界

- `npm publish --access public`（包名 skillmkt）；README 增国内段：`--registry=https://registry.npmmirror.com` 装本体 + `SKILLMKT_SEARCH_API` 镜像说明
- 版本号 0.x 起步；`files` 白名单防误发 pipeline 全套（只带 lib/）
- **不进 CI**：LLM、网络、真 HOME 目录——三条都 mock/env 隔离
- 二期清单：clawhub 适配器（spec/实例已备）、iflytek/modelscope/gitee 源、自建反代 VPS、MCP/Tauri、共享 decisions 联邦
- 已知不保证：Windows symlink（默认路径不依赖）、非英文 harness 目录变体（env override 兜底）、windsurf 仅探测
