/**
 * Demo tầng scene trên SẢN PHẨM ĐÃ BUILD, trong tiến trình Node sạch.
 *
 *   node scripts/scene-demo.mjs                 # pool-v2, mode boss_mode
 *   node scripts/scene-demo.mjs --mode coward --seed abc
 *   node scripts/scene-demo.mjs --pool <thư mục> --gm      # in cả kênh GM (có bí mật)
 *
 * Test đơn vị chạy trên mã TypeScript qua vitest; script này chứng minh `lib/scene.js` — thứ DSH và
 * UI sẽ import — nạp được và sinh scene thật từ 25 card đã import.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sceneLib = path.join(repoRoot, 'packages', 'rp-machine', 'lib', 'scene.js')
const schemaLib = path.join(repoRoot, 'packages', 'rp-machine', 'lib', 'card-schema.js')

function readFlag(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  if (index === -1) return fallback
  const value = process.argv[index + 1]
  return value === undefined || value.startsWith('--') ? fallback : value
}

const poolDir = readFlag('pool', path.join(repoRoot, 'pool-v2'))
const mode = readFlag('mode', 'boss_mode')
const seed = readFlag('seed', 'demo-001')
const showAllModes = process.argv.includes('--all-modes')

for (const lib of [sceneLib, schemaLib]) {
  if (!fs.existsSync(lib)) {
    console.error(`Chưa build. Thiếu ${lib}. Chạy: pnpm build`)
    process.exit(1)
  }
}

const sceneMod = await import(pathToFileURL(sceneLib).href)
const schemaMod = await import(pathToFileURL(schemaLib).href)

const loaded = schemaMod.loadPool(poolDir)
console.log(`[demo] pool: ${poolDir}`)
console.log(`[demo] ${loaded.cards.length} card, ${loaded.packs.length} pack, ${loaded.issues.length} issue`)
const summary = schemaMod.poolSummary(loaded.cards)
console.log(`[demo] theo loại: ${Object.entries(summary.byType).map(([type, count]) => `${type}=${count}`).join(' ')}`)
console.log(`[demo] card bị giấu: ${summary.gmOnly}`)
console.log('')

const modes = showAllModes ? [...sceneMod.PLAY_MODES] : [mode]
const sources = loaded.packs.map(pack => ({ id: pack.id, title: pack.title, cards: pack.cards }))
const coherence = process.argv.includes('--mixed') ? 'mixed' : 'single_source'
console.log(`[demo] coherence: ${coherence} · ${sources.length} bộ nguồn hoàn chỉnh`)
console.log('')

for (const currentMode of modes) {
  const started = Date.now()
  const outcome = sceneMod.generateScene(loaded.cards, { seed, mode: currentMode, sources, settings: { coherence } })
  const scene = outcome.scene
  console.log('='.repeat(72))
  console.log(`MODE ${currentMode} — "${scene.mode.label}"  (${Date.now() - started}ms)`)
  console.log(`nguồn: ${scene.source === null ? '(trộn từ toàn pool)' : `${scene.source.title} [${scene.source.id}]`}`)
  console.log(`chaos ${scene.chaos.total}/40 (${scene.chaos.level}) — ${scene.chaos.description}`)
  console.log(`điểm tương thích ${scene.compatibilityReport.score}, vi phạm cứng ${scene.compatibilityReport.errors.length}, cảnh báo ${scene.compatibilityReport.warnings.length}`)
  console.log(`trường do máy suy ra: ${scene.derivation.derived.length === 0 ? '(không có)' : scene.derivation.derived.join(' · ')}`)
  if (outcome.notes.length > 0) {
    console.log('ghi chú:')
    for (const note of outcome.notes) console.log(`  - ${note}`)
  }
  console.log('')
  console.log('--- BRIEFING CHO NGƯỜI CHƠI (công khai) ---')
  console.log(sceneMod.renderPlayerBriefing(scene))
  console.log('')
  console.log('--- THANH CĂNG THẲNG ---')
  for (const meter of scene.mechanics.tensionMeters) {
    console.log(`  ${meter.label}: ${meter.min}..${meter.max}, bắt đầu ${meter.start}, thua ở ${meter.failAt}${meter.derived ? ' [suy ra]' : ''}`)
  }
  console.log('')
  console.log('--- GHI CHÚ MỞ MÀN ---')
  console.log(scene.cardFragments.opening.firstMessage.trim() === ''
    ? '(card opening không có firstMessage — GM tự viết theo openingSituation)'
    : scene.cardFragments.opening.firstMessage.trim())

  if (process.argv.includes('--gm')) {
    console.log('')
    console.log('--- KÊNH GM (CÓ BÍ MẬT) ---')
    console.log(sceneMod.renderGmContext(scene))
  }
  console.log('')
}
