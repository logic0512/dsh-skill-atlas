<p align="center">
  <img src="./assets/readme/hero.svg" width="100%" alt="技能大全 dsh-skill-atlas — 把你电脑上所有 agent 的 skill 收进一个侧栏">
</p>

<p align="center">
  <a href="README.md">English</a> ·
  <a href="#安装">安装</a> ·
  <a href="#能保证什么不能保证什么">边界</a>
</p>

你的 skill 从来不在一个地方。Claude Code、Codex、Cursor、WorkBuddy 各存各的，几个月后就没人记得装过什么、装在哪。

这个插件把那些目录全扫一遍，把每个 `SKILL.md` 变成 DSH 侧栏里的一张卡，选中就能开新会话——**包括 DSH 自己看不见的那些**。

![侧栏截图](docs/screenshot.jpg)

## 为什么是「挑」，不是「管」

技能管理面板已经不少了。这个插件刻意**不做市场、不做安装审计、不做回收站**——那些是管理器的活。

它只回答一个问题，并且尽量答得快：**站在几百个技能面前，哪个才是现在该用的？**

- **看得见样子** —— 卡片上是真实案例图：先取技能目录里的 `assets/`、`examples/`，没有再翻来源仓库的目录树。图标、二维码、两个技能共用的横幅会被剔除——宁可不给图，也不给错图。
- **挑得动** —— 16 个能力分类按「产出什么」划，不按名字里的词；20 个 `artifact-template-*`、29 个 `seedance-*` 这类家族折成一张可展开的卡，搜索时自动展开；每张卡一句中文定位，可搜、可按分类筛、可常用优先。
- **知道边界** —— 每张卡标着 DSH 到底能不能解析到它：可解析 / 已接入 / 未接入。不猜、不说满。
- **接得上** —— 对 DSH 看不见的技能，点一下在 `~/.dsh/skills` 建软链。不复制、不改源目录、随时可撤。
- **开得了工** —— 选完直接开新会话，`/技能名` 已经在输入框里，不用再翻一次目录。

一台机器实测：13 个来源目录、456 个技能、136 份重复副本合并、16 个分类。

## 卡片上的三种状态

<p align="center">
  <img src="./assets/readme/states.svg" width="100%" alt="三种状态：DSH 可解析、已接入、未接入；接入只建软链，能解析不等于能跑">
</p>

DSH 解析 `/skill-name` 时只认自己的技能根，`~/.codex/skills` 和 `~/.claude/skills` 都不在里面。所以同一台 456 个技能的机器上，能直接解析 221 个，另外 235 个不行。对后者，详情里点一下就能在 `~/.dsh/skills` 建一个**软链**——不复制、不改源目录、随时可删。

## 能保证什么，不能保证什么

**保证**：扫描、去重、分类、记录路径、读取 `SKILL.md`、接入。这些是确定性的，跟你的环境无关。

**不保证**：调用了就一定跑得通。取决于三件事：

1. 在不在 DSH 的技能根里 —— 这一件插件能帮你做
2. 它有没有外部依赖 —— API key、CLI 工具、依赖包、第三方账号或登录态。这些写在 `SKILL.md` 里，插件不读也不配
3. 你配没配

真实例子：`seedance-20` 系列要 Seedance 的 key，`playwright-scraper-skill` 要 Chromium，`xiaohongshu-ops` 要已登录的浏览器 profile。**能不能解析**和**依赖配没配**，是两件事。

所以这个插件只回答一个问题：**你机器上到底有哪些技能、在哪个目录、大概干什么。**

## 安装

```sh
dsh plugin --profile web add github:logic0512/dsh-skill-atlas
```

把 `web` 换成你的 profile 名。桌面版：**插件 → 添加插件**，粘贴 `github:logic0512/dsh-skill-atlas`，然后重启 Harness 进程。

## 可选：自己的目录文件

插件不自带任何技能数据。默认按关键词分类；中文定位、准确分类、案例图由你自己定，放在 `$DSH_HOME/skill-atlas/catalog.json`：

```json
[{
  "name": "guizang-ppt-skill",
  "category": "deck",
  "zh": "做横向翻页网页 PPT：电子杂志或瑞士风，带讲者视图与讲稿",
  "repo": "https://github.com/op7418/guizang-ppt-skill",
  "samples": ["/Users/me/.dsh/skill-atlas/samples/guizang-ppt-skill/0.png"]
}]
```

格式与做法见 [docs/CATALOG.md](docs/CATALOG.md)，里面写了三个坑：名字像视频其实是分析、图标和二维码冒充案例图、两个技能共用一张封面。

## 安全边界

扫描全程只读。只有三个动作会写盘：

| 动作 | 动了什么 |
|---|---|
| 接入 / 断开 | `~/.dsh/skills` 里的一个软链；删除前会核对它确实指向这个技能 |
| 停用 / 启用 | 改写 `SKILL.md` 的 `disable-model-invocation`，改前先存 `SKILL.md.atlas-bak` |
| 检查更新 / 更新 | 先 `git fetch` 再 `git pull --ff-only`，仓库有未提交改动时直接拒绝 |

所有接口都先校验 id 是否在扫描结果里，未知 id 一律 404，不存在任意路径读取；样例图有大小上限，只接受 png/jpg/webp/gif。

## 开发

没有构建步骤，客户端是纯 `React.createElement`，由宿主通过 `__ModuleLoader__` 注入 react。

```sh
node --check index.js && node --check client.js
node test/host-smoke.mjs      # 跑在临时 DSH_HOME 里，不碰真实数据
```

```
index.js                宿主：扫描、分类、git、/skill-atlas/* 路由
client.js               浏览器：侧栏入口、卡片、浮层
cordis.patch.yml        bundle 挂载点
assets/readme/          hero 与 states 的 SVG（中英各一套）
tools/dump-catalog.mjs  把当前扫描导出成目录骨架
docs/CATALOG.md         目录格式与做法
```

## 许可

MIT
