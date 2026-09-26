/**
 * Import thư viện card của app Python cũ (Roleplay Scene Maker) sang layout pool mới.
 *
 *   node scripts/import-rsm.mjs                                   # nạp vào ./pool-v2
 *   node scripts/import-rsm.mjs --out C:\Games\rp-sandbox\roleplay-machine\pool
 *   node scripts/import-rsm.mjs --dry-run                         # chỉ báo cáo, không ghi
 *   node scripts/import-rsm.mjs --source "D:\khac\data"
 *
 * Đây là thin entry: toàn bộ logic nằm ở `packages/rp-machine/src/card-schema.ts`, được build
 * thành `lib/card-schema.js`. Phải chạy `pnpm build` trước.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const libPath = path.join(repoRoot, 'packages', 'rp-machine', 'lib', 'card-schema.js')
const DEFAULT_SOURCE = 'C:\\Nghich\\Roleplay_Gemini_new\\data'

function readFlag(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  if (index === -1) return fallback
  const value = process.argv[index + 1]
  return value === undefined || value.startsWith('--') ? fallback : value
}

const dryRun = process.argv.includes('--dry-run')
const source = readFlag('source', DEFAULT_SOURCE)
const out = readFlag('out', path.join(repoRoot, 'pool-v2'))

if (!fs.existsSync(source)) {
  console.error(`Không thấy thư viện nguồn: ${source}`)
  console.error('Truyền đường dẫn khác bằng --source "<đường dẫn tới data>"')
  process.exit(1)
}
if (!fs.existsSync(libPath)) {
  console.error(`Chưa build. Thiếu ${libPath}. Chạy: pnpm build`)
  process.exit(1)
}

const mod = await import(pathToFileURL(libPath).href)
if (typeof mod.importRsmLibrary !== 'function') {
  console.error('lib/card-schema.js thiếu importRsmLibrary — build lại.')
  process.exit(1)
}

console.log(`[import] nguồn: ${source}`)
console.log(`[import] đích : ${out}${dryRun ? '  (dry-run, không ghi)' : ''}`)

const report = mod.importRsmLibrary(source, out, { dryRun })

console.log('')
console.log(`Card đọc được : ${report.read}`)
console.log(`Card ghi ra   : ${report.written}`)
console.log(`Pack ghi ra   : ${report.packsWritten}`)
console.log(`Migrate từ MVP: ${report.migrated}`)
console.log('')
console.log('Theo loại:')
for (const [type, count] of Object.entries(report.byType)) {
  if (count > 0) console.log(`  ${type.padEnd(13)} ${count}`)
}
console.log('')
console.log('Độ dài lớn nhất từng mảnh (so với trần cứng):')
const limits = mod.FRAGMENT_LIMITS
for (const [key, length] of Object.entries(report.maxFragmentLength)) {
  const limit = limits[key]
  const flag = length > limit ? '  ← VƯỢT TRẦN' : ''
  console.log(`  ${key.padEnd(16)} ${String(length).padStart(5)} / ${limit}${flag}`)
}

if (report.ignoredFirstMessage.length > 0) {
  console.log('')
  console.log(`firstMessage ngoài loại opening (tầng scene bỏ qua): ${report.ignoredFirstMessage.join(', ')}`)
}

// Vấn đề nằm trong pack không làm mất card nào: card rời cùng id đã thắng khi trùng. Chỉ khi có
// card rời không nạp được thì import mới thật sự mất dữ liệu.
const packIssues = report.issues.filter(issue => issue.where.includes('\\packs\\'))
const fatalIssues = report.issues.filter(issue => !issue.where.includes('\\packs\\'))

if (packIssues.length > 0) {
  console.log('')
  console.log(`Cảnh báo trong pack (${packIssues.length}, không mất card nào):`)
  for (const issue of packIssues) console.log(`  ${issue.where}: ${issue.message}`)
}

if (fatalIssues.length > 0) {
  console.log('')
  console.log(`LỖI (${fatalIssues.length}) — có card không nạp được:`)
  for (const issue of fatalIssues) console.log(`  ${issue.where}: ${issue.message}`)
  process.exitCode = 1
} else {
  console.log('')
  console.log(`[import] xong: ${report.written} card vào ${out}`)
}
