import { describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { writeCard, type Card } from '../src/card-schema'
import { MASKED_TEXT, WebApiError, createWebApiRoute, handleRpApi } from '../src/web-api'
import { makeRichPool } from './fixtures/cards'

const NOW = '2026-01-01T00:00:00.000Z'

function setupWorkspace(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-webapi-'))
  const pool = path.join(root, 'roleplay-machine', 'pool')
  for (const card of makeRichPool() as Card[]) writeCard(pool, card)
  return root
}

const deps = (root: string) => ({ workspaceRoot: () => root, now: () => NOW })
const call = (root: string, method: string, body: Record<string, unknown> = {}) => handleRpApi(deps(root), method, body)

describe('API cho UI — thư viện', () => {
  it('status trả tổng quan thư viện', async () => {
    const root = setupWorkspace()
    const status = (await call(root, 'status')) as Record<string, unknown>
    expect(status['total']).toBe(8)
    expect(status['gmOnly']).toBe(1)
    expect(status['packs']).toBe(0)
    expect(status['issues']).toEqual([])
    expect(status['runs']).toEqual([])
  })

  it('cards che nội dung card bị niệm phong khi chưa yêu cầu mở', async () => {
    const root = setupWorkspace()
    const result = (await call(root, 'cards', { reveal: false })) as { cards: { id: string; masked: boolean; fragments: { hiddenTruth: string; prompt: string } }[] }
    const hidden = result.cards.find(card => card.id === 'hidden_truth_giau')
    expect(hidden?.masked).toBe(true)
    expect(hidden?.fragments.hiddenTruth).toBe(MASKED_TEXT)
    expect(hidden?.fragments.prompt).toBe(MASKED_TEXT)

    const publicCard = result.cards.find(card => card.id === 'npc_giau')
    expect(publicCard?.masked).toBe(false)
    expect(publicCard?.fragments.hiddenTruth).not.toBe(MASKED_TEXT)
  })

  it('cards chỉ mở niệm phong khi reveal = true', async () => {
    const root = setupWorkspace()
    const result = (await call(root, 'cards', { reveal: true })) as { cards: { id: string; masked: boolean; fragments: { hiddenTruth: string } }[] }
    const hidden = result.cards.find(card => card.id === 'hidden_truth_giau')
    expect(hidden?.masked).toBe(false)
    expect(hidden?.fragments.hiddenTruth).toBe('HIỆP SĨ ĐANG TRỐN DƯỚI SÀN.')
  })

  it('cards lọc được theo loại', async () => {
    const root = setupWorkspace()
    const result = (await call(root, 'cards', { type: 'npc' })) as { cards: unknown[] }
    expect(result.cards).toHaveLength(1)
  })

  it('save-card ghi được card hợp lệ và từ chối card vượt trần', async () => {
    const root = setupWorkspace()
    const saved = (await call(root, 'save-card', {
      card: {
        schemaVersion: 'rsm-card-v1',
        id: 'npc_tu_ui',
        title: 'NPC từ UI',
        type: ['npc'],
        chaos: 3,
        tags: ['chung'],
        fragments: { prompt: 'Một chỉ thị hành vi vừa đủ dài để hợp lệ trong schema card.' },
        metadata: {},
      },
    })) as { ok: boolean; file: string }
    expect(saved.ok).toBe(true)
    expect(saved.file).toMatch(/[\\/]npc[\\/]npc_tu_ui\.json$/)

    await expect(call(root, 'save-card', {
      card: {
        schemaVersion: 'rsm-card-v1',
        id: 'npc_qua_dai',
        title: 'Quá dài',
        type: ['npc'],
        chaos: 3,
        tags: ['chung'],
        fragments: { prompt: 'x'.repeat(1200) },
        metadata: {},
      },
    })).rejects.toThrow(/vượt trần/)
  })

  it('delete-card xoá được và trả false khi không thấy', async () => {
    const root = setupWorkspace()
    expect((await call(root, 'delete-card', { id: 'npc_giau' })) as { ok: boolean }).toMatchObject({ ok: true })
    expect((await call(root, 'delete-card', { id: 'npc_giau' })) as { ok: boolean }).toMatchObject({ ok: false })
  })
})

describe('API cho UI — rút bài và trạng thái', () => {
  it('draw sinh scene, lưu ván, và trả briefing công khai', async () => {
    const root = setupWorkspace()
    const drawn = (await call(root, 'draw', { mode: 'boss_mode', seed: 'ui-1' })) as Record<string, unknown>
    expect(drawn['ok']).toBe(true)
    expect(String(drawn['sceneId'])).toBe('scene-boss_mode-ui-1')
    expect(String(drawn['briefing'])).toContain('Vai của bạn')
    expect((drawn['meters'] as unknown[]).length).toBeGreaterThan(0)
    expect(drawn['winSteps']).toBe(3)

    const state = (await call(root, 'state', {})) as Record<string, unknown>
    expect(state['sceneId']).toBe('scene-boss_mode-ui-1')
    expect(String(state['frame'])).toContain('Thanh căng thẳng')
  })

  it('draw KHÔNG trả bí mật bị niệm phong', async () => {
    const root = setupWorkspace()
    const drawn = (await call(root, 'draw', { mode: 'boss_mode', seed: 'ui-2' })) as Record<string, unknown>
    expect(JSON.stringify(drawn)).not.toContain('HIỆP SĨ ĐANG TRỐN DƯỚI SÀN.')
  })

  it('draw từ chối mode lạ và thư viện rỗng', async () => {
    const root = setupWorkspace()
    await expect(call(root, 'draw', { mode: 'khong-co' })).rejects.toThrow(/mode phải là một trong/)

    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-webapi-empty-'))
    await expect(call(empty, 'draw', { mode: 'boss_mode' })).rejects.toThrow(/Thư viện rỗng/)
  })

  it('state không có ván nào thì trả ok false thay vì nổ', async () => {
    const root = setupWorkspace()
    const state = (await call(root, 'state', {})) as Record<string, unknown>
    expect(state['ok']).toBe(false)
    expect(String(state['frame'])).toMatch(/Chưa có ván nào/)
  })

  it('scene đọc lại được khung công khai của scene đã lưu', async () => {
    const root = setupWorkspace()
    const drawn = (await call(root, 'draw', { mode: 'boss_mode', seed: 'ui-3' })) as Record<string, unknown>
    const scene = (await call(root, 'scene', { sceneId: drawn['sceneId'] })) as Record<string, unknown>
    expect(String(scene['briefing'])).toContain('Mục tiêu')
    await expect(call(root, 'scene', { sceneId: 'khong-co' })).rejects.toThrow(/Không thấy scene/)
  })

  it('thiếu workspace thì báo lỗi rõ ràng', async () => {
    await expect(handleRpApi({ workspaceRoot: () => undefined }, 'status', {})).rejects.toThrow(/Chưa xác định được workspace/)
  })

  it('method lạ bị từ chối', async () => {
    const root = setupWorkspace()
    await expect(call(root, 'khong-co-method')).rejects.toThrow(WebApiError)
  })
})

// ── Tầng HTTP ──────────────────────────────────────────────────────────────

interface Captured {
  status: number
  body: unknown
  headers: Record<string, string>
}

function fakeExchange(method: string, url: string, body: string, headers: Record<string, string>): {
  request: IncomingMessage
  response: ServerResponse
  captured: Captured
} {
  const captured: Captured = { status: 0, body: undefined, headers: {} }
  const chunks = body === '' ? [] : [Buffer.from(body, 'utf8')]
  const request = {
    method,
    url,
    headers,
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk
    },
  } as unknown as IncomingMessage
  const response = {
    writeHead(status: number, responseHeaders: Record<string, string>) {
      captured.status = status
      captured.headers = responseHeaders
      return response
    },
    end(payload?: string) {
      captured.body = payload === undefined ? undefined : JSON.parse(payload)
      return response
    },
  } as unknown as ServerResponse
  return { request, response, captured }
}

describe('route HTTP', () => {
  const route = createWebApiRoute({ workspaceRoot: () => undefined, now: () => NOW })

  it('dùng tiền tố /rp-machine/api (không có dấu / cuối)', () => {
    expect(route.kind).toBe('prefix')
    expect(route.path).toBe('/rp-machine/api')
  })

  it('từ chối request thiếu header x-rp-request', async () => {
    const { request, response, captured } = fakeExchange('POST', '/rp-machine/api/status', '{}', {})
    await route.handler(request, response)
    expect(captured.status).toBe(403)
    expect((captured.body as { code: string }).code).toBe('forbidden')
  })

  it('từ chối method không phải POST', async () => {
    const { request, response, captured } = fakeExchange('GET', '/rp-machine/api/status', '', { 'x-rp-request': '1' })
    await route.handler(request, response)
    expect(captured.status).toBe(405)
  })

  it('trả 400 kèm mã lỗi khi method không tồn tại', async () => {
    const live = createWebApiRoute({ workspaceRoot: () => setupWorkspace(), now: () => NOW })
    const { request, response, captured } = fakeExchange('POST', '/rp-machine/api/khong-co', '{}', { 'x-rp-request': '1' })
    await live.handler(request, response)
    expect(captured.status).toBe(400)
    expect((captured.body as { code: string }).code).toBe('unknown-method')
  })

  it('trả 200 kèm value khi gọi đúng, và chặn JSON hỏng', async () => {
    const root = setupWorkspace()
    const live = createWebApiRoute({ workspaceRoot: () => root, now: () => NOW })

    const ok = fakeExchange('POST', '/rp-machine/api/status', '{}', { 'x-rp-request': '1' })
    await live.handler(ok.request, ok.response)
    expect(ok.captured.status).toBe(200)
    expect((ok.captured.body as { ok: boolean; value: { total: number } }).value.total).toBe(8)

    const bad = fakeExchange('POST', '/rp-machine/api/status', '{ khong phai json', { 'x-rp-request': '1' })
    await live.handler(bad.request, bad.response)
    expect(bad.captured.status).toBe(400)
    expect((bad.captured.body as { code: string }).code).toBe('bad-json')
  })
})
