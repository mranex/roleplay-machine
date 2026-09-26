/**
 * Demo runtime trên SẢN PHẨM ĐÃ BUILD, trong tiến trình Node sạch.
 *
 *   node scripts/runtime-demo.mjs
 *
 * Chơi ba ván scripted trên cùng một scene thật, để thấy hai trục cưỡng chế hoạt động độc lập:
 *   1. phá khung đủ trần  ⇒ bị trục xuất
 *   2. lời nói hớ trong vai ⇒ nghi ngờ chạm trần ⇒ thua
 *   3. hoàn thành bước thắng ⇒ cái kết thật
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const lib = (name) => path.join(repoRoot, 'packages', 'rp-machine', 'lib', `${name}.js`)

for (const name of ['card-schema', 'scene', 'runtime']) {
  if (!fs.existsSync(lib(name))) {
    console.error(`Chưa build. Thiếu lib/${name}.js. Chạy: pnpm build`)
    process.exit(1)
  }
}

const schema = await import(pathToFileURL(lib('card-schema')).href)
const sceneMod = await import(pathToFileURL(lib('scene')).href)
const runtime = await import(pathToFileURL(lib('runtime')).href)

const poolDir = path.join(repoRoot, 'pool-v2')
const loaded = schema.loadPool(poolDir)
const sources = loaded.packs.map((pack) => ({ id: pack.id, title: pack.title, cards: pack.cards }))
const NOW = '2026-01-01T00:00:00.000Z'

const scene = sceneMod.generateScene(loaded.cards, {
  seed: 'runtime-demo',
  mode: 'boss_mode',
  sources,
  settings: { strictness: 'strict' },
  now: NOW,
}).scene

console.log(`[runtime-demo] scene: ${scene.id}`)
console.log(`[runtime-demo] nguồn: ${scene.source?.title ?? '(trộn)'} · chaos ${scene.chaos.total}/40 (${scene.chaos.level})`)
console.log(`[runtime-demo] Thiên Đạo strictness ${scene.kamiSama.strictness}/5 ⇒ trần cảnh cáo OOC ${runtime.oocStrikeBudget(scene.kamiSama.strictness)}`)

const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-runtime-demo-'))
let state = runtime.newRunState(scene, NOW)
runtime.saveRun(ws, state)
console.log(`[runtime-demo] đã lưu ván vào ${runtime.runDirOf(ws, scene.id)}`)
console.log('')

function show(label, run) {
  console.log('-'.repeat(72))
  console.log(label)
  console.log(runtime.renderPublicFrame(run))
  const meter = run.meters[0]
  if (meter !== undefined) {
    console.log(`  (thanh đầu: ${meter.label} = ${meter.value}/${meter.max}, thua ở ${meter.failAt})`)
  }
}

// ── Ván 1: phá khung ──────────────────────────────────────────────────────
console.log('### VÁN 1 — người chơi tự định nghĩa nhân vật chính')
{
  let run = runtime.newRunState(scene, NOW)
  const violations = [
    'tự nhận mình có kiếm bạc',
    'tự quyết rằng ma cà rồng đã chết',
    'nói ngoài truyện: đòi đổi luật',
  ]
  violations.forEach((reason, index) => {
    const result = runtime.applyOocStrike(run, reason, NOW)
    run = result.state
    show(`lượt ${index + 1}: ${reason}`, run)
    console.log(`  → ${result.text}`)
  })
  console.log('')
  console.log(`KẾT: ${runtime.renderEnding(run)}`)
}

// ── Ván 2: nhập vai dở ────────────────────────────────────────────────────
console.log('')
console.log('### VÁN 2 — nhập vai dở (KHÔNG phải vi phạm OOC)')
{
  let run = runtime.newRunState(scene, NOW)
  const meterId = run.meters[0]?.id
  if (meterId === undefined) {
    console.log('scene này không có thanh căng thẳng')
  } else {
    const failAt = run.meters[0].failAt
    for (let i = run.meters[0].value; i < failAt; i++) {
      run = runtime.recordTurn(run, 'nói một câu hớ trong vai', 'hắn nheo mắt', NOW)
      const step = runtime.adjustMeter(run, meterId, 1, 'câu nói hớ', NOW)
      run = step.state
      show(`lượt ${run.turn}: nói hớ`, run)
      console.log(`  → ${step.text}`)
    }
    console.log('')
    console.log(`Cảnh cáo OOC vẫn là ${run.oocStrikes} — nói hớ là NỘI DUNG, không phải vi phạm.`)
    console.log(`KẾT: ${runtime.renderEnding(run)}`)
  }
}

// ── Ván 3: chơi đúng ─────────────────────────────────────────────────────
console.log('')
console.log('### VÁN 3 — chơi đúng đường')
{
  let run = runtime.newRunState(scene, NOW)
  run = runtime.recordTurn(run, 'dọn món đầu tiên có tỏi, gọi đó là mốt của giới quý tộc', 'hắn ăn thử', NOW)
  show(`lượt ${run.turn}`, run)
  for (const step of run.winSteps.map((_, index) => index + 1)) {
    const result = runtime.completeWinStep(run, step, NOW)
    run = result.state
    console.log(`  → ${result.text}`)
  }
  console.log('')
  console.log(`KẾT: ${runtime.renderEnding(run)}`)
}

console.log('')
console.log('### KÊNH GM (chứa bí mật — không bao giờ đưa cho người chơi)')
console.log(runtime.renderGmFrame(state, scene).split('\n').slice(0, 14).join('\n'))
console.log('  ...')

fs.rmSync(ws, { recursive: true, force: true })
