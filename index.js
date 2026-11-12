// dsh-skill-atlas 半片一：技能扫描、分类、版本信息与 /skill-atlas/* 接口。
//
// 设计原则：
// 1. 只读扫描，写操作一律走显式动作（装到工作区 / 启停 / git pull），且每一处都先校验。
// 2. 客户端只传 id，真实路径由 host 的扫描结果解析，避免路径穿越。
//
// 路由一览：
//   GET  /skill-atlas/list?refresh=1   -> 技能卡片 + 工作区 + 分类计数
//   GET  /skill-atlas/file?id=<id>     -> 单个技能的 SKILL.md 原文
//   POST /skill-atlas/refresh          -> 丢弃缓存重新扫描
//   POST /skill-atlas/toggle           -> 启用 / 停用（改写 frontmatter）
//   POST /skill-atlas/install          -> 装到某个工作区的 .dsh/skills
//   POST /skill-atlas/uninstall        -> 从工作区移除（只动自己建的链接/副本）
//   POST /skill-atlas/git/check        -> fetch 后看落后几个提交
//   POST /skill-atlas/git/pull         -> fast-forward 更新
//   POST /skill-atlas/reveal           -> 在访达里显示技能目录

import { execFile } from 'node:child_process'
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, extname, join } from 'node:path'

const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const HOME = homedir()
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'lib', 'assets', 'references', 'scripts', 'locale', '.trash'])

// ---------------------------------------------------------------- 基础工具

/** 可选的分类覆盖：~/.dsh/skill-atlas.json 里写 {"categories": {"技能名": "分类 id"}}。 */
function readOverrides() {
  try {
    const raw = JSON.parse(readFileSync(join(DSH_HOME, 'skill-atlas.json'), 'utf8'))
    return raw && typeof raw.categories === 'object' && raw.categories ? raw.categories : {}
  } catch {
    return {}
  }
}

function listDirs(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter(e => e.isDirectory() || e.isSymbolicLink())
      .map(e => join(dir, e.name))
  } catch {
    return []
  }
}

function safeRealpath(p) {
  try { return realpathSync(p) } catch { return null }
}

function git(cwd, args, timeout = 6000) {
  return new Promise(resolve => {
    execFile('git', ['-C', cwd, ...args], { timeout, maxBuffer: 2_000_000 }, (err, stdout) => {
      resolve(err ? null : String(stdout).trim())
    })
  })
}

/**
 * 从 dir 往上找最近的 .git。
 * 必须跳过 $HOME：很多人把家目录本身做成了 dotfiles 仓库，
 * 否则每个技能都会被误判成“可更新”，版本信息就全错了。
 */
function findRepoRoot(dir) {
  let cur = dir
  for (let i = 0; i < 6; i += 1) {
    if (cur === HOME) return null
    if (existsSync(join(cur, '.git'))) return cur
    const parent = dirname(cur)
    if (parent === cur) break
    cur = parent
  }
  return null
}

// ---------------------------------------------------------------- frontmatter

function foldLines(lines) {
  let s = lines.join(' ').trim()
  s = s.replace(/^[>|][+-]?[ \t]*/, '')
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) s = s.slice(1, -1)
  return s.trim()
}

/** 解析 SKILL.md 的 YAML frontmatter（只取顶层标量，够用且不引依赖）。 */
export function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/.exec(text)
  if (!m) return { data: {}, body: text, hasFrontmatter: false }
  const data = {}
  let key = null
  let buf = []
  const flush = () => {
    if (key) data[key] = foldLines(buf)
    key = null
    buf = []
  }
  for (const line of m[1].split(/\r?\n/)) {
    if (key && /^[ \t]+\S/.test(line)) { buf.push(line.trim()); continue }
    const kv = /^([A-Za-z0-9_.-]+)[ \t]*:[ \t]?(.*)$/.exec(line)
    if (kv) { flush(); key = kv[1]; buf = kv[2] ? [kv[2]] : [] } else if (key) buf.push(line.trim())
  }
  flush()
  return { data, body: text.slice(m[0].length), hasFrontmatter: true }
}

function isDisabled(data) {
  const v = String(data['disable-model-invocation'] ?? '').toLowerCase()
  return v === 'true' || v === 'yes' || v === '1'
}

// ---------------------------------------------------------------- 分类

// 分类表：16 类，按"产出什么"划分，不按名字里有什么词。
const CATEGORIES = [
  { id: 'deck', label: '幻灯片 / 演示', re: /slide|deck|presentation|keynote|ppt|演示|幻灯片/i },
  { id: 'video', label: '视频 / 动效', re: /video|motion|remotion|animat|film|视频|动效|分镜|storyboard|口播/i },
  { id: 'audio', label: '音频 / 语音', re: /audio|voice|tts|speech|music|sound|音频|配音|语音|转写/i },
  { id: 'image', label: '图像 / 视觉', re: /image|photo|poster|cover|illustration|图像|图片|海报|配图|插画|生图/i },
  { id: 'design', label: '设计 / 前端', re: /design|ui|ux|frontend|css|figma|prototype|3d|设计|原型|前端|网页/i },
  { id: 'doc', label: '办公文档', re: /docx|word|xlsx|excel|pdf|sheet|documents|文档|表格|简历|演示文件/i },
  { id: 'writing', label: '写作 / 内容', re: /writ|article|blog|copy|content|newsletter|文案|写作|文章|公众号|小红书|知乎/i },
  { id: 'data', label: '数据 / 研究', re: /data|analys|research|scrap|crawl|search|调研|数据|分析|检索|爬/i },
  { id: 'game', label: '游戏开发', re: /game|godot|unity|unreal|roblox|phaser|pixi|pygame|love2d|shader|游戏/i },
  { id: 'code', label: '编码 / 工程', re: /code|refactor|debug|lint|test|git|api|backend|代码|重构|测试|调试/i },
  { id: 'agent', label: 'Agent / 技能工程', re: /agent|plugin|prompt|mcp|harness|orchestr|智能体|插件|工作流/i },
  { id: 'ops', label: '运维 / 部署', re: /deploy|docker|k8s|server|ci\/cd|部署|运维|监控/i },
  { id: 'platform', label: '平台 / 工具集成', re: /api|drive|browser|download|connector|平台|下载|接口/i },
  { id: 'career', label: '求职 / 简历', re: /resume|job|interview|offer|salary|career|简历|面试|求职|薪资/i },
  { id: 'thinking', label: '思维 / 提示语', re: /prompt|reason|think|frame|thinking|思维|提示语|分析框架/i },
]
const MISC = { id: 'misc', label: '其他' }

export function categorize(name, description) {
  const lead = String(description || '').slice(0, 120)
  const rest = String(description || '').slice(120)
  let best = null
  let bestScore = 0
  for (const c of CATEGORIES) {
    if (c.re.test(name)) return c
    let score = 0
    if (c.re.test(lead)) score += 2
    if (rest && c.re.test(rest)) score += 1
    if (score > bestScore) { best = c; bestScore = score }
  }
  return best || MISC
}

export function categoryList() {
  return [...CATEGORIES, MISC].map(c => ({ id: c.id, label: c.label }))
}

// ---------------------------------------------------------------- 可选的人工目录
// 本插件不内置任何技能数据。如果你愿意逐条读过 SKILL.md、写下中文定位和分类，
// 可以把它放在 $DSH_HOME/skill-atlas/catalog.json；扫描结果会以它为准，
// 没收录的技能退回上面的关键词判断。格式见 docs/CATALOG.md。
const CATALOG_FILE = join(DSH_HOME, 'skill-atlas', 'catalog.json')
let CATALOG = null
function loadCatalog() {
  if (CATALOG) return CATALOG
  CATALOG = new Map()
  try {
    const raw = JSON.parse(readFileSync(CATALOG_FILE, 'utf8'))
    const list = Array.isArray(raw) ? raw : raw.skills || []
    for (const entry of list) {
      if (!entry || !entry.name) continue
      CATALOG.set(entry.name, entry)
      for (const alias of entry.aliases || []) CATALOG.set(alias, entry)
    }
  } catch {
    // 没有目录文件是正常情况，不是错误
  }
  return CATALOG
}

// ---------------------------------------------------------------- 根目录

function readWorkspaces() {
  try {
    const file = join(DSH_HOME, 'storages', 'workspace.json')
    const data = JSON.parse(readFileSync(file, 'utf8'))
    const rows = data?.tables?.workspaces ?? {}
    return Object.entries(rows)
      .map(([id, v]) => ({ id, path: v?.path || '', title: v?.title || (v?.path ? basename(v.path) : id) }))
      .filter(w => w.path && existsSync(w.path))
  } catch {
    return []
  }
}

function pluginSkillDirs() {
  const out = []
  for (const profile of listDirs(join(DSH_HOME, 'profiles'))) {
    const nm = join(profile, 'node_modules')
    const entries = [...listDirs(nm)]
    for (const scope of listDirs(nm)) {
      if (!basename(scope).startsWith('@')) continue
      entries.push(...listDirs(scope))
    }
    for (const pkg of entries) {
      const dir = join(pkg, 'skills')
      if (existsSync(dir)) out.push({ id: `plugin:${basename(pkg)}`, label: `插件 · ${basename(pkg)}`, dir })
    }
  }
  return out
}

export function skillRoots(workspaces) {
  const roots = [
    { id: 'dsh-user', label: 'DSH 用户级', dir: join(DSH_HOME, 'skills') },
    { id: 'agents', label: '~/.agents', dir: join(HOME, '.agents', 'skills') },
    { id: 'codex', label: 'Codex', dir: join(HOME, '.codex', 'skills') },
    { id: 'codex-plugins', label: 'Codex 插件', dir: join(HOME, '.codex', 'plugins') },
    { id: 'claude', label: 'Claude Code', dir: join(HOME, '.claude', 'skills') },
    ...pluginSkillDirs(),
  ]
  for (const ws of workspaces) {
    roots.push({ id: `ws:${ws.id}`, label: `工作区 · ${ws.title}`, dir: join(ws.path, '.dsh', 'skills'), workspaceId: ws.id })
    roots.push({ id: `ws-agents:${ws.id}`, label: `工作区 · ${ws.title} (.agents)`, dir: join(ws.path, '.agents', 'skills'), workspaceId: ws.id })
  }
  return roots.filter(r => existsSync(r.dir))
}

/**
 * 递归找含 SKILL.md 的目录。
 * Codex 插件缓存在 5 层以下，一个技能目录里还可能套着若干子技能（如 seedance-20/），
 * 只扫一层会漏掉一百多个。
 */
function findSkillDirs(root, depth = 0, out = []) {
  if (depth > 8) return out
  let entries = []
  try { entries = readdirSync(root, { withFileTypes: true }) } catch { return out }
  if (existsSync(join(root, 'SKILL.md'))) out.push(root)
  for (const e of entries) {
    if (!e.isDirectory() && !e.isSymbolicLink()) continue
    if (e.name === 'node_modules' || e.name === '.git' || e.name === 'dist') continue
    const child = join(root, e.name)
    if (child.includes('site-packages') || child.includes('/.venv/')) continue
    findSkillDirs(child, depth + 1, out)
  }
  return out
}

// ---------------------------------------------------------------- 扫描

function readSkill(dir) {
  const file = join(dir, 'SKILL.md')
  if (!existsSync(file)) return null
  let text
  try { text = readFileSync(file, 'utf8') } catch { return null }
  const { data, body } = parseFrontmatter(text)
  const name = String(data.name || basename(dir))
  const description = String(data.description || '').replace(/\s+/g, ' ').trim()
  let bytes = 0
  let mtime = 0
  try {
    const st = statSync(file)
    bytes = st.size
    mtime = st.mtimeMs
  } catch {}
  return {
    name,
    description,
    hasFrontmatter: Boolean(data.name || data.description),
    disabled: isDisabled(data),
    body,
    bytes,
    mtime,
    descTokens: Math.ceil(description.length / 1.8),
    bodyTokens: Math.ceil(body.length / 2.6),
  }
}

export async function scan() {
  const workspaces = readWorkspaces()
  const roots = skillRoots(workspaces)

  // 第一遍：每个真实目录一条，顺便记下它出现在哪些来源。
  const byPath = new Map()
  for (const root of roots) {
    for (const dir of findSkillDirs(root.dir)) {
      const dirName = basename(dir)
      if (SKIP_DIRS.has(dirName) || dirName.startsWith('.')) continue
      const real = safeRealpath(dir) || dir
      const info = readSkill(real)
      if (!info) continue
      const existing = byPath.get(real)
      if (existing) {
        if (!existing.sources.some(s => s.id === root.id)) existing.sources.push({ id: root.id, label: root.label })
        continue
      }
      byPath.set(real, {
        id: real,
        dirName,
        path: real,
        linkPath: real === dir ? null : dir,
        workspaceId: root.workspaceId || null,
        sources: [{ id: root.id, label: root.label }],
        ...info,
      })
    }
  }

  // 第二遍：同名合并成一张卡（~/.dsh/skills 和 ~/.codex/skills 里经常是同一份技能的两份拷贝）。
  const byName = new Map()
  const catalogForAlias = loadCatalog()
  for (const entry of byPath.values()) {
    const variant = { path: entry.path, label: entry.sources[0].label, mtime: entry.mtime, bytes: entry.bytes }
    const canonical = catalogForAlias.get(entry.name)
    const key = canonical ? canonical.name : entry.name
    const cur = byName.get(key)
    if (!cur) {
      byName.set(key, { ...entry, name: key, variants: [variant] })
      continue
    }
    if (canonical && entry.name === key) {
      const sources = cur.sources
      const variants = cur.variants
      Object.assign(cur, entry, { sources, variants })
      for (const v of variants) if (!cur.variants.some(x => x.path === v.path)) cur.variants.push(v)
      continue
    }
    for (const src of entry.sources) if (!cur.sources.some(s => s.id === src.id)) cur.sources.push(src)
    cur.variants.push(variant)
    // 以最近修改的那份为准，其余保留在 variants 里可切换查看。
    if (entry.mtime > cur.mtime) {
      const sources = cur.sources
      const variants = cur.variants
      Object.assign(cur, entry, { sources, variants })
    }
  }

  // 第三遍：git 信息按仓库去重，一个仓库只 fork 一次。
  const skills = [...byName.values()]
  const byRepo = new Map()
  for (const skill of skills) {
    const repo = findRepoRoot(skill.path)
    if (!repo) continue
    if (!byRepo.has(repo)) byRepo.set(repo, [])
    byRepo.get(repo).push(skill)
  }
  await Promise.all([...byRepo.entries()].map(async ([repo, group]) => {
    const info = await gitInfo(repo)
    for (const skill of group) skill.git = info
  }))

  // DSH 自己解析 /技能名 时只认这几个根（见 dsh-skill-filesystem 的 roots()）。
  // 不在这些根里的技能，扫得到、看得到，但调不出来——需要往 ~/.dsh/skills 建一个软链。
  const DSH_ROOT = /^(dsh-user|agents|plugin:|ws:|ws-agents:)/
  const userSkillsDir = join(DSH_HOME, 'skills')
  const catalog = loadCatalog()
  const overrides = readOverrides()
  let curated = 0
  for (const skill of skills) {
    const entry = catalog.get(skill.name)
    if (entry) {
      curated += 1
      skill.category = entry.category
      skill.categoryLabel = entry.categoryLabel
      skill.zh = entry.zh || ''
      skill.samples = Array.isArray(entry.samples) ? entry.samples : []
      skill.repo = entry.repo || ''
      skill.curated = true
    } else {
      const forced = overrides[skill.name]
      const cat = forced ? (CATEGORIES.find(c => c.id === forced) || MISC) : categorize(skill.name, skill.description)
      skill.category = cat.id
      skill.categoryLabel = cat.label
      skill.zh = ''
      skill.samples = []
      skill.repo = ''
      skill.curated = false
    }
    skill.git = skill.git || null
    skill.dshReachable = skill.sources.some(x => DSH_ROOT.test(x.id))
    skill.linkedByAtlas = Boolean(skill.linkPath && dirname(skill.linkPath) === userSkillsDir)
    skill.linkTarget = join(userSkillsDir, skill.dirName)
  }

  skills.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
  const counts = {}
  for (const s of skills) counts[s.category] = (counts[s.category] || 0) + 1
  return {
    skills,
    workspaces,
    categories: categoryList().map(c => ({ ...c, count: counts[c.id] || 0 })).filter(c => c.count > 0),
    scannedAt: new Date().toISOString(),
    curated,
    total: skills.length,
    roots: roots.map(r => ({ id: r.id, label: r.label, dir: r.dir })),
  }
}

let cache = null
let cacheAt = 0
const CACHE_MS = 3000

async function listCached(force = false) {
  if (!force && cache && Date.now() - cacheAt < CACHE_MS) return cache
  cache = await scan()
  cacheAt = Date.now()
  return cache
}

async function findSkill(id) {
  if (!id) return null
  const data = await listCached()
  return data.skills.find(s => s.id === id) || null
}

// ---------------------------------------------------------------- git

async function gitInfo(root) {
  const head = await git(root, ['log', '-1', '--format=%h%x1f%cI%x1f%s'])
  if (head === null) return null
  const [hash = '', date = '', subject = ''] = String(head).split('\x1f')
  const branch = await git(root, ['rev-parse', '--abbrev-ref', 'HEAD'])
  const remote = await git(root, ['remote', 'get-url', 'origin'])
  const dirtyRaw = await git(root, ['status', '--porcelain', '-uno'])
  return {
    root,
    hash,
    date,
    subject: subject.slice(0, 120),
    branch: branch || '',
    remote: remote || '',
    dirty: Boolean(dirtyRaw && dirtyRaw.trim()),
  }
}

// ---------------------------------------------------------------- 工作区安装

function workspaceSkillsDir(ws) {
  return join(ws.path, '.dsh', 'skills')
}

async function installToWorkspace(skill, ws, mode) {
  const target = join(workspaceSkillsDir(ws), skill.dirName)
  if (existsSync(target)) return { ok: false, error: `工作区里已经有同名目录：${target}` }
  mkdirSync(dirname(target), { recursive: true })
  if (mode === 'copy') {
    cpSync(skill.path, target, { recursive: true })
    writeFileSync(join(target, '.atlas-copy.json'), JSON.stringify({ source: skill.path, at: new Date().toISOString() }, null, 2))
  } else {
    symlinkSync(skill.path, target, 'dir')
  }
  return { ok: true, target, mode: mode === 'copy' ? 'copy' : 'link' }
}

function uninstallFromWorkspace(skill, ws) {
  const target = join(workspaceSkillsDir(ws), skill.dirName)
  if (!existsSync(target)) return { ok: false, error: '工作区里没有这个技能' }
  let st
  try { st = lstatSync(target) } catch { return { ok: false, error: '无法读取目标' } }
  if (st.isSymbolicLink()) {
    rmSync(target, { force: true })
    return { ok: true, removed: 'link' }
  }
  if (existsSync(join(target, '.atlas-copy.json'))) {
    rmSync(target, { recursive: true, force: true })
    return { ok: true, removed: 'copy' }
  }
  return { ok: false, error: '这是工作区自己的一份，不是技能大全装的，没有改动它' }
}

// ---------------------------------------------------------------- 启停

function setEnabled(skill, enabled) {
  const file = join(skill.path, 'SKILL.md')
  const text = readFileSync(file, 'utf8')
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (!m) return { ok: false, error: 'SKILL.md 没有 frontmatter，无法安全改写' }
  const lines = m[1].split(/\r?\n/).filter(line => !/^disable-model-invocation\s*:/.test(line))
  if (!enabled) lines.push('disable-model-invocation: true')
  const next = `---\n${lines.join('\n')}\n---${text.slice(m[0].length)}`
  writeFileSync(`${file}.atlas-bak`, text)
  writeFileSync(`${file}.atlas-tmp`, next)
  renameSync(`${file}.atlas-tmp`, file)
  return { ok: true, enabled }
}

// ---------------------------------------------------------------- HTTP

function json(res, status, body) {
  if (status >= 400 && body && body.ok === undefined) body.ok = false
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}

async function readJson(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 1_000_000) throw new Error('请求太大')
    chunks.push(chunk)
  }
  if (!chunks.length) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function requestRejection(ctx, req) {
  const connection = ctx.get('connection')
  if (typeof connection?.requestRejection !== 'function') return 403
  return connection.requestRejection({ headers: req.headers })
}

function reveal(dir) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open'
  const args = process.platform === 'darwin' ? ['-R', dir] : [dir]
  execFile(cmd, args, () => {})
}

export const name = 'dsh-skill-atlas'

export default {
  inject: ['webServer', 'connection'],
  apply(ctx) {
    ctx.effect(() => ctx.webServer.register({
      kind: 'prefix',
      path: '/skill-atlas',
      handler: async (req, res) => {
        try {
          const rejection = requestRejection(ctx, req)
          if (rejection) { json(res, rejection, { error: '未授权' }); return }
          await route(req, res)
        } catch (err) {
          if (res.headersSent) { res.end(); return }
          json(res, err.status || 500, { error: err.message })
        }
      },
    }), 'dsh-skill-atlas: /skill-atlas routes')
  },
}

async function route(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1')
  const path = url.pathname.replace(/^\/skill-atlas/, '') || '/'
  const method = req.method || 'GET'

  if (method === 'GET' && path === '/list') {
    const data = await listCached(url.searchParams.get('refresh') === '1')
    json(res, 200, { ok: true, ...data })
    return
  }

  if (method === 'GET' && path === '/file') {
    const skill = await findSkill(url.searchParams.get('id') || '')
    if (!skill) { json(res, 404, { error: '没有这个技能' }); return }
    json(res, 200, { ok: true, id: skill.id, text: readFileSync(join(skill.path, 'SKILL.md'), 'utf8') })
    return
  }

  if (method === 'GET' && path === '/sample') {
    const skill = await findSkill(url.searchParams.get('id') || '')
    const i = Number(url.searchParams.get('i') || 0)
    const file = skill && skill.samples ? skill.samples[i] : ''
    if (!file || !existsSync(file)) { json(res, 404, { error: '没有这张样例图' }); return }
    const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' }[extname(file).toLowerCase()]
    if (!mime) { json(res, 415, { error: '不支持的图片类型' }); return }
    const buf = readFileSync(file)
    if (buf.length > 8_000_000) { json(res, 413, { error: '图片太大' }); return }
    res.statusCode = 200
    res.setHeader('content-type', mime)
    res.setHeader('cache-control', 'max-age=600')
    res.end(buf)
    return
  }

  if (method === 'GET' && path === '/workspaces') {
    json(res, 200, { ok: true, workspaces: readWorkspaces() })
    return
  }

  if (method === 'POST' && path === '/refresh') {
    const data = await listCached(true)
    json(res, 200, { ok: true, ...data })
    return
  }

  const body = method === 'POST' ? await readJson(req) : {}
  const skill = body.id ? await findSkill(body.id) : null

  if (method === 'POST' && path === '/toggle') {
    if (!skill) { json(res, 404, { error: '没有这个技能' }); return }
    const result = setEnabled(skill, Boolean(body.enabled))
    if (result.ok) await listCached(true)
    json(res, result.ok ? 200 : 400, result)
    return
  }

  if (method === 'POST' && path === '/install') {
    if (!skill) { json(res, 404, { error: '没有这个技能' }); return }
    const ws = readWorkspaces().find(w => w.id === body.workspaceId)
    if (!ws) { json(res, 404, { error: '没有这个工作区' }); return }
    const result = await installToWorkspace(skill, ws, body.mode === 'copy' ? 'copy' : 'link')
    if (result.ok) await listCached(true)
    json(res, result.ok ? 200 : 400, result)
    return
  }

  if (method === 'POST' && path === '/uninstall') {
    if (!skill) { json(res, 404, { error: '没有这个技能' }); return }
    const ws = readWorkspaces().find(w => w.id === body.workspaceId)
    if (!ws) { json(res, 404, { error: '没有这个工作区' }); return }
    const result = uninstallFromWorkspace(skill, ws)
    if (result.ok) await listCached(true)
    json(res, result.ok ? 200 : 400, result)
    return
  }

  if (method === 'POST' && path === '/git/check') {
    if (!skill) { json(res, 404, { error: '没有这个技能' }); return }
    const root = skill.git?.root || findRepoRoot(skill.path)
    if (!root) { json(res, 400, { error: '这个技能不在 git 仓库里，没有版本可更新' }); return }
    await git(root, ['fetch', '--quiet', '--prune'], 20000)
    const behind = await git(root, ['rev-list', '--count', 'HEAD..@{u}'])
    const ahead = await git(root, ['rev-list', '--count', '@{u}..HEAD'])
    if (behind === null) { json(res, 400, { error: '这个仓库没有上游分支，无法比较版本' }); return }
    json(res, 200, { ok: true, root, behind: Number(behind || 0), ahead: Number(ahead || 0) })
    return
  }

  if (method === 'POST' && path === '/git/pull') {
    if (!skill) { json(res, 404, { error: '没有这个技能' }); return }
    const root = skill.git?.root || findRepoRoot(skill.path)
    if (!root) { json(res, 400, { error: '这个技能不在 git 仓库里' }); return }
    if (skill.git?.dirty) { json(res, 400, { error: '仓库有未提交改动，为了不覆盖你的修改，先不更新' }); return }
    const out = await git(root, ['pull', '--ff-only'], 60000)
    if (out === null) { json(res, 500, { error: 'git pull 失败，可能是分支分叉或网络问题' }); return }
    await listCached(true)
    json(res, 200, { ok: true, root, output: out.split('\n').slice(-6).join('\n') })
    return
  }

  // 接入 DSH：在 ~/.dsh/skills 下建软链。不复制内容，源目录更新即生效。
  if (method === 'POST' && path === '/link') {
    if (!skill) { json(res, 404, { error: '没有这个技能' }); return }
    if (skill.dshReachable) { json(res, 200, { ok: true, message: '它已经在 DSH 的技能根里，无需接入' }); return }
    const target = skill.linkTarget
    if (existsSync(target)) {
      const real = safeRealpath(target)
      if (real === skill.path) { json(res, 200, { ok: true, message: '已经接入过了' }); return }
      json(res, 400, { error: `~/.dsh/skills 下已有同名条目：${skill.dirName}` }); return
    }
    mkdirSync(dirname(target), { recursive: true })
    symlinkSync(skill.path, target, 'dir')
    await listCached(true)
    json(res, 200, { ok: true, message: `已接入：~/.dsh/skills/${skill.dirName}` })
    return
  }

  if (method === 'POST' && path === '/unlink') {
    if (!skill) { json(res, 404, { error: '没有这个技能' }); return }
    const target = skill.linkTarget
    if (!existsSync(target)) { json(res, 400, { error: '没有接入记录' }); return }
    let st
    try { st = lstatSync(target) } catch { json(res, 400, { error: '无法读取链接' }); return }
    if (!st.isSymbolicLink()) { json(res, 400, { error: '这不是软链，不动它' }); return }
    if (safeRealpath(target) !== skill.path) { json(res, 400, { error: '这个链接指向别的技能，不动它' }); return }
    rmSync(target, { force: true })
    await listCached(true)
    json(res, 200, { ok: true, message: '已断开接入' })
    return
  }

  if (method === 'POST' && path === '/reveal') {
    if (!skill) { json(res, 404, { error: '没有这个技能' }); return }
    reveal(skill.path)
    json(res, 200, { ok: true })
    return
  }

  json(res, 404, { error: '接口不存在' })
}
