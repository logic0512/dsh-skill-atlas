// dsh-skill-atlas 半片二：左侧栏「技能大全」入口 + 技能卡片页。
// 无构建：直接用 React.createElement，由宿主把 react 注入进 factory。
window.__ModuleLoader__.load({
  id: 'dsh-skill-atlas',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useMemo, useCallback, useRef } = React

    // 会话桥：conversation.input.left 会拿到 sessionId 和 inputActions，
    // 但侧栏整页是工作区级的、看不到会话。这里挂一个不渲染的组件把入口存下来，
    // 侧栏点「插入到对话框」时就能调 insertText 把 /技能名 放进草稿。
    let CTX = null
    const INPUTS = { map: new Map(), last: '' }

    /**
     * 真正该做的事：开一个新会话，把 /技能名 预填进输入框。
     * 宿主在 uiWorkspace.startSession 上提供这个能力（和 artifacts 插件用的是同一个口子）。
     * 拿不到宿主能力时，退回到往当前对话框插入，再不行就复制到剪贴板。
     */
    function useSkill(name) {
      const nav = CTX && typeof CTX.get === 'function' ? CTX.get('uiWorkspace') : null
      if (nav && typeof nav.startSession === 'function') {
        nav.startSession(undefined, { prompt: `/${name} `, whenDraftExists: 'append' })
        return 'session'
      }
      if (insertSkill(name)) return 'insert'
      try { navigator.clipboard.writeText(`/${name}`) } catch {}
      return 'clipboard'
    }
    function ComposerBridge(props) {
      const sessionId = (props && props.sessionId) || ''
      const actions = props && props.inputActions
      useEffect(() => {
        if (sessionId && actions && typeof actions.insertText === 'function') {
          INPUTS.map.set(sessionId, actions)
          INPUTS.last = sessionId
        }
      }, [sessionId, actions])
      return null
    }

    function insertSkill(name) {
      const actions = INPUTS.map.get(INPUTS.last)
      if (!actions || typeof actions.insertText !== 'function') return false
      const text = `/${name} `
      const ok = actions.insertText(text, actions.captureInsertion())
      return ok !== false
    }

    // 使用频次：只存本地，用来把常用的排前面
    const USAGE_KEY = 'skill-atlas-usage'
    function readUsage() {
      try { return JSON.parse(localStorage.getItem(USAGE_KEY) || '{}') || {} } catch { return {} }
    }
    function bumpUsage(name) {
      try {
        const m = readUsage()
        m[name] = (m[name] || 0) + 1
        localStorage.setItem(USAGE_KEY, JSON.stringify(m))
      } catch {}
    }

    const PANEL_ID = 'skill-atlas'
    const API = '/skill-atlas'

    // ------------------------------------------------------------ 样式

    const CSS = `
.atlas-root { display:flex; flex-direction:column; height:100%; min-height:420px; color:var(--atlas-fg,#e6e6e6); background:var(--atlas-bg,#141517); font-size:13px; }
.atlas-head { display:flex; align-items:center; gap:10px; padding:12px 16px; border-bottom:1px solid var(--atlas-line,#292b2f); flex:none; }
.atlas-title { font-size:15px; font-weight:600; letter-spacing:.02em; }
.atlas-muted { color:#8b9099; font-size:12px; }
.atlas-search { flex:1; min-width:120px; max-width:340px; }
.atlas-input { width:100%; box-sizing:border-box; padding:6px 10px; border-radius:7px; border:1px solid var(--atlas-line,#2f3237); background:#1b1d20; color:inherit; font-size:13px; outline:none; }
.atlas-input:focus { border-color:#4f7cff; }
.atlas-btn { padding:5px 11px; border-radius:7px; border:1px solid var(--atlas-line,#2f3237); background:#1f2226; color:inherit; font-size:12px; cursor:pointer; white-space:nowrap; }
.atlas-btn:hover:not(:disabled) { border-color:#4a4f57; background:#26292e; }
.atlas-btn:disabled { opacity:.45; cursor:default; }
.atlas-btn.primary { background:#2f5bd8; border-color:#2f5bd8; color:#fff; }
.atlas-btn.primary:hover:not(:disabled) { background:#3a68ec; }
.atlas-btn.danger { color:#ff8b8b; border-color:#4a2b2b; }
.atlas-body { display:flex; flex:1; min-height:0; }
.atlas-rail { width:172px; flex:none; border-right:1px solid var(--atlas-line,#292b2f); overflow:auto; padding:8px 6px; }
.atlas-rail-item { display:flex; justify-content:space-between; gap:6px; padding:6px 9px; border-radius:6px; cursor:pointer; color:#b9bec7; }
.atlas-rail-item:hover { background:#1d1f23; }
.atlas-rail-item.on { background:#23262c; color:#fff; }
.atlas-rail-count { color:#767d87; font-size:11px; }
.atlas-main { flex:1; min-width:0; display:flex; flex-direction:column; }
.atlas-grid { flex:1; overflow:auto; padding:12px 14px; column-width:238px; column-gap:10px; }
.atlas-grid > * { break-inside:avoid; margin:0 0 10px; display:flex; }
.atlas-family { border:1px dashed #3a3f47; border-radius:9px; padding:11px 12px; background:#171a1e; cursor:pointer; display:flex; flex-direction:column; gap:7px; }
.atlas-family:hover { border-color:#4f7cff; background:#1b1f26; }
.atlas-family-head { display:flex; align-items:baseline; gap:8px; }
.atlas-family-name { font-weight:600; font-size:13px; }
.atlas-family-count { font-size:11px; color:#8fb0ff; background:#18233d; border:1px solid #26355c; border-radius:20px; padding:1px 7px; }
.atlas-family-list { color:#8f959e; font-size:11.5px; line-height:1.6; display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; }
.atlas-family-foot { margin-top:auto; display:flex; gap:5px; flex-wrap:wrap; }
.atlas-family.on { border-style:solid; border-color:#4f7cff; }
.atlas-frame { position:relative; width:100%; height:134px; overflow:hidden; background:#0d0e10; flex:none; }
.atlas-card.tall .atlas-frame { height:296px; }
.atlas-frame .atlas-cover { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; display:block; margin:0; border-radius:0; }
.atlas-shade { position:absolute; inset:0; background:linear-gradient(180deg,rgba(0,0,0,0) 42%,rgba(0,0,0,.86) 100%); }
.atlas-overlay { position:absolute; left:10px; right:10px; bottom:8px; font-size:13px; font-weight:600; text-shadow:0 1px 8px rgba(0,0,0,.8); }
.atlas-play { position:absolute; inset:0; display:grid; place-items:center; font-size:24px; color:rgba(255,255,255,.88); text-shadow:0 2px 14px rgba(0,0,0,.75); pointer-events:none; }
.atlas-card-body { padding:10px 11px 12px; display:flex; flex-direction:column; gap:6px; flex:1; }
.atlas-modal { position:fixed; inset:0; z-index:80; display:flex; align-items:center; justify-content:center; padding:26px; background:rgba(6,7,9,.86); backdrop-filter:blur(8px); }
.atlas-modal-in { width:min(1180px,100%); height:min(760px,calc(100vh - 52px)); display:grid; grid-template-columns:1.3fr .95fr; background:#17191c; border:1px solid #34383f; border-radius:16px; overflow:hidden; box-shadow:0 30px 90px rgba(0,0,0,.65); }
.atlas-media { background:#0b0c0e; display:flex; flex-direction:column; min-height:0; }
.atlas-big { flex:1; min-height:0; width:100%; object-fit:contain; padding:12px; box-sizing:border-box; display:block; }
.atlas-media-empty { flex:1; display:grid; place-items:center; color:#6b727d; font-size:13px; text-align:center; line-height:2; padding:24px; }
.atlas-thumbs { display:flex; gap:8px; padding:0 12px 12px; overflow:auto; flex:none; }
.atlas-info { padding:18px 20px; overflow:auto; display:flex; flex-direction:column; gap:12px; min-height:0; border-left:1px solid #24272c; }
.atlas-samples { display:grid; grid-template-columns:repeat(3,1fr); gap:6px; }
.atlas-thumb { width:64px; height:48px; object-fit:cover; border-radius:5px; border:1px solid #2a2d33; background:#101215; flex:none; opacity:.55; cursor:pointer; }
.atlas-thumb.on { opacity:1; border-color:#4f7cff; }
.atlas-card { width:100%; border:1px solid var(--atlas-line,#2a2d32); border-radius:10px; padding:10px 11px; background:#191b1e; cursor:pointer; display:flex; flex-direction:column; gap:6px; min-height:104px; }
.atlas-card.media { padding:0; overflow:hidden; }
.atlas-card.k-plain { min-height:128px; }
.atlas-card.media { }
.atlas-card.media.tall { }
.atlas-family { min-height:150px; }
.atlas-card:hover { border-color:#3d434c; background:#1d1f23; }
.atlas-card.on { border-color:#4f7cff; box-shadow:0 0 0 1px #4f7cff inset; }
.atlas-card-name { font-weight:600; font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.atlas-card-desc { color:#8f959e; font-size:12px; line-height:1.5; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
.atlas-card-foot { margin-top:auto; display:flex; flex-wrap:wrap; gap:4px; align-items:center; }
.atlas-chip { font-size:10px; padding:1px 6px; border-radius:20px; background:#24272c; color:#9aa1ab; border:1px solid #2e3238; white-space:nowrap; }
.atlas-chip.hot { background:#2a2416; color:#e0b64a; border-color:#453a1c; }
.atlas-chip.off { background:#2b1d1d; color:#e08a8a; border-color:#48302f; }
.atlas-chip.green { background:#16281f; color:#6fce9a; border-color:#25402f; }
.atlas-chip.amber { background:#2a2416; color:#e0b64a; border-color:#453a1c; }
.atlas-chip.git { background:#1b2a22; color:#7fc9a0; border-color:#274034; }
.atlas-drawer { width:392px; flex:none; border-left:1px solid var(--atlas-line,#292b2f); display:flex; flex-direction:column; min-height:0; background:#17191c; }
.atlas-drawer-head { padding:12px 14px; border-bottom:1px solid var(--atlas-line,#292b2f); flex:none; }
.atlas-drawer-body { flex:1; overflow:auto; padding:12px 14px; display:flex; flex-direction:column; gap:12px; }
.atlas-kv { display:grid; grid-template-columns:78px 1fr; gap:4px 10px; font-size:12px; }
.atlas-kv dt { color:#7d848e; }
.atlas-kv dd { margin:0; color:#c8cdd4; word-break:break-all; }
.atlas-actions { display:flex; flex-wrap:wrap; gap:6px; }
.atlas-note { font-size:11px; line-height:1.6; color:#8b9099; background:#1b1d21; border:1px solid #26292e; border-radius:7px; padding:8px 10px; }
.atlas-note.ok { color:#8fd6ae; border-color:#26402f; background:#182420; }
.atlas-note.err { color:#f0a1a1; border-color:#452b2b; background:#231a1a; }
.atlas-pre { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:11.5px; line-height:1.6; white-space:pre-wrap; word-break:break-word; background:#121417; border:1px solid #24272c; border-radius:7px; padding:10px; max-height:340px; overflow:auto; color:#b9c0c9; }
.atlas-empty { margin:auto; color:#767d87; font-size:13px; padding:40px; text-align:center; }
.atlas-row { display:flex; gap:6px; align-items:center; flex-wrap:wrap; }
.atlas-select { padding:5px 8px; border-radius:7px; border:1px solid var(--atlas-line,#2f3237); background:#1b1d20; color:inherit; font-size:12px; }
.atlas-toast { position:absolute; right:18px; bottom:16px; max-width:420px; z-index:20; }
.atlas-badge { font-size:10px; color:#767d87; }
`

    function ensureStyle() {
      if (typeof document === 'undefined') return
      if (document.querySelector('style[data-atlas-css]')) return
      const tag = document.createElement('style')
      tag.dataset.atlasCss = '1'
      tag.textContent = CSS
      document.head.appendChild(tag)
    }

    // ------------------------------------------------------------ 数据

    function api(path, body) {
      const init = body
        ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
        : { method: 'GET' }
      return fetch(`${API}${path}`, init).then(async res => {
        const text = await res.text()
        let data
        try { data = JSON.parse(text) } catch { data = { ok: false, error: text.slice(0, 200) } }
        if (!res.ok && data.ok !== false) data.ok = false
        return data
      }).catch(err => ({ ok: false, error: String(err && err.message || err) }))
    }

    function bytes(n) {
      if (!n) return ''
      if (n < 1024) return `${n} B`
      if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
      return `${(n / 1024 / 1024).toFixed(1)} MB`
    }

    function shortPath(p) {
      if (!p) return ''
      return p.replace(/^\/Users\/[^/]+\//, '~/')
    }

    // ------------------------------------------------------------ 页头

    function Icon(props) {
      const size = (props && props.size) || 18
      return h('svg', { width: size, height: size, viewBox: '0 0 16 16', 'aria-hidden': 'true', fill: 'none', stroke: 'currentColor', strokeWidth: 1.3 },
        h('rect', { x: 1.6, y: 1.6, width: 5.4, height: 5.4, rx: 1.2 }),
        h('rect', { x: 9, y: 1.6, width: 5.4, height: 5.4, rx: 1.2 }),
        h('rect', { x: 1.6, y: 9, width: 5.4, height: 5.4, rx: 1.2 }),
        h('rect', { x: 9, y: 9, width: 5.4, height: 5.4, rx: 1.2 }))
    }

    // ------------------------------------------------------------ 卡片

    // 三类三种版式：幻灯片区看版面（16:9 封面优先）、视频看调性（海报 + 播放态）、
    // 图片看画面（4:5 大图）。没有样例的一律走文字卡，不硬凑。
    function Card(props) {
      const s = props.skill
      const git = s.git
      const has = Boolean(s.samples && s.samples.length)
      const kind = has ? s.category : 'plain'
      const overlayTitle = has && (s.category === 'deck' || s.category === 'video')
      const tall = has && s.category === 'image'

      const chips = [
        h('span', { key: 'c', className: 'atlas-chip' }, s.categoryLabel),
        s.variants.length > 1 ? h('span', { key: 'v', className: 'atlas-chip' }, `${s.variants.length} 份`) : null,
        has ? h('span', { key: 's', className: 'atlas-chip hot' }, `${s.samples.length} 张样例`) : null,
        git ? h('span', { key: 'g', className: 'atlas-chip git' }, `${git.hash}${git.dirty ? '*' : ''}`) : null,
        s.disabled ? h('span', { key: 'd', className: 'atlas-chip off' }, '已停用') : null,
        s.dshReachable
          ? h('span', { key: 'r', className: 'atlas-chip green' }, s.linkedByAtlas ? '已接入' : '可直接调用')
          : h('span', { key: 'r', className: 'atlas-chip amber' }, '未接入'),
        s.workspaceId ? h('span', { key: 'w', className: 'atlas-chip hot' }, '工作区') : null,
      ].filter(Boolean)

      return h('div', {
        className: `atlas-card k-${kind}${tall ? ' tall' : ''}${has ? ' media' : ''}${props.active ? ' on' : ''}`,
        onClick: () => props.onSelect(s),
        title: s.zh || s.name,
      },
        has ? h('div', { className: 'atlas-frame' },
          h('img', {
            className: 'atlas-cover', loading: 'lazy', alt: '', src: `${API}/sample?id=${encodeURIComponent(s.id)}&i=0`,
            onError: e => { const f = e.target.parentNode; if (f) f.style.display = 'none' },
          }),
          overlayTitle ? h('div', { className: 'atlas-shade' }) : null,
          overlayTitle ? h('div', { className: 'atlas-overlay' }, s.name) : null,
          s.category === 'video' ? h('div', { className: 'atlas-play' }, '▶') : null,
        ) : null,
        h('div', { className: 'atlas-card-body' },
          overlayTitle ? null : h('div', { className: 'atlas-card-name' }, s.name),
          h('div', { className: 'atlas-card-desc' }, s.zh || s.description || '（没有中文定位）'),
          h('div', { className: 'atlas-card-foot' }, chips)))
    }

    // ------------------------------------------------------------ 放大查看

    function Modal(props) {
      const { skill, onClose, onChanged } = props
      const [text, setText] = useState('')
      const [busy, setBusy] = useState('')
      const [note, setNote] = useState(null)
      const [behind, setBehind] = useState(null)
      const [idx, setIdx] = useState(0)

      useEffect(() => {
        let alive = true
        setText('')
        setNote(null)
        setBehind(null)
        setIdx(0)
        api(`/file?id=${encodeURIComponent(skill.id)}`).then(r => {
          if (!alive) return
          setText(r.ok ? (r.text || '') : `读取失败：${r.error || '未知错误'}`)
        })
        return () => { alive = false }
      }, [skill.id])

      useEffect(() => {
        const onKey = e => { if (e.key === 'Escape') onClose() }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
      }, [onClose])

      async function run(label, fn) {
        setBusy(label)
        setNote(null)
        try {
          const r = await fn()
          if (r && r.ok) setNote({ kind: 'ok', text: r.message || '完成' })
          else setNote({ kind: 'err', text: (r && r.error) || '操作失败' })
          if (r && r.ok && onChanged) onChanged()
          return r
        } finally { setBusy('') }
      }

      const toggle = () => run('toggle', async () => {
        const r = await api('/toggle', { id: skill.id, enabled: skill.disabled })
        return r.ok ? { ok: true, message: r.enabled ? '已启用，下一轮会话生效' : '已停用，模型不再看到它' } : r
      })
      const check = () => run('check', async () => {
        const r = await api('/git/check', { id: skill.id })
        if (r.ok) setBehind(r)
        return r.ok ? { ok: true, message: r.behind > 0 ? `上游有 ${r.behind} 个新提交` : '已是最新' } : r
      })
      const pull = () => run('pull', async () => {
        const r = await api('/git/pull', { id: skill.id })
        return r.ok ? { ok: true, message: `更新完成\n${r.output || ''}` } : r
      })

      const skillName = skill.dirName || skill.name
      const doUse = () => {
        const how = useSkill(skillName)
        bumpUsage(skill.name)
        if (how === 'session') { onClose(); return }
        else if (how === 'insert') setNote({ kind: 'ok', text: `已插入到当前对话：/${skillName}` })
        else setNote({ kind: 'err', text: '宿主没有提供开新会话的能力，已复制到剪贴板，粘到对话框即可' })
      }
      const doLink = () => run('link', async () => {
        const r = await api('/link', { id: skill.id })
        return r.ok ? { ok: true, message: r.message || '已接入 DSH' } : r
      })
      const doUnlink = () => run('unlink', async () => {
        const r = await api('/unlink', { id: skill.id })
        return r.ok ? { ok: true, message: r.message || '已断开接入' } : r
      })

      const doInsert = () => {
        if (insertSkill(skillName)) {
          bumpUsage(skill.name)
          setNote({ kind: 'ok', text: `已把 /${skillName} 放进当前对话` })
        } else {
          try { navigator.clipboard.writeText(`/${skillName}`) } catch {}
          setNote({ kind: 'err', text: '没找到打开的会话，已复制到剪贴板，粘到对话框即可' })
        }
      }

      const git = skill.git
      const samples = skill.samples || []
      return h('div', {
        className: 'atlas-modal',
        onClick: e => { if (e.target === e.currentTarget) onClose() },
      },
        h('div', { className: 'atlas-modal-in' },
          h('div', { className: 'atlas-media' },
            samples.length
              ? h('img', {
                  className: 'atlas-big', alt: '',
                  src: `${API}/sample?id=${encodeURIComponent(skill.id)}&i=${idx}`,
                  onError: e => { e.target.style.display = 'none' },
                })
              : h('div', { className: 'atlas-media-empty' },
                  '这个技能没有提供案例图',
                  h('br'),
                  h('span', { style: { color: '#565d67' } }, '按约定不给视觉卡，只留文字说明')),
            samples.length > 1
              ? h('div', { className: 'atlas-thumbs' },
                  samples.map((_, i) => h('img', {
                    key: i,
                    className: `atlas-thumb${i === idx ? ' on' : ''}`,
                    src: `${API}/sample?id=${encodeURIComponent(skill.id)}&i=${i}`,
                    onClick: () => setIdx(i),
                  })))
              : null),

          h('div', { className: 'atlas-info' },
            h('div', { className: 'atlas-row', style: { justifyContent: 'space-between', alignItems: 'flex-start' } },
              h('div', null,
                h('div', { style: { fontWeight: 600, fontSize: 15 } }, skill.name),
                h('div', { className: 'atlas-muted', style: { marginTop: 4 } },
                  samples.length ? `${samples.length} 张样例` : '无样例')),
              h('button', { className: 'atlas-btn', onClick: onClose }, '关闭')),

            h('div', { style: { fontSize: 13, lineHeight: 1.75, color: '#cfd4da' } }, skill.zh || skill.description || '（无描述）'),

            note ? h('div', { className: `atlas-note ${note.kind}`, style: { whiteSpace: 'pre-wrap' } }, note.text) : null,

            skill.dshReachable
              ? h('div', { className: 'atlas-row' },
                  h('button', { className: 'atlas-btn primary', onClick: doUse }, '用这个技能'),
                  h('button', { className: 'atlas-btn', onClick: doInsert }, '插入到当前对话'),
                  h('span', { className: 'atlas-muted' }, `/${skill.dirName || skill.name}`))
              : h('div', { className: 'atlas-row' },
                  h('button', { className: 'atlas-btn primary', disabled: !!busy, onClick: doLink },
                    busy === 'link' ? '接入中…' : '接入 DSH'),
                  h('span', { className: 'atlas-muted' }, '在这个技能目录建一个软链到 ~/.dsh/skills')),

            skill.dshReachable
              ? h('div', { className: 'atlas-muted', style: { marginTop: -4 } },
                  '「用这个技能」= 开新会话并预填「插入到当前对话」= 只动当前输入框')
              : h('div', { className: 'atlas-muted', style: { marginTop: -4 } },
                  '它不在 DSH 的技能根里，所以现在调不到。接入只建一个软链，不复制内容、不改源目录。'),

            h('div', { className: 'atlas-actions' },
              h('button', { className: 'atlas-btn', disabled: !!busy, onClick: () => api('/reveal', { id: skill.id }) }, '在访达中显示'),
              h('button', { className: 'atlas-btn', disabled: !!busy, onClick: toggle }, skill.disabled ? '启用' : '停用'),
              skill.linkedByAtlas ? h('button', { className: 'atlas-btn', disabled: !!busy, onClick: doUnlink }, '断开接入') : null,
              git ? h('button', { className: 'atlas-btn', disabled: !!busy, onClick: check }, busy === 'check' ? '检查中…' : '检查更新') : null,
              git && behind && behind.behind > 0 ? h('button', { className: 'atlas-btn primary', disabled: !!busy, onClick: pull }, busy === 'pull' ? '更新中…' : `更新（${behind.behind}）`) : null),

            h('dl', { className: 'atlas-kv' },
              h('dt', null, '分类'), h('dd', null, skill.categoryLabel),
              h('dt', null, '来源'), h('dd', null, skill.sources.map(x => x.label).join(' / ')),
              h('dt', null, '路径'), h('dd', null, shortPath(skill.path)),
              h('dt', null, '体量'), h('dd', null, `${bytes(skill.bytes)} · 描述 ${skill.descTokens} / 正文 ${skill.bodyTokens} tokens`),
              git ? h('dt', null, '版本') : null,
              git ? h('dd', null, `${git.branch || 'detached'} @ ${git.hash}${git.dirty ? '（有未提交改动）' : ''}`) : null,
              skill.variants.length > 1 ? h('dt', null, '其它副本') : null,
              skill.variants.length > 1
                ? h('dd', null, skill.variants.filter(v => v.path !== skill.path).map(v => shortPath(v.path)).join('\n'))
                : null),

            h('div', null,
              h('div', { className: 'atlas-muted', style: { marginBottom: 6 } }, 'SKILL.md'),
              h('pre', { className: 'atlas-pre' }, text || '读取中…')))))
    }

    // ------------------------------------------------------------ 主页面

    function Page() {
      const [state, setState] = useState({ loading: true, data: null, error: '' })
      const [query, setQuery] = useState('')
      const [category, setCategory] = useState('all')
      const [selectedId, setSelectedId] = useState('')
      const [onlySamples, setOnlySamples] = useState(false)
      const [byUsage, setByUsage] = useState(true)
      const [toast, setToast] = useState('')
      const timer = useRef(null)

      const load = useCallback((refresh) => {
        setState(s => ({ ...s, loading: true }))
        api(refresh ? '/refresh' : '/list').then(r => {
          if (r.ok) setState({ loading: false, data: r, error: '' })
          else setState({ loading: false, data: null, error: r.error || '扫描失败' })
        })
      }, [])

      useEffect(() => { ensureStyle(); load(false) }, [load])

      const reload = useCallback(() => {
        setToast('已重新扫描')
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => setToast(''), 2200)
        load(true)
      }, [load])

      const data = state.data
      const skills = data ? data.skills : []

      const shown = useMemo(() => {
        const q = query.trim().toLowerCase()
        const usage = readUsage()
        const list = skills.filter(s => {
          if (category !== 'all' && s.category !== category) return false
          if (onlySamples && !(s.samples && s.samples.length)) return false
          if (!q) return true
          const hay = `${s.name} ${s.zh || ''} ${s.description || ''}`.toLowerCase()
          return hay.includes(q)
        })
        if (!byUsage) return list
        return list.slice().sort((a, b) => (usage[b.name] || 0) - (usage[a.name] || 0) || a.name.localeCompare(b.name, 'zh-Hans-CN'))
      }, [skills, query, category, onlySamples, byUsage])

      const selected = useMemo(() => skills.find(s => s.id === selectedId) || null, [skills, selectedId])

      // 同前缀家族：seedance-* 29 个、artifact-template-* 20 个，平铺一页就是刷屏。
      const familyOf = useMemo(() => {
        const byPrefix = new Map()
        for (const s of skills) {
          const key = String(s.name).split('-')[0].toLowerCase()
          if (!byPrefix.has(key)) byPrefix.set(key, [])
          byPrefix.get(key).push(s.name)
        }
        const map = new Map()
        for (const [key, names] of byPrefix) {
          if (names.length >= 6 && key.length >= 3) for (const n of names) map.set(n, key)
        }
        return map
      }, [skills])

      const [expanded, setExpanded] = useState(() => new Set())

      const groups = useMemo(() => {
        const out = []
        const buckets = new Map()
        for (const s of shown) {
          const fam = familyOf.get(s.name)
          if (!fam) { out.push({ kind: 'skill', skill: s }); continue }
          if (!buckets.has(fam)) { const b = { kind: 'family', key: fam, members: [] }; buckets.set(fam, b); out.push(b) }
          buckets.get(fam).members.push(s)
        }
        for (let i = 0; i < out.length; i += 1) {
          const g = out[i]
          // 筛选后只剩一个成员，就别摆家族卡了，直接当普通卡
          if (g.kind === 'family' && g.members.length === 1) { out[i] = { kind: 'skill', skill: g.members[0] }; continue }
        }
        for (const g of out) {
          if (g.kind !== 'family') continue
          g.total = skills.filter(s => familyOf.get(s.name) === g.key).length
          g.samples = g.members.reduce((n, s) => n + (s.samples ? s.samples.length : 0), 0)
          const cats = new Set(g.members.map(m => m.categoryLabel))
          g.categoryLabel = cats.size === 1 ? g.members[0].categoryLabel : `跨 ${cats.size} 类`
          // 搜索时自动展开，免得搜到的东西藏在家族里
          g.open = expanded.has(g.key) || Boolean(query.trim())
        }
        return out
      }, [shown, familyOf, skills, expanded, query])

      const rail = useMemo(() => {
        const total = skills.length
        const cats = data ? data.categories : []
        return [{ id: 'all', label: '全部', count: total }, ...cats]
      }, [data, skills.length])

      return h('div', { className: 'atlas-root', style: { position: 'relative' } },
        h('div', { className: 'atlas-head' },
          h('div', { className: 'atlas-title' }, '技能大全'),
          h('div', { className: 'atlas-search' },
            h('input', {
              className: 'atlas-input',
              placeholder: '搜技能名、描述…',
              value: query,
              onChange: e => setQuery(e.target.value),
            })),
          h('div', { className: 'atlas-muted' },
            state.loading ? '扫描中…'
              : `${shown.length} / ${skills.length}${data && data.curated ? ` · 已核对 ${data.curated}` : ''}`),
          h('button', {
            className: `atlas-btn${byUsage ? ' primary' : ''}`,
            onClick: () => setByUsage(v => !v),
            title: '用得多的排前面',
          }, byUsage ? '常用优先 ✓' : '常用优先'),
          h('button', {
            className: `atlas-btn${onlySamples ? ' primary' : ''}`,
            onClick: () => setOnlySamples(v => !v),
            title: '只显示带案例图的技能',
          }, onlySamples ? '只看有样例 ✓' : '只看有样例'),
          h('button', { className: 'atlas-btn', disabled: state.loading, onClick: reload }, '重新扫描')),

        state.error
          ? h('div', { className: 'atlas-empty' }, `读不到技能列表：${state.error}`)
          : h('div', { className: 'atlas-body' },
            h('div', { className: 'atlas-rail' },
              rail.map(c => h('div', {
                key: c.id,
                className: `atlas-rail-item${category === c.id ? ' on' : ''}`,
                onClick: () => setCategory(c.id),
              },
                h('span', null, c.label),
                h('span', { className: 'atlas-rail-count' }, String(c.count))))),

            h('div', { className: 'atlas-main' },
              shown.length
                ? h('div', { className: 'atlas-grid' },
                  groups.flatMap(g => {
                    if (g.kind === 'skill') {
                      return [h(Card, {
                        key: g.skill.id,
                        skill: g.skill,
                        active: g.skill.id === selectedId,
                        onSelect: x => setSelectedId(prev => prev === x.id ? '' : x.id),
                      })]
                    }
                    const head = h('div', {
                      key: `fam:${g.key}`,
                      className: `atlas-family${g.open ? ' on' : ''}`,
                      onClick: () => setExpanded(prev => {
                        const next = new Set(prev)
                        next.has(g.key) ? next.delete(g.key) : next.add(g.key)
                        return next
                      }),
                    },
                      h('div', { className: 'atlas-family-head' },
                        h('span', { className: 'atlas-family-name' }, g.key),
                        h('span', { className: 'atlas-family-count' }, `${g.members.length} 个`)),
                      h('div', { className: 'atlas-family-list' }, g.members.map(m => m.name).join('、')),
                      h('div', { className: 'atlas-family-foot' },
                        h('span', { className: 'atlas-chip' }, g.categoryLabel),
                        g.samples ? h('span', { className: 'atlas-chip hot' }, `${g.samples} 张样例`) : null,
                        h('span', { className: 'atlas-chip' }, g.open ? '点我收起' : '点我展开')))
                    if (!g.open) return [head]
                    return [head, ...g.members.map(s => h(Card, {
                      key: s.id,
                      skill: s,
                      active: s.id === selectedId,
                      onSelect: x => setSelectedId(prev => prev === x.id ? '' : x.id),
                    }))]
                  }))
                : h('div', { className: 'atlas-empty' }, state.loading ? '正在扫描技能…' : '没有匹配的技能')),

            selected
              ? h(Modal, {
                skill: selected,
                onClose: () => setSelectedId(''),
                onChanged: () => load(true),
              })
              : null),

        toast ? h('div', { className: 'atlas-toast atlas-note ok' }, toast) : null)
    }

    // ------------------------------------------------------------ 挂载

    return {
      inject: ['slots'],
      apply(ctx) {
        CTX = ctx
        ctx.slots.inject('sidebar.panellist', function () {
          return ctx.slots.register(
            { name: 'sidebar.panellist', id: PANEL_ID, order: 18, label: '技能大全' },
            Icon,
          )
        })
        ctx.slots.inject('main', function () {
          return ctx.slots.register({ name: 'main', key: PANEL_ID }, Page)
        })
        ctx.slots.inject('conversation.input.left', function () {
          return ctx.slots.register(
            { name: 'conversation.input.left', id: 'skill-atlas-bridge', order: 90 },
            ComposerBridge,
          )
        })
      },
    }
  },
})
