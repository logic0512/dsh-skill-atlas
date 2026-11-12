#!/usr/bin/env node
// 把当前扫描结果导出成一份 catalog 骨架：名字、关键词分类、路径都在，中文定位留空。
// 用法：node tools/dump-catalog.mjs > /tmp/catalog.json
//
// 导出的分类只是关键词猜的，别直接当成品用——真正的价值在于你逐条读过 SKILL.md
// 之后填进去的 zh 和改正的 category。见 docs/CATALOG.md。

const { scan } = await import('../index.js')

const data = await scan()
const out = data.skills.map(s => ({
  name: s.name,
  category: s.category,
  categoryLabel: s.categoryLabel,
  zh: '',
  repo: s.repo || '',
  samples: s.samples || [],
  aliases: [],
}))

process.stderr.write(`导出 ${out.length} 条（已核对 ${data.curated} 条）\n`)
process.stdout.write(JSON.stringify(out, null, 2) + '\n')
