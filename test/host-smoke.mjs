// host 半片的自测：在临时 DSH_HOME 里跑完整链路，不碰真实 ~/.dsh。
// 用法：node test/host-smoke.mjs
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync, lstatSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const ROOT = join(tmpdir(), 'atlas-smoke-' + process.pid)
const DSH = join(ROOT, 'dsh')
const WS = join(ROOT, 'ws')

mkdirSync(join(DSH, 'storages'), { recursive: true })
mkdirSync(join(DSH, 'skills', 'demo-skill'), { recursive: true })
mkdirSync(WS, { recursive: true })

writeFileSync(join(DSH, 'storages', 'workspace.json'), JSON.stringify({
  unit: { name: 'workspace', version: 2 },
  global: { initialized: true, defaultWorkspaceId: 'w1', workspaceIds: ['w1'] },
  tables: { workspaces: { w1: { path: WS, title: '测试工作区' } } },
}))

writeFileSync(join(DSH, 'skills', 'demo-skill', 'SKILL.md'), `---
name: demo-skill
description: 一个用来跑冒烟测试的示例技能，覆盖 PPT 与幻灯片场景。
---

# demo-skill
正文。
`)

process.env.DSH_HOME = DSH

const { default: plugin } = await import('../index.js')

let handler = null
const ctx = {
  get: key => (key === 'connection' ? { requestRejection: () => undefined } : undefined),
  effect: fn => fn(),
  webServer: { register: opts => { handler = opts.handler } },
}

plugin.apply(ctx)
if (typeof handler !== 'function') {
  console.error('FAIL: apply() 没有注册 webServer 路由')
  process.exit(1)
}

const server = createServer((req, res) => handler(req, res))
await new Promise(r => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}/skill-atlas`

const get = async p => (await fetch(base + p)).json()
const post = async (p, body) => (await fetch(base + p, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body || {}),
})).json()

let failures = 0
function check(label, cond, extra) {
  if (cond) console.log('  ok   ' + label)
  else { failures += 1; console.log('  FAIL ' + label + (extra ? ' -> ' + JSON.stringify(extra).slice(0, 300) : '')) }
}

const list = await get('/list')
check('GET /list 成功', list.ok === true)
check('扫到 demo-skill', list.skills.some(s => s.name === 'demo-skill'))
const demo = list.skills.find(s => s.name === 'demo-skill')
check('分类命中 幻灯片', demo && demo.category === 'deck', demo && demo.category)
check('读到工作区', list.workspaces.some(w => w.title === '测试工作区'))

const file = await get(`/file?id=${encodeURIComponent(demo.id)}`)
check('GET /file 返回原文', file.ok && file.text.includes('demo-skill'))

const install = await post('/install', { id: demo.id, workspaceId: 'w1' })
check('装到工作区', install.ok === true, install)
const target = join(WS, '.dsh', 'skills', 'demo-skill')
check('工作区里出现条目', existsSync(target))
check('默认是软链', lstatSync(target).isSymbolicLink())
check('重复装会拒绝', (await post('/install', { id: demo.id, workspaceId: 'w1' })).ok === false)

const list2 = await get('/list')
const demo2 = list2.skills.find(s => s.name === 'demo-skill')
check('安装后来源里出现工作区', demo2.sources.some(s => s.label.includes('测试工作区')), demo2.sources)

const toggle = await post('/toggle', { id: demo.id, enabled: false })
check('停用成功', toggle.ok === true, toggle)
check('frontmatter 写入 disable', readFileSync(join(DSH, 'skills', 'demo-skill', 'SKILL.md'), 'utf8').includes('disable-model-invocation: true'))
const list3 = await get('/list')
check('列表里标记为已停用', list3.skills.find(s => s.name === 'demo-skill').disabled === true)

const back = await post('/toggle', { id: demo.id, enabled: true })
check('重新启用成功', back.ok === true, back)
check('frontmatter 已清理', !readFileSync(join(DSH, 'skills', 'demo-skill', 'SKILL.md'), 'utf8').includes('disable-model-invocation'))

const uninstall = await post('/uninstall', { id: demo.id, workspaceId: 'w1' })
check('从工作区移除', uninstall.ok === true, uninstall)
check('软链已删除', !existsSync(target))

const bad = await get('/file?id=/etc/passwd')
check('未知 id 被拒绝', bad.ok === false, bad)

check('未知路由 404', (await get('/nope')).ok === false)

server.close()
rmSync(ROOT, { recursive: true, force: true })
console.log(failures ? `\n${failures} 项失败` : '\n全部通过')
process.exit(failures ? 1 : 0)
