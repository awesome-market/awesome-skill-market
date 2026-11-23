// help.js — 每个命令的详细帮助（usage + 说明 + flags + 例子）；<cmd> -h/--help 触发
import { L } from './i18n.js';

const H = {
  init: {
    zh: `用法: skillmkt init
  初始化向导：探测本地 LLM 端点 → 选模型 → 勾选 skill 默认装到哪些 agent → 写 config.yml。
  裸跑 skillmkt 且未完成初始化时也会自动进这里。`,
    en: `usage: skillmkt init
  Setup wizard: probe local LLM endpoints → pick a model → choose default
  agents → write config.yml. Bare-run on an uninitialized hub lands here too.`,
  },
  config: {
    zh: `用法: skillmkt config [list] | get <键> | set <键> <值> | <键> <值>
  读写 config.yml；set 可省略（config ui.lang en 就行）。
  键示例: llm.base_url / llm.model / llm.api_key / default_targets / ui.lang
  例: skillmkt config set llm.model qwen3-32b
      skillmkt config llm.api_key env:SKILLMKT_API_KEY`,
    en: `usage: skillmkt config [list] | get <key> | set <key> <value> | <key> <value>
  Read/write config.yml; 'set' is optional (config ui.lang en works).
  Keys: llm.base_url / llm.model / llm.api_key / default_targets / ui.lang
  e.g. skillmkt config set llm.model qwen3-32b
       skillmkt config llm.api_key env:SKILLMKT_API_KEY`,
  },
  doctor: {
    zh: `用法: skillmkt doctor
  体检报告：hub 完整性、每个 agent 的 skills 目录与 skill 数、LLM 连通性、投影漂移。
  想看清 agent 探测细节就跑它。`,
    en: `usage: skillmkt doctor
  Health report: hub integrity, each agent's skills dir + skill count,
  LLM connectivity, projection drift. The fullest agent-detection view.`,
  },
  search: {
    zh: `用法: skillmkt search <关键词> [--local] [--json]
  默认只搜远端市场（skills.sh）；--local 只查本地已装/没收编的；两个 flag 都加 = 都搜。
  例: skillmkt search commit        # 远端
      skillmkt search commit --local`,
    en: `usage: skillmkt search <query> [--local] [--json]
  Remote market search (skills.sh) by default; --local searches installed/
  unmanaged skills only; both flags = both.
  e.g. skillmkt search commit        # remote
       skillmkt search commit --local`,
  },
  list: {
    zh: `用法: skillmkt list [--scan] [--json]
  列出所有 skill 及各自安装位置。默认不显示 agent 目录里没收编的散 skill——
  --scan 主动扫一遍才列出来（行首 ◌ 标记）。`,
    en: `usage: skillmkt list [--scan] [--json]
  List all skills and where each is installed. Unmanaged skills sitting in
  agent dirs are hidden by default — --scan lists them (marked ◌).`,
  },
  show: {
    zh: `用法: skillmkt show <名字> [--raw|--files|--audit]
  skill 详情（来源/版本/目标/审核）。--raw 打原始 SKILL.md；--files 列文件；
  --audit 看审核记录。三个 flag 互斥。`,
    en: `usage: skillmkt show <name> [--raw|--files|--audit]
  Skill details (source/version/targets/audit). --raw prints SKILL.md;
  --files lists files; --audit shows the audit record. Flags are exclusive.`,
  },
  install: {
    zh: `用法: skillmkt install <ref|路径|owner/repo> [--target a,b] [--dry-run]
  装 skill：拉取 → 安全审核 → 落 hub → 投影到各 agent。
  ref 语法:
    skillmkt install owner/repo                    # GitHub 仓库（默认源）
    skillmkt install owner/repo --path skills/foo  # monorepo 子目录
    skillmkt install owner/repo@v1.2.0             # 指定 tag/sha/branch
    skillmkt install owner/repo/sub/dir@v1.2.0     # skills.sh 全 slug + 版本（子目录内嵌）
    skillmkt install 'github.com/o/r/tree/v1/sub'  # 浏览器复制的 tree 页 URL 也行
    skillmkt install corp:auth-skill               # 命名 registry 前缀
    skillmkt install git@github.com:o/r.git        # git URL
    skillmkt install ./local/dir                   # 本地目录
    skillmkt install ~/.claude/skills/x            # 收编 agent 目录里没收编的
  flags:
    --target claude,codex   装到哪些 agent（默认 config 的 default_targets）
    --scope project         装进当前仓库（不进 default_targets，随仓共享）
    --to <目录>             直指路径安装（copy；--link 改 symlink）
    --yes                   非交互（可疑 skill 视为拒绝——安全默认）
    --dry-run               只演示不落地`,
    en: `usage: skillmkt install <ref|path|owner/repo> [--target a,b] [--dry-run]
  Install a skill: fetch → security audit → hub → project to agents.
  ref syntax:
    skillmkt install owner/repo                    # GitHub repo (default)
    skillmkt install owner/repo --path skills/foo  # monorepo subdir
    skillmkt install owner/repo@v1.2.0             # tag/sha/branch
    skillmkt install owner/repo/sub/dir@v1.2.0     # full skills.sh slug + version
    skillmkt install 'github.com/o/r/tree/v1/sub'  # pasted tree-page URL works too
    skillmkt install corp:auth-skill               # named registry prefix
    skillmkt install git@github.com:o/r.git        # git URL
    skillmkt install ./local/dir                   # local directory
    skillmkt install ~/.claude/skills/x            # adopt an unmanaged skill
  flags:
    --target claude,codex   which agents receive it (default: default_targets)
    --scope project         install into this repo (not default_targets)
    --to <dir>              install to an explicit path (copy; --link symlinks)
    --yes                   non-interactive (suspicious skills are refused)
    --dry-run               preview without writing`,
  },
  remove: {
    zh: `用法: skillmkt remove <名字> [--purge] [--scope project]
  卸 skill：删各 agent 目录里的投影 + hub 副本移进 .trash（可恢复）。
  --purge 连 hub 副本一起删；--scope project 只删仓库内副本、hub 保留。
  别名: uninstall / un / rm`,
    en: `usage: skillmkt remove <name> [--purge] [--scope project]
  Uninstall: delete projections from agent dirs + move hub copy to .trash
  (recoverable). --purge deletes the hub copy too; --scope project removes
  only the repo copy and keeps the hub. Aliases: uninstall / un / rm`,
  },
  targets: {
    zh: `用法: skillmkt targets [list] | add <id> | add --path <目录> <名字> | remove <id>
  安装位置矩阵：每个 skill 装到了哪些 agent；增删目标。
  add <id> 用探测到的 agent id（claude/codex/…）；--path 自定义目录。

  单个 skill 的目标：
    skillmkt targets <skill>                    # 看它装在哪些目标
    skillmkt targets <skill> add <id> [id…]     # 给它加 agent（立即投影）
    skillmkt targets <skill> remove <id> [id…]  # 给它删 agent（删副本）`,
    en: `usage: skillmkt targets [list] | add <id> | add --path <dir> <name> | remove <id>
  Install-location matrix: which agents each skill goes to; add/remove targets.
  add <id> uses a detected agent id (claude/codex/…); --path takes a dir.

  Per-skill targets:
    skillmkt targets <skill>                    # show its targets
    skillmkt targets <skill> add <id> [id…]     # add agents (projects immediately)
    skillmkt targets <skill> remove <id> [id…]  # remove agents (deletes copies)`,
  },
  sync: {
    zh: `用法: skillmkt sync [--dry-run]
  检查投影漂移并修复：把 hub 里的 skill 重新同步到各 agent 目录。
  --dry-run 只看报告不动手（会列出新探测到的 agent）。`,
    en: `usage: skillmkt sync [--dry-run]
  Check projection drift and repair: re-sync hub skills into agent dirs.
  --dry-run reports without writing (also lists newly detected agents).`,
  },
  audit: {
    zh: `用法: skillmkt audit <名字|--all> [--llm] [--allow <规则id>] [--json]
  安全审核：scripts/密钥模式/外联指令等确定性检查；--llm 追加本地模型分析。
  --allow 豁免误报规则（该 skill 的重审/升级都认；规则 id: egress-cmd 等）。
  文档里的下载型 curl 自动降级不计罪。结论词：干净 / 可疑 / 已剔除 / 恶意 / 已隔离。`,
    en: `usage: skillmkt audit <name|--all> [--llm] [--allow <rule-id>] [--json]
  Security audit: deterministic checks for scripts/secret patterns/outbound
  instructions; --llm adds local-model analysis.
  --allow suppresses a false-positive rule (sticks across re-audits/upgrades).
  Download-style curl in docs is downgraded automatically.
  Verdicts: clean / suspicious / stripped / malicious / quarantined.`,
  },
  update: {
    zh: `用法: skillmkt update [名字|--all] [--yes] [--json]
  两步：先刷新上游元数据，发现过期就列出名单让你勾选升级（回车=全升，0=都不升）。
  非 TTY / --yes 只检查不操作——outdated 看报告，upgrade 手动应用。`,
    en: `usage: skillmkt update [name|--all] [--yes] [--json]
  Two steps: refresh upstream metadata, then list outdated skills and let you
  pick which to upgrade (Enter = all, 0 = none). Non-TTY / --yes checks only —
  use outdated to report, upgrade to apply.`,
  },
  outdated: {
    zh: `用法: skillmkt outdated [名字] [--json]
  报告可用更新：本地版 vs 上游最新。不带名字看全部。`,
    en: `usage: skillmkt outdated [name] [--json]
  Report available updates: local version vs upstream latest. No name = all.`,
  },
  upgrade: {
    zh: `用法: skillmkt upgrade <名字|--all> [--dry-run]
  应用更新：拉新上游 → 重审 → 换 hub 副本（旧版进 history 可 rollback）→ 重投影。`,
    en: `usage: skillmkt upgrade <name|--all> [--dry-run]
  Apply updates: fetch upstream → re-audit → swap hub copy (old version kept
  in history for rollback) → re-project.`,
  },
  download: {
    zh: `用法: skillmkt download <owner/repo 或 skills.sh slug> [--path <子目录>]
  只拉取 + 审核进缓存，不安装。之后 install 同一个 ref 会直接命中缓存。`,
    en: `usage: skillmkt download <owner/repo or skills.sh slug> [--path <subdir>]
  Fetch + audit into cache only, no install. A later install of the same ref
  hits the cache.`,
  },
  diff: {
    zh: `用法: skillmkt diff <名字> [--ref <tag|sha>] [--semantic]
  上游对比：本地 hub 版 vs 远端最新——文件增删改的结构 diff；
  --ref 换成和指定版本比（看旧版跟你差什么）；--semantic 追加 LLM 语义解读。`,
    en: `usage: skillmkt diff <name> [--ref <tag|sha>] [--semantic]
  Upstream diff: local hub copy vs latest remote — structural file-level
  changes; --ref compares against a specific version instead of HEAD;
  --semantic adds an LLM explanation of behavioral changes.`,
  },
  rollback: {
    zh: `用法: skillmkt rollback <名字>
  回滚到升级前的版本（upgrade 会留一版历史副本；再滚更深就报错）。`,
    en: `usage: skillmkt rollback <name>
  Roll back to the pre-upgrade version (upgrade keeps one history copy;
  deeper rollback isn't stored).`,
  },
  conflicts: {
    zh: `用法: skillmkt conflicts [--json]
  冲突队列：merge/upgrade 检出的规则分歧，按 fingerprint 去重。
  裁决用 resolve/decide，生成用 build。`,
    en: `usage: skillmkt conflicts [--json]
  Conflict queue: rule disagreements found by merge/upgrade, deduped by
  fingerprint. Decide via resolve/decide, generate via build.`,
  },
  resolve: {
    zh: `用法: skillmkt resolve <冲突id>
  交互裁决单条冲突：选 A / 选 B / 编辑合并文本（$EDITOR）/ 搁置。
  非交互等价物是 decide --resolution …。`,
    en: `usage: skillmkt resolve <conflict-id>
  Interactively resolve one conflict: keep A / keep B / edit merged text
  ($EDITOR) / dismiss. Non-interactive equivalent: decide --resolution …`,
  },
  decide: {
    zh: `用法: skillmkt decide <冲突id> --resolution keep-a|keep-b|merge|dismissed --reason "…" [--custom "文本"]
  记录冲突裁决：resolution 必填 reason（决策审计溯源）；merge 需 --custom。
  例: skillmkt decide c-7f3a --resolution keep-a --reason "A 更具体"
      skillmkt decide c-9b2e --resolution merge --custom "合并后的规则" --reason "两边各取一半"`,
    en: `usage: skillmkt decide <conflict-id> --resolution keep-a|keep-b|merge|dismissed --reason "…" [--custom "text"]
  Record a conflict decision: every resolution needs a reason (audit trail);
  merge needs --custom.
  e.g. skillmkt decide c-7f3a --resolution keep-a --reason "A is more specific"
       skillmkt decide c-9b2e --resolution merge --custom "merged rule" --reason "best of both"`,
  },
  merge: {
    zh: `用法: skillmkt merge <a> <b> [更多…] [--name 名字] [--auto]
  合并 ≥2 个已管理 skill：抽规则 → 去重 → 检冲突 → 写 merged/rules.yml。
  有分歧进冲突队列由人裁决（--auto 用 LLM 自动裁易裁的）；
  裁决完跑 build 生成 SKILL.md。`,
    en: `usage: skillmkt merge <a> <b> [more…] [--name name] [--auto]
  Merge ≥2 managed skills: extract rules → dedupe → conflict-check → write
  merged/rules.yml. Disagreements queue for human decision (--auto lets the
  LLM arbitrate easy ones); run build afterwards for SKILL.md.`,
  },
  build: {
    zh: `用法: skillmkt build
  用 merged/rules.yml + 已裁决的决定生成 merged/skill-out/SKILL.md。
  未决冲突的规则不会进产物。`,
    en: `usage: skillmkt build
  Generate merged/skill-out/SKILL.md from merged/rules.yml + active
  decisions. Rules under pending conflicts never enter the output.`,
  },
  pack: {
    zh: `用法: skillmkt pack <名字> [--out <目录>]
  打包 hub 里的 skill 为可分发的目录产物。`,
    en: `usage: skillmkt pack <name> [--out <dir>]
  Package a hub skill into a distributable directory.`,
  },
  publish: {
    zh: `用法: skillmkt publish <名字> --to <registry>
  发布 skill 到已配置的 registry（先 registry add 配置）。`,
    en: `usage: skillmkt publish <name> --to <registry>
  Publish a skill to a configured registry (registry add first).`,
  },
  registry: {
    zh: `用法: skillmkt registry [list] | add --type <github|rfc|clawhub|skillssh> [--url u] [--name n] [--token env:X] | remove <名字>
  管理远端 registry：市场搜索、install 解析、publish 目标都走这里注册的适配器。`,
    en: `usage: skillmkt registry [list] | add --type <github|rfc|clawhub|skillssh> [--url u] [--name n] [--token env:X] | remove <name>
  Manage remote registries: market search, install resolution and publish
  targets all go through adapters registered here.`,
  },
  serve: {
    zh: `用法: skillmkt serve [--port <端口>] [--daemon] [--stop]
  本地 Web 面板：市场搜索/安装/合并/冲突裁决/审核/设置全可视化，启动自动开浏览器。
  --daemon 后台跑（不开浏览器）；--stop 停掉后台实例。`,
    en: `usage: skillmkt serve [--port <port>] [--daemon] [--stop]
  Local web panel: market search / install / merge / conflict decisions /
  audit / settings, opens the browser on start. --daemon runs headless in
  the background (no browser); --stop kills the background instance.`,
  },
};

export function commandHelp(name) {
  const h = H[name];
  return h ? L(h.zh, h.en) : null;
}
