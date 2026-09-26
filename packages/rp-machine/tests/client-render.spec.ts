// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { createRequire } from 'node:module'
import type { ReactNode } from 'react'

/**
 * Render THẬT panel trong DOM ảo.
 *
 * Đây là tầng kiểm chứng mà typecheck và test loader không chạm tới: nó mount component thật (lấy từ
 * chính `apply()` của bundle đã build), để `useEffect` chạy, chạy qua `fetch` giả, và đọc DOM sau khi
 * state cập nhật. Nếu JSX hay luồng dữ liệu có lỗi chỉ nổ lúc render thì test này bắt được.
 *
 * Cái còn lại phải xem bằng mắt là bố cục và màu sắc trong trình duyệt thật.
 */

const libPath = path.resolve(__dirname, '..', 'lib', 'client.js')
const hasBundle = fs.existsSync(libPath)
const require = createRequire(import.meta.url)

const CARD_PUBLIC = {
  id: 'npc_giau',
  type: 'npc',
  title: 'Ma cà rồng sành điệu',
  chaos: 4,
  visibility: 'public',
  weight: 10,
  tags: ['vampire', 'noble'],
  description: '',
  fragments: {
    prompt: 'Kẻ săn mồi cổ đại bị chi phối bởi gu thẩm mỹ.',
    firstMessage: '',
    hiddenTruth: 'GHI CHÚ GM VỀ MA CÀ RỒNG',
    heavenRule: 'Kami-sama declares: chỉ hiệu lực một lần.',
    contentBoundary: 'Không được để hắn vô hại.',
  },
  masked: false,
}

const CARD_MASKED = {
  id: 'hidden_truth_giau',
  type: 'hidden_truth',
  title: 'Hiệp sĩ dưới sàn bếp',
  chaos: 2,
  visibility: 'gm_only',
  weight: 10,
  tags: ['secret'],
  description: '',
  fragments: {
    prompt: '— nội dung bị niệm phong —',
    firstMessage: '',
    hiddenTruth: '— nội dung bị niệm phong —',
    heavenRule: '— nội dung bị niệm phong —',
    contentBoundary: '— nội dung bị niệm phong —',
  },
  masked: true,
}

const SECRET = 'HIỆP SĨ ĐANG TRỐN DƯỚI SÀN BẾP'

const RESPONSES: Record<string, unknown> = {
  status: { total: 2, byType: { npc: 1, hidden_truth: 1 }, gmOnly: 1, packs: 1, issues: [], scenes: [], runs: [] },
  cards: { cards: [CARD_PUBLIC, CARD_MASKED], issues: [], types: ['world'] },
  draw: {
    ok: true,
    sceneId: 'scene-boss_mode-kiem-chung',
    mode: 'boss_mode',
    modeLabel: 'Tôi là siêu anh hùng',
    source: { id: 'pack-alpha', title: 'Three Garlic Dishes' },
    chaos: { total: 21, level: 'unstable', description: 'Luật thế giới bắt đầu lung lay.', eventEvery: 3 },
    briefing: '【Ván】scene-boss_mode-kiem-chung\n【Vai của bạn】đầu bếp của một ma cà rồng\n【Mục tiêu】ba món tỏi',
    meters: [{ id: 'nghi-ngo', label: 'Nghi ngờ', value: 1, min: 0, max: 5, failAt: 5 }],
    winSteps: 3,
    frame: '【Ván】lượt 0 · trạng thái active',
    notes: ['ghi chú thử'],
  },
  state: { ok: true, sceneId: 'scene-boss_mode-kiem-chung', status: 'active', frame: '【Ván】lượt 0', runs: [] },
}

interface PanelComponent {
  (props: { sessionId: string }): ReactNode
}

interface LoadedClient {
  apply: (host: unknown) => void
  inject: string[]
}

function loadClient(): LoadedClient {
  const source = fs.readFileSync(libPath, 'utf8')
  let entry: { id: string; factory: (req: (id: string) => unknown) => Record<string, unknown> } | undefined
  const window = { __ModuleLoader__: { load(value: typeof entry) { entry = value } } }
  new Function('window', source)(window)
  if (entry === undefined) throw new Error('lib/client.js không gọi window.__ModuleLoader__.load')
  const exports = entry.factory((id: string) => {
    if (id === 'react') return require('react')
    throw new Error(`client bundle require module lạ: ${id}`)
  })
  return exports as unknown as LoadedClient
}

/** Đăng ký qua `apply` rồi lấy đúng component mà host sẽ render cho tab body. */
function panelFrom(client: LoadedClient): PanelComponent {
  let panel: PanelComponent | undefined
  const host = {
    slots: {
      inject: (_name: string, callback: () => (() => void) | void) => {
        callback()
        return () => {}
      },
      register: (options: { name: string }, component: PanelComponent) => {
        if (options.name === 'sidebar.right.pane.tab') panel = component
        return () => {}
      },
      entries: () => [],
      subscribe: () => () => {},
    },
    sidebarRight: { openTab: () => {}, isExpanded: () => true, toggleExpanded: () => {} },
    sidebarRightTabs: { register: () => () => {} },
    sessions: { list: { getSnapshot: () => ({ current: undefined, byId: {} }) } },
    effect: (callback: () => (() => void) | void) => callback(),
    get: () => undefined,
  }
  client.apply(host)
  if (panel === undefined) throw new Error('apply() không đăng ký component cho sidebar.right.pane.tab')
  return panel
}

/** Nuôi effect + promise đang chờ bằng vài vòng microtask. */
async function settle(rounds = 6): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise(resolve => setTimeout(resolve, 0))
}

const calls: string[] = []

function installFetch(): void {
  calls.length = 0
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = url.split('/').pop()?.split('?')[0] ?? ''
    calls.push(method)
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {}
    if (method === 'cards' && body['reveal'] === true) {
      return new Response(JSON.stringify({ ok: true, value: { cards: [{ ...CARD_MASKED, masked: false, fragments: { ...CARD_MASKED.fragments, hiddenTruth: SECRET } }] } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    const value = RESPONSES[method]
    if (value === undefined) {
      return new Response(JSON.stringify({ ok: false, code: 'unknown-method', error: `Không có method "${method}"` }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      })
    }
    return new Response(JSON.stringify({ ok: true, value }), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
}

let container: HTMLDivElement | undefined
let root: { unmount: () => void } | undefined

async function mountPanel(): Promise<HTMLDivElement> {
  const React = require('react') as typeof import('react')
  const { createRoot } = require('react-dom/client') as typeof import('react-dom/client')
  const Panel = panelFrom(loadClient())
  container = document.createElement('div')
  document.body.appendChild(container)
  const created = createRoot(container)
  root = created
  const { act } = require('react-dom/test-utils') as { act: (callback: () => void | Promise<void>) => Promise<void> }
  await act(async () => {
    created.render(React.createElement(Panel, { sessionId: 'sess-render' }))
  })
  await act(async () => {
    await settle()
  })
  return container
}

beforeEach(() => {
  installFetch()
})

afterEach(() => {
  root?.unmount()
  container?.remove()
  root = undefined
  container = undefined
})

describe.skipIf(!hasBundle)('panel render trong DOM ảo', () => {
  it('mount được và hiện tiêu đề cùng ba tab', async () => {
    const dom = await mountPanel()
    expect(dom.querySelector('.rp-root')).not.toBeNull()
    expect(dom.getAttribute('data-session') ?? dom.querySelector('.rp-root')?.getAttribute('data-session')).toBe('sess-render')
    const labels = [...dom.querySelectorAll('.rp-tab')].map(node => node.textContent)
    expect(labels).toEqual(['Thư viện', 'Rút bài', 'Sửa card'])
  })

  it('nạp thư viện qua fetch và hiện card', async () => {
    const dom = await mountPanel()
    expect(calls).toContain('status')
    expect(calls).toContain('cards')
    const text = dom.textContent ?? ''
    expect(text).toContain('Ma cà rồng sành điệu')
    expect(text).toContain('Hiệp sĩ dưới sàn bếp')
  })

  it('card bị niệm phong không lộ nội dung, và ghi chú GM của card công khai cũng không hiện', async () => {
    const dom = await mountPanel()
    const text = dom.textContent ?? ''
    expect(text).toContain('— nội dung bị niệm phong —')
    expect(text).not.toContain(SECRET)
    // `hiddenTruth` của card public là ghi chú GM, không thuộc màn thư viện.
    expect(text).not.toContain('GHI CHÚ GM VỀ MA CÀ RỒNG')
  })

  it('bấm tab Rút bài thì hiện màn rút với ba mode', async () => {
    const dom = await mountPanel()
    const React = require('react') as typeof import('react')
    const { act } = require('react-dom/test-utils') as { act: (callback: () => void | Promise<void>) => Promise<void> }
    const drawTab = [...dom.querySelectorAll('.rp-tab')].find(node => node.textContent === 'Rút bài') as HTMLButtonElement
    await act(async () => {
      drawTab.click()
    })
    const text = dom.textContent ?? ''
    expect(text).toContain('Tôi là người bình thường')
    expect(text).toContain('Tôi có hơi bất thường')
    expect(text).toContain('Tôi là siêu anh hùng')
    expect(React).toBeTruthy()
  })

  it('bấm Rút bài thì gọi API draw và hiện briefing công khai', async () => {
    const dom = await mountPanel()
    const { act } = require('react-dom/test-utils') as { act: (callback: () => void | Promise<void>) => Promise<void> }
    const drawTab = [...dom.querySelectorAll('.rp-tab')].find(node => node.textContent === 'Rút bài') as HTMLButtonElement
    await act(async () => {
      drawTab.click()
    })
    const runButton = [...dom.querySelectorAll('button')].find(node => node.textContent === 'Rút bài' && !node.classList.contains('rp-tab')) as HTMLButtonElement
    expect(runButton, 'không thấy nút Rút bài trong màn rút').toBeTruthy()
    await act(async () => {
      runButton.click()
      await settle()
    })
    expect(calls).toContain('draw')
    const text = dom.textContent ?? ''
    expect(text).toContain('Three Garlic Dishes')
    expect(text).toContain('chaos')
    expect(text).toContain('đầu bếp của một ma cà rồng')
    expect(text).not.toContain(SECRET)
  })

  it('bấm tab Sửa card thì hiện form với năm mảnh và trần ký tự', async () => {
    const dom = await mountPanel()
    const { act } = require('react-dom/test-utils') as { act: (callback: () => void | Promise<void>) => Promise<void> }
    const editorTab = [...dom.querySelectorAll('.rp-tab')].find(node => node.textContent === 'Sửa card') as HTMLButtonElement
    await act(async () => {
      editorTab.click()
    })
    expect(dom.querySelectorAll('textarea').length).toBeGreaterThanOrEqual(5)
    const text = dom.textContent ?? ''
    expect(text).toContain('hiddenTruth')
    expect(text).toContain('/ 1000')
  })
})
