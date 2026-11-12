# 技能大全 · dsh-skill-atlas

**你电脑上的 skill，不止 DSH 里那些。**

Claude Code、Codex、Cursor、WorkBuddy 各自往自己的目录里塞技能。几百个 `SKILL.md` 散在十几个地方，装过就忘，更别说挑。

装上这个插件，它们全部汇到 DSH 左侧栏一处：**扫全 → 理清 → 看懂 → 用起来**。

![侧栏](docs/screenshot.jpg)

## 它解决什么

| | |
|---|---|
| **扫全** | `~/.dsh/skills`、`~/.agents/skills`、`~/.codex/skills`、`~/.codex/plugins`（含插件缓存与嵌套子技能）、`~/.claude/skills`、各插件自带、每个工作区的 `.dsh/skills` 与 `.agents/skills`。一台机器实测扫出 **456 个**，来自 **13 个根** |
| **理清** | 合并 136 份重复副本（同一个技能在多个目录各存一份）；按「产出什么」重排成 16 个能力分类；同前缀的大家族（20 个 `artifact-template-*`、29 个 `seedance-*`）折成一张可展开的卡，搜索时自动展开 |
| **看懂** | 每个技能一句中文定位、来源、体积、token 开销；有案例图的直接上图（幻灯片 16:9、视频海报、图片 4:5），点开可放大看多张样例 |
| **用起来** | 点「用这个技能」→ 开新会话并把 `/技能名` 预填进输入框 |

## 一个必须说清楚的事实

DSH 解析 `/技能名` 时只认这几个根（源码：`dsh-skill-filesystem` 的 `roots()`）：

```
<工作区>/.dsh/skills      <工作区>/.agents/skills
~/.dsh/skills             ~/.agents/skills
插件自带                   自定义目录
```

**`~/.codex/skills` 和 `~/.claude/skills` 不在里面。** 扫得到，不代表 DSH 调得到。

同一台 456 个技能的机器上实测：

```
可直接调用   221
需接入       235   （全在 ~/.codex 下）
```

所以卡片上有三种状态：

| 状态 | 含义 | 能做什么 |
|---|---|---|
| **DSH 可解析** | 已在 DSH 的根里 | 「用这个技能」开新会话 |
| **已接入** | 由本插件在 `~/.dsh/skills` 建了软链 | 同上，可随时「断开接入」 |
| **未接入** | 只在别的 agent 目录里 | 「接入 DSH」建一个软链 |

注意这三个状态只说**DSH 能不能解析到这个技能**，不代表它一定跑得起来——见下一节。

**接入 = 建符号链接，不是复制。** 不占空间、不改源目录、源目录更新立刻生效，删掉链接即撤销。这跟你手动往 `~/.dsh/skills` 里建软链是同一件事，只是变成一次点击。

## 我们能保证的，和不能保证的

**保证**：扫描、去重、分类、记录路径、读取 `SKILL.md`。这部分是确定性的，跟你的环境无关。

**不保证**：调用了就一定跑得通。一个技能真正跑起来取决于三件事：

1. **在不在 DSH 的技能根里** —— 这一件我们能帮你做（接入）
2. **它自己有没有外部依赖** —— API key、命令行工具、Python/Node 包、第三方账号或登录态。这些写在 `SKILL.md` 里，插件不读也不配
3. **你配没配** —— 这一步只能在你那边完成

举个真实的例子：`seedance-20` 系列要 Seedance 的 API key，`playwright-scraper-skill` 要 Chromium，`xiaohongshu-ops` 要已登录的浏览器 profile。技能在不在、能不能解析，和这些能不能用，是两件事。

所以本插件只回答一个问题：**你机器上到底有哪些技能、分别在哪个目录、大概干什么**。至于某个技能接入之后能不能成事，要看你把它的前置条件配齐了没有。

## 安装

```sh
dsh plugin --profile web add github:logic0512/dsh-skill-atlas
```

把 `web` 换成你的 profile 名。桌面版：**插件 → 添加插件**，粘贴 `github:logic0512/dsh-skill-atlas`。

装完重启 Harness 进程，左侧栏出现「技能大全」。

## 可选：自己的目录文件

插件不自带任何技能数据。它会把扫到的技能按关键词分类，但「中文定位」「准确分类」「案例图」只有你自己定得了。

把这些放在 `$DSH_HOME/skill-atlas/catalog.json`，扫描时会以它为准：

```json
[{
  "name": "guizang-ppt-skill",
  "category": "deck",
  "zh": "做横向翻页网页 PPT：电子杂志或瑞士风，带讲者视图与讲稿",
  "repo": "https://github.com/op7418/guizang-ppt-skill",
  "samples": ["/Users/me/.dsh/skill-atlas/samples/guizang-ppt-skill/0.png"]
}]
```

格式与做法见 [docs/CATALOG.md](docs/CATALOG.md)，包括三个容易踩的坑：名字像视频其实是分析、图标/二维码冒充案例图、两个技能共用一张封面。

## 安全边界

- 扫描只读，不修改任何技能目录
- 写入只有三种，全部由你手动触发：
  - **接入 / 断开**：在 `~/.dsh/skills` 建或删一个软链（删之前会核对它确实指向这个技能）
  - **停用 / 启用**：改写 `SKILL.md` 的 `disable-model-invocation`，改前先存 `SKILL.md.atlas-bak`
  - **检查更新 / 更新**：`git fetch` 后 `git pull --ff-only`，仓库有未提交改动时直接拒绝
- 所有接口都先校验 id 是否在扫描结果里，未知 id 一律 404，不存在任意路径读取
- 样例图有大小上限，只接受 png/jpg/webp/gif

## 开发

没有构建步骤，客户端是纯 `React.createElement`，由宿主通过 `__ModuleLoader__` 注入 react。

```sh
node --check index.js && node --check client.js
node test/host-smoke.mjs      # 跑在临时 DSH_HOME 里，不碰真实数据
```

冒烟测试覆盖：扫描、读取 SKILL.md、启停、接入/断开、工作区安装、未知 id 拒绝。

```
index.js              宿主：扫描、分类、git、/skill-atlas/* 路由
client.js             浏览器：侧栏入口、卡片、浮层
cordis.patch.yml      bundle 挂载点
tools/dump-catalog.mjs  把当前扫描导出成目录骨架
docs/CATALOG.md       目录格式与做法
```

## 许可

MIT
