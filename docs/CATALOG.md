# 自己建一份技能目录

插件本身不带技能数据。它能把技能扫出来、按关键词分类，但「中文定位」「准确的分类」「案例图」这三件事只有你自己能定——因为要看的是你的技能，以及你认不认那个分类。

这份文档说明目录文件的格式，以及一种可复现的做法。

## 放哪

```
$DSH_HOME/skill-atlas/catalog.json      # 默认是 ~/.dsh/skill-atlas/catalog.json
```

插件启动后第一次扫描时读取。改完文件点界面上的「重新扫描」，或重启进程。

没有这个文件是完全正常的，插件会退回关键词分类。

## 格式

一个数组，一条一个技能。除了 `name`，其余都可以不写。

```json
[
  {
    "name": "guizang-ppt-skill",
    "category": "deck",
    "categoryLabel": "幻灯片 / 演示",
    "zh": "做横向翻页网页 PPT：电子杂志或瑞士风，带讲者视图与讲稿",
    "repo": "https://github.com/op7418/guizang-ppt-skill",
    "samples": ["/Users/me/.dsh/skill-atlas/samples/guizang-ppt-skill/0.png"],
    "aliases": ["magazine-web-ppt"]
  }
]
```

| 字段 | 说明 |
|---|---|
| `name` | 必须和 `SKILL.md` frontmatter 里的 `name` 一致（没有 frontmatter 时用目录名） |
| `category` | 见下表；写错会归到「其他」 |
| `categoryLabel` | 展示用，不写就用分类的默认名 |
| `zh` | 一句话中文定位，建议 20–40 字，卡片只显示两行 |
| `repo` | 来源仓库，卡片上显示为「仓库」链接 |
| `samples` | 案例图绝对路径，最多取前 4 张；没有就留空数组 |
| `aliases` | 同一个技能在多处安装、`name` 不同时，把它们并到一张卡上 |

### 分类 id

`deck` 幻灯片 / `video` 视频 / `audio` 音频 / `image` 图像 / `design` 设计前端 / `doc` 办公文档 / `writing` 写作 / `data` 数据研究 / `game` 游戏 / `code` 编码 / `agent` Agent 与技能工程 / `ops` 运维 / `platform` 平台集成 / `career` 求职 / `thinking` 思维提示语 / `misc` 其他

## 做法

**1. 先导出一份骨架**

```sh
node tools/dump-catalog.mjs > /tmp/catalog.json
```

它会把当前扫描结果（名字、关键词分类、路径）导成 JSON，`zh` 留空。

**2. 逐条读，别只看名字**

这一步是整件事里唯一不能省的人工。只看名字和描述会判错，尤其是这两类：

- 名字里有 `video` 但实际是**分析/下载**：`video-downloader` 是下载器，`wechat-video-resolver` 是链接解析，`cangjie-skill` 是「把视频稿蒸馏成技能」
- 名字里有 `skill` 但实际是**别的领域**：`skill-catalog` 是技能路由表，不是造技能

判断标准是「它产出什么」，不是「名字里有什么词」。

**3. 案例图怎么来**

优先用技能目录里自带的：

```
<技能目录>/assets/*.png
<技能目录>/examples/*.png
```

其次才是仓库。直接从仓库抓会踩两个坑，这个仓库的处理方式是：

- **文件名等于技能名 → 判为产品图标，丢弃**（`google-slides.png` 这种）
- **文件名含 `qr` / `gzh` → 判为二维码，丢弃**
- **同一张图被 2 个以上技能引用 → 只留给路径最匹配的那个**（否则 `guizang-ppt-skill` 和 `magazine-web-ppt` 会顶着同一张封面）

一条都没留下的技能就别硬凑，卡片会走文字版式，这也是设计的一部分。

**4. 合并别名**

同一个技能在 `~/.dsh/skills` 和 `~/.codex/skills` 各装一份、frontmatter 名字还不一样时，用 `aliases` 合并，避免出现两张几乎一样的卡。

## 校验

```sh
node --check index.js
node test/host-smoke.mjs
```

改完目录重启插件，左栏的「已核对 N」应该等于「N / N」里的第一个数；不是的话说明有技能没进目录。
