import { describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { createRequire } from 'node:module'

/**
 * Nạp `lib/client.js` THẬT trong Node: dựng `window.__ModuleLoader__` giả, lấy factory, chạy nó với
 * `require` chỉ trả về react, rồi gọi `apply()` trên host giả để xem nó đăng ký những gì.
 *
 * Đây là mức kiểm chứng cao nhất có thể làm mà không mở trình duyệt: nó chứng minh bundle client nạp
 * được, export đúng `inject`/`apply`, và wiring vào sidebar là thật. Phần render React thì vẫn phải
 * xem bằng mắt.
 */

const libPath = path.resolve(__dirname, '..', 'lib', 'client.js')
const hasBundle = fs.existsSync(libPath)
const require = createRequire(import.meta.url)

interface SlotRegistration {
  readonly options: { readonly name: string; readonly key?: string; readonly id?: string }
  readonly component: unknown
}

interface TabRegistration {
  readonly id: string
  readonly kind: string
}

function loadClientModule(): {
  exports: { inject?: unknown; apply?: unknown; openRoleplayPanel?: unknown }
  ruleId: string
} {
  const source = fs.readFileSync(libPath, 'utf8')
  let captured: { id: string; factory: (req: (id: string) => unknown) => Record<string, unknown> } | undefined
  const window = {
    __ModuleLoader__: {
      load(entry: { id: string; factory: (req: (id: string) => unknown) => Record<string, unknown> }) {
        captured = entry
      },
    },
  }
  // Bundle ở dạng CJS bọc trong banner của module loader, nên chỉ chạy file là đăng ký factory.
  new Function('window', source)(window)
  if (captured === undefined) throw new Error('lib/client.js không gọi window.__ModuleLoader__.load')

  const exports = captured.factory((id: string) => {
    if (id === 'react') return require('react')
    throw new Error(`client bundle require module lạ: ${id}`)
  })
  return { exports: exports as { inject?: unknown; apply?: unknown; openRoleplayPanel?: unknown }, ruleId: captured.id }
}

describe.skipIf(!hasBundle)('bundle client đã build', () => {
  it('đăng ký qua module loader với đúng tên gói', () => {
    const { ruleId } = loadClientModule()
    expect(ruleId).toBe('dsh-roleplay-machine')
  })

  it('export inject và apply theo hợp đồng client plugin của DSH', () => {
    const { exports } = loadClientModule()
    expect(typeof exports.apply).toBe('function')
    expect(Array.isArray(exports.inject)).toBe(true)
    const inject = exports.inject as string[]
    expect(inject).toContain('slots')
    expect(inject).toContain('sidebarRight')
    expect(inject).toContain('sidebarRightTabs')
  })

  it('apply đăng ký một tab kind và body + title vào slot của sidebar', () => {
    const { exports } = loadClientModule()
    const tabs: TabRegistration[] = []
    const slots: SlotRegistration[] = []
    const effects: string[] = []
    const opened: string[] = []

    const host = {
      slots: {
        inject: (_name: string, callback: () => (() => void) | void) => {
          callback()
          return () => {}
        },
        register: (options: SlotRegistration['options'], component: unknown) => {
          slots.push({ options, component })
          return () => {}
        },
        entries: () => [],
        subscribe: () => () => {},
      },
      sidebarRight: {
        openTab: (kind: string) => opened.push(kind),
        isExpanded: () => true,
        toggleExpanded: () => {},
      },
      sidebarRightTabs: {
        register: (definition: TabRegistration) => {
          tabs.push({ id: definition.id, kind: definition.kind })
          return () => {}
        },
      },
      sessions: { list: { getSnapshot: () => ({ current: undefined, byId: {} }) } },
      effect: (callback: () => (() => void) | void, label?: string) => {
        effects.push(label ?? '(không nhãn)')
        return callback()
      },
      get: () => undefined,
    }

    ;(exports.apply as (host: unknown) => void)(host)

    expect(tabs).toHaveLength(1)
    const tab = tabs[0]!
    expect(tab.kind).toBe('rp-machine')
    expect(tab.id.startsWith('@')).toBe(true)
    expect(effects.length).toBeGreaterThan(0)

    const names = slots.map(slot => slot.options.name)
    expect(names).toContain('sidebar.right.pane.tab')
    expect(names).toContain('sidebar.right.pane.tab.title')
    for (const slot of slots) {
      expect(slot.options.key).toBe(tab.id)
      expect(typeof slot.component).toBe('function')
    }

    // Hàm mở panel phải mở đúng kind đã đăng ký.
    expect(typeof exports.openRoleplayPanel).toBe('function')
    ;(exports.openRoleplayPanel as (host: unknown) => void)(host)
    expect(opened).toEqual(['rp-machine'])
  })

  it('kèm CSS tự chèn, không phụ thuộc file ngoài', () => {
    const source = fs.readFileSync(libPath, 'utf8')
    expect(source).toContain('rp-')
    expect(source.length).toBeGreaterThan(2000)
  })
})
