/**
 * Đóng gói plugin thành một file ESM để DSH nạp trực tiếp.
 *
 * Vì sao phải bundle: DSH dùng `import()` native để nạp plugin, mà Node ESM không tự
 * thêm đuôi file cho import tương đối. Bundle một file cũng tránh việc phải cài
 * node_modules bên trong profile DSH.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'))

/** Host cấp sẵn, không nội tuyến. */
const EXTERNAL = ['@deepseek-ai/cordis', '@deepseek-ai/dsh-skill-filesystem']

/**
 * Bốn entry:
 *   src/index.ts       → lib/index.js        (plugin DSH)
 *   src/card-schema.ts → lib/card-schema.js  (tầng schema card, dùng lại được từ script ngoài)
 *   src/scene.ts       → lib/scene.js        (engine sinh scene tất định)
 *   src/runtime.ts     → lib/runtime.js      (trạng thái ván + cưỡng chế luật)
 */
for (const [entry, outfile] of [
  ['index.ts', 'index.js'],
  ['card-schema.ts', 'card-schema.js'],
  ['scene.ts', 'scene.js'],
  ['runtime.ts', 'runtime.js'],
]) {
  const result = await esbuild.build({
    entryPoints: [path.join(packageRoot, 'src', entry)],
    outfile: path.join(packageRoot, 'lib', outfile),
    bundle: true,
    platform: 'node',
    target: 'node22.19',
    format: 'esm',
    external: EXTERNAL,
    sourcemap: false,
    legalComments: 'inline',
    logLevel: 'warning',
    metafile: true,
  })

  for (const output of Object.values(result.metafile.outputs)) {
    for (const imported of output.imports.filter(item => item.external)) {
      const isBuiltin = imported.path.startsWith('node:')
      const declared = manifest.peerDependencies?.[imported.path] !== undefined || manifest.dependencies?.[imported.path] !== undefined
      if (!isBuiltin && !declared) throw new Error(`Phụ thuộc runtime chưa khai báo: ${imported.path}`)
    }
  }

  const outPath = path.join(packageRoot, 'lib', outfile)
  const text = fs.readFileSync(outPath, 'utf8')
  const leftover = /from\s*["']\.[^"']*["']/.exec(text)
  if (leftover !== null) throw new Error(`${outfile} còn import tương đối: ${leftover[0]}`)
  if (/from\s*["']\.\.\/skills/.test(text)) throw new Error('Sản phẩm trỏ tới thư mục skills bằng đường dẫn tĩnh không hợp lệ')

  const bytes = fs.statSync(outPath).size
  const inlined = Object.keys(result.metafile.inputs).length
  console.log(`[bundle] lib/${outfile} ok (${(bytes / 1024).toFixed(1)} KB, nội tuyến ${inlined} module, 0 import tương đối)`)
}

// ── Bundle cho trình duyệt ─────────────────────────────────────────────────
// DSH nạp client plugin qua `window.__ModuleLoader__.load({ id, factory })`; React do host cấp sẵn
// nên phải để external. CSS nạp dạng chuỗi để plugin tự chèn <style>.
const clientOut = path.join(packageRoot, 'lib', 'client.js')
const clientResult = await esbuild.build({
  entryPoints: [path.join(packageRoot, 'src', 'client', 'index.tsx')],
  outfile: clientOut,
  platform: 'browser',
  format: 'cjs',
  bundle: true,
  external: ['react'],
  target: 'chrome110',
  loader: { '.css': 'text' },
  minify: true,
  legalComments: 'inline',
  logLevel: 'warning',
  metafile: true,
  banner: {
    js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(manifest.name)}, factory: (require) => { const module = { exports: {} }; const exports = module.exports;`,
  },
  footer: { js: 'return module.exports; } });' },
})

for (const output of Object.values(clientResult.metafile.outputs)) {
  for (const imported of output.imports.filter(item => item.external)) {
    if (imported.path !== 'react') throw new Error(`Client bundle chỉ được external 'react', đang có: ${imported.path}`)
  }
}
const clientText = fs.readFileSync(clientOut, 'utf8')
if (!clientText.startsWith('window.__ModuleLoader__.load(')) throw new Error('lib/client.js thiếu banner __ModuleLoader__')
if (!/return module\.exports; \} \}\);$/.test(clientText.trimEnd())) throw new Error('lib/client.js thiếu footer đóng module')
const clientBytes = fs.statSync(clientOut).size
console.log(`[bundle] lib/client.js ok (${(clientBytes / 1024).toFixed(1)} KB, module trình duyệt, react external)`)
