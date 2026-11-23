# awesome-skill-market

[English](https://github.com/awesome-market/awesome-skill-market/blob/main/README.md) · **中文**

**给 AI 生成的界面去同质化。管理、合并、审核、加固你的 agent skills。** awesome-skill-market 是一个 **skill 管理器** + 自动化 **skill 合并**流水线：把最好的 agent 设计 skills——taste-skill、Hallmark、Anthropic 的 frontend-design、Vercel 的 web-design-guidelines——蒸馏成一份持续更新的 `SKILL.md`，供 Claude Code、Cursor、Codex、OpenCode、Pi、Devin 等编程 agent 使用。与其装 2–10 份规则互相打架的 skill，不如装一份每个冲突都被检出、截图、裁决过的产物。在此之上它提供本地优先的 **skill 审核**层与 **skill 安全**控制——静态注入检查、能力剥离、版本固定——覆盖你机器上的每一个 skill。仓库还附带 **`skillmkt`**（`npm i -g awesome-skill-market`）——本地优先的 CLI + 网页面板，用来搜索、安装、审核、切版本、合并*任意* agent skill。

[![npm](https://img.shields.io/npm/v/awesome-skill-market.svg)](https://www.npmjs.com/package/awesome-skill-market)
[![npm downloads](https://img.shields.io/npm/dm/awesome-skill-market.svg)](https://www.npmjs.com/package/awesome-skill-market)
[![ci](https://github.com/awesome-market/awesome-skill-market/actions/workflows/ci.yml/badge.svg)](https://github.com/awesome-market/awesome-skill-market/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![conflicts](https://img.shields.io/github/issues-search/awesome-market/awesome-skill-market?query=label%3Aconflict&label=%E4%BB%B2%E8%A3%81%E9%98%9F%E5%88%97)](https://github.com/awesome-market/awesome-skill-market/issues?q=label%3Aconflict)

## 为什么 AI 生成的界面都长一个样？

让任何编程 agent 写个落地页，得到的总是同一套：紫蓝渐变、毛玻璃卡片、Inter 字体、emoji 当图标、每个标题上面压个小眉毛标签。这种「AI slop」审美是因为所有模型都向训练数据的均值收敛。社区的解法是 **agent skills**——装满设计规则的 `SKILL.md`，把模型从默认审美里拽出来。

问题在于：最好的 skill 互相矛盾。taste-skill 全面禁渐变；ui-ux-pro-max 自带 194 套渐变色板。Hallmark 禁眉毛标签；别的指南靠它吃饭。装好几份，agent 用它最后读到的那条——slop 依旧，还多了道工序。

## awesome-skill-market 不一样在哪

> 📐 完整产品设计（管理器 + 合并器 + 审核 + 市场）：[`docs/DESIGN.md`](docs/DESIGN.md)

它不新增一家之言，而是给现有意见当**裁判**：

| 步骤 | 做什么 |
|---|---|
| `sync` | 按 SHA 固定上游 skill 仓库（`upstream.lock.json`），盯变更 |
| `extract` | 本地 LLM 把每份上游文档规整成统一规则结构（`extracted/*.yml`）——改写，不照抄 |
| `synthesize` | 分域 LLM 归并把上千条规则重写为规范集（~50 条分块递归，`SYNTH_POOL` 并发）；确定性近似去重；真正矛盾的对进 `conflicts/*.yml` |
| `arbitrate` | 独立仲裁器（fresh context）自动裁掉建议合理的冲突、驳回伪冲突，只把真价值权衡升级给人 |
| `evidence` | 模型造最小 A/B HTML 样例，Playwright 截图——让人看**渲染效果**而不是读文字 |
| `issues` | 剩余冲突每条一个 GitHub issue——规则对照表、AI 分析、截图证据、裁决指引 |
| `decide` | 人工裁决落进 `decisions/*.yml`——仓库真正的资产 |
| `build` | 重新生成 `skill/`（SKILL.md + 分域 references + 规则清单）并 bump 版本 |

待裁决的冲突把**两边都挡在产物外**——矛盾永远不会悄悄发货。

## 快速开始——两条路

### A) 只用合并好的 skill（大多数人）

不需要模型、流水线、密钥。`skill/` 就是成品——标准的 [Agent Skills](https://agentskills.io) 包（`SKILL.md` + `references/`），任何读 skill 的 agent 都能用。

**一条命令——装到它检测到的每个 agent：**

```bash
npx skills add awesome-market/awesome-skill-market -g        # 全局；加 -a claude-code codex opencode pi 可自选目标
```

**手动安装**——目录名必须是 `deslop`（要和 SKILL.md 里的 `name:` 一致）：

```bash
git clone https://github.com/awesome-market/awesome-skill-market
S=awesome-skill-market/skill

cp -r $S ~/.agents/skills/deslop          # Codex · Devin · Pi · OpenCode（都扫这个路径）
ln -sfn $PWD/$S ~/.claude/skills/deslop   # Claude Code（软链可以）
cp -r $S ~/.codex/skills/deslop           # Codex 旧路径——config.toml 里开 [features] skills = true
cp -r $S ~/.pi/agent/skills/deslop        # Pi 用户级（或 pi --skill $S）
cp -r $S ~/.config/devin/skills/deslop    # Devin 用户级
cp -r $S ~/.config/opencode/skills/deslop # OpenCode 用户级
```

| Agent | 项目目录 | 全局目录 | 备注 |
|---|---|---|---|
| Claude Code | `.claude/skills/` | `~/.claude/skills/` | 跟随软链；只扫一层 |
| Codex | `.agents/skills/` | `~/.agents/skills/` 或 `~/.codex/skills/` | **跳过软链**——用拷贝或 `npx skills add --copy` |
| OpenCode | `.opencode/skills/` | `~/.config/opencode/skills/` | 还会自动扫 `.claude/skills` 和 `.agents/skills` |
| Pi | `.pi/skills/` | `~/.pi/agent/skills/` | 也可 `pi --skill <dir>` 单次加载，`/skill:deslop` 强制启用 |
| Devin | `.devin/skills/` | `~/.config/devin/skills/` | 也扫 `~/.agents/skills`；`devin skills list` 验证 |

**加载模型：** agent 平时只花 ~100 token（frontmatter），UI 任务触发时才加载 `SKILL.md`（~14k token），相关 `references/<domain>.md` 按需加载——永远不吃全量。

`git pull` + 重新拷贝即更新（软链安装的免维护）。生成的 skill 每条规则都带 `sources` 出处。

### B) 自己跑流水线（自托管）

```bash
git clone https://github.com/awesome-market/awesome-skill-market && cd awesome-skill-market
npm run setup            # 依赖 + Playwright chromium
cp .env.example .env     # 按下表配置
gh auth login            # 需要 issue + push 权限
npm run daemon           # 前台循环：sync→extract→merge→evidence→issues→poll→build→push
```

`.env` 配置项：

| 变量 | 作用 |
|---|---|
| `OMLX_BASE_URL` / `OMLX_API_KEY` / `OMLX_MODEL` | 任意 OpenAI 兼容 chat 端点——本地（omlx、llama.cpp、vLLM、Ollama）或托管均可 |
| `GITHUB_REPO` | **你自己的仓库**（`you/awesome-skill-market`）——冲突 issue 提到这里 |
| `GITHUB_BRANCH` | `main` |
| `DAEMON_INTERVAL_MIN` | 循环间隔，默认 30 分钟 |

循环变体：`npm run once`（单轮）· `npm run once -- --no-llm`（跳过模型步骤；照样收割 issue 投票并重建）。改 `config/upstreams.json` 换上游。手动分步：`npm run synthesize`（增量——按 digest 跳过未变域；`--domain color` 单域）· `node pipeline/arbitrate.js`（自动裁决 pending 冲突）· `SYNTH_POOL=2 npm run synthesize`（降 LLM 并发）。

## 和直接装 taste-skill / Impeccable / Hallmark 有什么区别？

| | 单装某个 skill | awesome-skill-market |
|---|---|---|
| 规则冲突 | 运行时静默解决，每次会话随机 | 一次性裁决，留痕，人来定 |
| 规则库存 | 装上即冻结 | 每次上游提交都重抽 |
| 冲突可见性 | 不可见——你根本不知道规则打过架 | 每个冲突都是公开的、带截图的 issue |
| 覆盖面 | 一位作者的口味 | N 个上游的并集 − 被裁决的矛盾 |
| 可审计性 | 读 markdown 猜效果 | 每条规则带 `sources` 出处 + 裁决链接 |

## 架构

```
上游仓库 ─sync→ work/upstream（固定 SHA）
         ─extract→ extracted/*.yml     （LLM 规整的规则；快照入库）
         ─synthesize→ merged/rules.yml （规范集）
                  conflicts/*.yml      （pending 期间两边都不进产物）
                  auto-arbiter         （fresh-context 复核）
                  evidence/conf-*/     （A/B 样例 + 截图）
                  GitHub issues        （人工仲裁队列）
人 ─decisions/*.yml→ 裁决记录（耐久的资产）
         ─build→   skill/              （SKILL.md + references/ + 清单）
```

LLM 步骤全部跑在**本地**前台 daemon 里（`npm run daemon`，Ctrl-C 停止）。GitHub 上的 CI 只跑确定性检查：单测、YAML schema 校验、构建可复现门禁（`build --check` 对比重生成产物与已提交的 `skill/`）。

## 裁决一个冲突

**最快路径——直接在 issue 里回。** 看 A/B 截图，然后评论：

| 回复 | 效果 |
|---|---|
| `a` 或 `b` | 发货那一边（`a - 渐变毁打印样式`顺带记了理由） |
| `merge 合并后文本` | 发货你的合并版 |
| `custom 规则文本` | 发货完全自定义的规则 |

只有 owner/member/collaborator 的评论算数。daemon 每轮轮询 `conflict` 标签的 open issue，写 `decisions/conf-NNNN.yml`，评论确认，关 issue，重建 skill。

想要更完整的条目（`alternatives_rejected`、显式出处）仍可用 CLI：

```bash
npm run decide -- conf-0001 --resolution A --reason "渐变毁我们的打印样式表"
```

裁决值：`A` | `B` | `merge` | `custom`（后两个需 `--custom "合并文本"`）。`--reason` 必填——翻案要求新证据，防止仲裁来回拉锯。随时可以推翻：重新裁决即可（重开 issue 再回复，或重跑 `decide`）；`supersedes` 保留历史。

## FAQ

**它本身是反 slop 的 skill 吗？**
它是生产这种 skill 的流水线。产物（`skill/`）是一份自包含的反 AI-slop 设计 skill；仓库其余部分是让它持续合并、取证、被裁决的机器。

**为什么是本地 LLM + CI，而不是 GitHub Actions runner？**
合并调 OpenAI 兼容端点（`OMLX_BASE_URL`，如 omlx/llama.cpp/vLLM 服务）。托管 CI 够不到 `localhost`，所以 daemon 跑在模型所在处；CI 只做纯验证门禁。

**Ornith 之外的模型能用吗？**
任意 chat-completions 端点都行——设 `OMLX_BASE_URL`/`OMLX_MODEL`/`OMLX_API_KEY`。支持思考型模型（`enable_thinking` 按流水线阶段开关）。

**两个上游真的矛盾会怎样？**
两条规则都挡在产物外，开 issue 附 A/B 截图，人工裁决（`decisions/conf-NNNN.yml`）决定发哪边——或发限域合并版。

**License？** MIT。抽取的规则文本是改写的（非原文），每条合并规则都带上游 `sources` 出处。

**skillmkt 是什么？**
本仓库附带的 npm CLI（`npm i -g awesome-skill-market`，Node ≥ 22）。本地优先的 agent skill 管理器：搜公共 skill 市场（skills.sh、GitHub、私有 `.well-known/agent-skills` 源），装进 `~/.skillmkt`，安装前做供应链风险审核，投影到每个 AI 编程 agent 的 skills 目录，还能把多个 skill 合并、由人裁决矛盾。所有状态都在你机器上；可选的本地网页面板（`skillmkt serve`）自动开浏览器。

**怎么合并互相冲突的 agent skill？**
`skillmkt merge skill-a skill-b --name merged` 抽规则、去重，把真矛盾对排进 `conflicts/`。pending 冲突在网页面板或 `skillmkt resolve` 里裁决（`--auto` 可用 LLM 辅助判定），然后 `skillmkt build` 写出合并的 `SKILL.md`。待裁决的冲突两边都不进产物——矛盾永远不会悄悄发货。

**装网上的 skill 安全吗？**
skillmkt 装前跑确定性静态审核：默认剥离脚本类目录（`scripts/`、`bin/`、`hooks/`、可执行扩展名），并标记密钥模式、外联指令、提权、PII 收割。「干净」意思是没检出已知指标——不是安全保证。可疑结果需显式确认；可选 `--llm` 用本地模型端点追加语义审查。

## 链接

- 产物 skill：[`skill/SKILL.md`](skill/SKILL.md)
- 仲裁队列：[`conflict` 标签的 issues](https://github.com/awesome-market/awesome-skill-market/issues?q=label%3Aconflict)
- 上游：[taste-skill](https://github.com/Leonxlnx/taste-skill) · [hallmark](https://github.com/Nutlope/hallmark) · [frontend-design](https://github.com/anthropics/skills) · [web-design-guidelines](https://github.com/vercel-labs/agent-skills)

---

# skillmkt —— CLI

`skillmkt` 是本项目本地优先的 skill 管理器：安装/收编 skill 进 `~/.skillmkt`，装前审核，把副本投影进每个 agent 的 skills 目录，检测上游更新，带冲突队列合并 skill，一切都在本地网页面板里可审。

```bash
npm i -g awesome-skill-market          # Node ≥ 22
skillmkt doctor            # 环境自检
skillmkt search design     # skills.sh 官方 API
skillmkt install vercel-labs/agent-skills --path web-design-guidelines
skillmkt install ~/.codex/skills/my-local-skill   # 收编本地目录
skillmkt list              # 矩阵：已管理 / 外部 / 漂移
skillmkt update && skillmkt outdated            # apt 语义
skillmkt upgrade my-skill
skillmkt merge a b         # 抽规则 → 去重 → 冲突队列
skillmkt resolve --auto    # LLM 仲裁；留下的真权衡进网页
skillmkt build             # pending 冲突不进产物
skillmkt serve             # 本地网页面板（skill/冲突/审核/设置）
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

拉取回退顺序：GitHub tarball（`gh` → codeload → 镜像前缀）→ jsdelivr 逐文件。搜索回退：skills.sh 官方 `/api/search` → `SKILLMKT_SEARCH_API`/`SKILLS_API_URL` 镜像 → `gh search code filename:SKILL.md` → 仅本地库。

## LLM 功能（可选，本地优先）

语义 diff、LLM 审核、自动仲裁、合并解释可用任意 OpenAI 兼容端点——确定性操作**永远不需要**模型：

```bash
export OMLX_BASE_URL=http://localhost:8001/v1
export OMLX_MODEL=your-model
export OMLX_API_KEY=env:MY_KEY    # 只支持 env: 引用——config 里不落明文密钥
skillmkt diff my-skill --semantic
skillmkt audit --all --llm
skillmkt resolve --auto            # 高置信自动生效；真权衡留 pending
```
