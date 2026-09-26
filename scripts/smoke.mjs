/**
 * Smoke test chạy trên SẢN PHẨM ĐÃ BUILD (lib/index.js), trong tiến trình Node sạch.
 *
 * Vì sao cần: test đơn vị chạy trên mã TypeScript qua vitest. Chỉ có script này mới chứng minh được
 * rằng artifact ESM thật — thứ DSH sẽ `import()` — nạp được, đăng ký đủ tool, và chơi hết một ván
 * bằng chính thư viện card đã import từ app Python cũ.
 *
 *   node scripts/smoke.mjs
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const libPath = path.join(repoRoot, 'packages', 'rp-machine', 'lib', 'index.js')
/** React nằm trong node_modules của package, không phải ở gốc repo. */
const packageRequire = createRequire(path.join(repoRoot, 'packages', 'rp-machine', 'package.json'))

const failures = []
function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  ok   ${label}`)
  } else {
    console.log(`  FAIL ${label}${detail === '' ? '' : ` — ${detail}`}`)
    failures.push(label)
  }
}

if (!fs.existsSync(libPath)) {
  console.error(`Chưa build. Thiếu ${libPath}. Chạy: pnpm --filter dsh-roleplay-machine build`)
  process.exit(1)
}

console.log('[smoke] nạp artifact đã build')
const mod = await import(pathToFileURL(libPath).href)
check('export name', mod.name === 'rp-machine', String(mod.name))
check('export apply', typeof mod.apply === 'function')

// ── Workspace tạm với thư viện card thật ──────────────────────────────────
const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-smoke-'))
const poolDir = path.join(ws, 'roleplay-machine', 'pool')
fs.mkdirSync(poolDir, { recursive: true })
const sourcePool = path.join(repoRoot, 'pool-v2')
if (!fs.existsSync(sourcePool)) {
  console.error(`Không thấy ${sourcePool}. Chạy: pnpm import:rsm`)
  process.exit(1)
}
fs.cpSync(sourcePool, poolDir, { recursive: true })

// ── Host giả ──────────────────────────────────────────────────────────────
const registered = []
const sections = []
const contexts = []
const listeners = new Map()
const logs = []

const fakeAgentCtx = {
  systemPrompt: {
    section: entry => { sections.push(entry); return () => {} },
    context: entry => { contexts.push(entry); return () => {} },
  },
  inject: (_deps, cb) => { cb(fakeAgentCtx); return undefined },
}
const agent = { id: 'sess-smoke', ctx: fakeAgentCtx, session: { header: { id: 'sess-smoke', cwd: ws } } }

const host = {
  logger: { info: m => logs.push(m), warn: m => logs.push(m) },
  get: key => {
    if (key === 'tools') return { register: definition => { registered.push(definition); return () => {} } }
    if (key === 'agents') return { list: () => [agent] }
    if (key === 'workspaceRegistry') return { list: () => [{ path: ws }] }
    return undefined
  },
  inject: (_deps, cb) => { cb(host); return undefined },
  on: (event, listener) => {
    listeners.set(event, [...(listeners.get(event) ?? []), listener])
    return () => {}
  },
  plugin: () => {},
}

console.log('[smoke] apply() trên host giả')
mod.apply(host)
check(`đăng ký ${mod.RP_TOOL_NAMES.length} tool`, registered.length === mod.RP_TOOL_NAMES.length, `nhận ${registered.length}`)
check('tên tool khớp danh sách công bố', registered.map(tool => tool.name).join(',') === mod.RP_TOOL_NAMES.join(','))
check('gắn bản giao kèo Thiên Đạo', sections.some(section => section.name === 'rp-machine.contract'))
check('gắn kênh trạng thái ván', contexts.some(context => context.name === 'rp-machine.run'))

const call = async (name, args = {}) => {
  const tool = registered.find(entry => entry.name === name)
  if (tool === undefined) throw new Error(`thiếu tool ${name}`)
  return await tool.execute(args, { agent })
}

console.log('[smoke] mở ván từ thư viện thật')
const status = await call('rp_pool_status')
check('thư viện nạp sạch', status.ok === true && status.issues.length === 0, JSON.stringify(status.issues).slice(0, 200))
check('thư viện có 25 card', status.total === 25, String(status.total))
check('có bộ nguồn hoàn chỉnh', status.packs > 0, String(status.packs))

const created = await call('rp_new_scene', { mode: 'boss_mode', seed: 'smoke-001' })
check('sinh được scene', created.ok === true, String(created.sceneId))
check('scene lấy từ một bộ nguồn', created.source !== null, JSON.stringify(created.source))
check('briefing công khai có vai và mục tiêu', created.briefing.includes('Vai của bạn') && created.briefing.includes('Mục tiêu'))
check('có thanh căng thẳng', Array.isArray(created.meters) && created.meters.length > 0)
const sceneId = created.sceneId

// ── Ranh giới bí mật ──────────────────────────────────────────────────────
const sceneFile = JSON.parse(fs.readFileSync(path.join(ws, 'roleplay-machine', 'scenes', `${sceneId}.json`), 'utf8'))
const secrets = [
  sceneFile.sceneCore.hiddenTruth,
  ...Object.values(sceneFile.cardFragments).map(fragment => fragment.hiddenTruth),
].filter(text => typeof text === 'string' && text.trim() !== '')

console.log('[smoke] chơi một ván đầy đủ')
const outputs = [status, created, await call('rp_state', { sceneId })]
outputs.push(await call('rp_turn', { sceneId, playerAction: 'Tôi rót rượu và mời hắn nếm thử.' }))
check('turn tăng lượt', outputs[3].turn === 1, String(outputs[3].turn))

// Trục 1: phá khung đủ trần thì bị trục xuất.
const strikeRun = await call('rp_new_scene', { mode: 'boss_mode', seed: 'smoke-strike' })
outputs.push(strikeRun)
let lastStrike = null
for (let i = 0; i < 6; i++) lastStrike = await call('rp_strike', { sceneId: strikeRun.sceneId, reason: `vi phạm ${i}` })
outputs.push(lastStrike)
check('đủ trần cảnh cáo thì bị trục xuất', lastStrike.ejected === true, JSON.stringify(lastStrike).slice(0, 120))

// Trục 2: nói hớ trong vai làm thanh chạm trần, KHÔNG sinh cảnh cáo OOC.
const meterId = created.meters[0].id
const failAt = created.meters[0].failAt
let meterRun = await call('rp_state', { sceneId })
let lastMeter = null
for (let i = created.meters[0].value; i < failAt; i++) {
  lastMeter = await call('rp_meter', { sceneId, meterId, delta: 1, reason: 'lời nói hớ trong vai' })
}
outputs.push(lastMeter)
check('thanh chạm trần thì thua', lastMeter.failed === true, JSON.stringify(lastMeter).slice(0, 120))
check('thanh chạm trần KHÔNG sinh cảnh cáo OOC', lastMeter.frame.includes('【Cảnh cáo OOC】0/'), lastMeter.frame.split('\n')[3])

// Ván thắng: hoàn thành mọi bước thắng.
const winRun = await call('rp_new_scene', { mode: 'boss_mode', seed: 'smoke-win' })
outputs.push(winRun)
let lastStep = null
for (let step = 1; step <= winRun.winSteps; step++) lastStep = await call('rp_step', { sceneId: winRun.sceneId, step })
outputs.push(lastStep)
check('xong hết bước thì thắng', lastStep.finished === true, JSON.stringify(lastStep).slice(0, 120))

const ended = await call('rp_end', { sceneId: winRun.sceneId, epilogue: 'Mọi chuyện khép lại đúng như nó phải thế.' })
outputs.push(ended)
check('chốt được ván và ghi ending.md', ended.ok === true && fs.existsSync(path.join(ws, 'roleplay-machine', 'runs', winRun.sceneId, 'ending.md')))

console.log('[smoke] kiểm tra ranh giới bí mật')
const blob = JSON.stringify(outputs)
check('có ít nhất một bí mật để kiểm', secrets.length > 0, String(secrets.length))
check(
  'không output công khai nào chứa hiddenTruth',
  secrets.every(secret => !blob.includes(secret)),
  secrets.find(secret => blob.includes(secret)) ?? '',
)

const runContext = contexts.find(context => context.name === 'rp-machine.run')
const gmText = String(typeof runContext?.text === 'function' ? runContext.text({}) : runContext?.text)
check('kênh GM chở được bí mật tới model', secrets.some(secret => gmText.includes(secret)) || gmText.includes('đã kết thúc'))

// ── API cho UI: gọi thẳng handler, không cần HTTP ─────────────────────────
console.log('[smoke] API cho UI web')
const api = mod.handleRpApi
check('export handleRpApi', typeof api === 'function')
if (typeof api === 'function') {
  const deps = { workspaceRoot: () => ws }
  const statusViaApi = await api(deps, 'status', {})
  check('status trả đúng thư viện', statusViaApi.total === 25, String(statusViaApi.total))
  const cardsViaApi = await api(deps, 'cards', { reveal: false })
  const sealed = cardsViaApi.cards.filter(card => card.masked)
  check('card bị niệm phong bị che nội dung', sealed.length > 0 && sealed.every(card => card.fragments.hiddenTruth === mod.MASKED_TEXT))
  const revealed = await api(deps, 'cards', { reveal: true })
  check('mở niệm phong khi được yêu cầu', revealed.cards.some(card => !card.masked && card.fragments.hiddenTruth !== mod.MASKED_TEXT))
  const drawn = await api(deps, 'draw', { mode: 'boss_mode', seed: 'smoke-ui' })
  check('draw trả briefing công khai', typeof drawn.briefing === 'string' && drawn.briefing.includes('Mục tiêu'))
  check('draw không trả bí mật', !JSON.stringify(drawn).includes(secrets[0]))
  const route = mod.createWebApiRoute({ workspaceRoot: () => ws })
  check('route dùng tiền tố /rp-machine/api (không có / cuối)', route.path === mod.RP_API_PREFIX && route.kind === 'prefix', route.path)
}

// ── Bundle client: nạp thật qua module loader giả ────────────────────────
console.log('[smoke] bundle client cho trình duyệt')
const clientPath = path.join(repoRoot, 'packages', 'rp-machine', 'lib', 'client.js')
check('có lib/client.js', fs.existsSync(clientPath))
if (fs.existsSync(clientPath)) {
  const source = fs.readFileSync(clientPath, 'utf8')
  let entry
  const fakeWindow = { __ModuleLoader__: { load: value => { entry = value } } }
  new Function('window', source)(fakeWindow)
  check('đăng ký qua window.__ModuleLoader__', entry !== undefined && typeof entry.factory === 'function')
  if (entry !== undefined) {
    const clientExports = entry.factory(id => {
      if (id === 'react') return packageRequire('react')
      throw new Error(`client bundle require module lạ: ${id}`)
    })
    check('export apply', typeof clientExports.apply === 'function')
    check('inject đủ ba service', ['slots', 'sidebarRight', 'sidebarRightTabs'].every(name => clientExports.inject.includes(name)))

    const clientTabs = []
    const slots = []
    const clientHost = {
      slots: {
        inject: (_name, callback) => { callback(); return () => {} },
        register: (options, component) => { slots.push({ options, component }); return () => {} },
        entries: () => [],
        subscribe: () => () => {},
      },
      sidebarRight: { openTab: kind => clientTabs.push(kind), isExpanded: () => true, toggleExpanded: () => {} },
      sidebarRightTabs: { register: definition => { clientTabs.push(definition.kind); return () => {} } },
      sessions: { list: { getSnapshot: () => ({ current: undefined, byId: {} }) } },
      effect: callback => callback(),
      get: () => undefined,
    }
    clientExports.apply(clientHost)
    check('đăng ký một tab kind rp-machine', clientTabs.includes('rp-machine'), clientTabs.join(','))
    const slotNames = slots.map(slot => slot.options.name)
    check(
      'đăng ký body + title vào sidebar',
      slotNames.includes('sidebar.right.pane.tab') && slotNames.includes('sidebar.right.pane.tab.title'),
      slotNames.join(','),
    )
    check('component của slot là hàm React', slots.every(slot => typeof slot.component === 'function'))
  }
}

fs.rmSync(ws, { recursive: true, force: true })

console.log('')
if (failures.length > 0) {
  console.error(`[smoke] THẤT BẠI ${failures.length} mục: ${failures.join(', ')}`)
  process.exit(1)
}
console.log('[smoke] tất cả kiểm tra đều đạt')
