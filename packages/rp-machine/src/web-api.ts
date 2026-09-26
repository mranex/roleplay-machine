/**
 * API host cho UI web của plugin.
 *
 * UI chạy trong trình duyệt nên không đọc được đĩa. Nó gọi cùng origin tới
 * `POST /rp-machine/api/<method>`, và mỗi method ở đây là một hàm thuần trên thư viện card + scene +
 * runtime. Tách hàm thuần khỏi phần đăng ký route để test được không cần HTTP.
 *
 * Ranh giới bí mật vẫn là luật cứng, nhưng ở đây có một tinh chỉnh: UI thư viện là công cụ của chính
 * người dùng, nên họ ĐƯỢC xem nội dung card bị giấu nếu họ chủ động yêu cầu (`reveal: true`) — kèm
 * cảnh báo spoil ở phía UI. Mặc định thì nội dung bị che, và màn rút bài không bao giờ trả bí mật.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import * as path from 'node:path'
import {
  CARD_TYPES,
  cardsOfType,
  deleteCard,
  loadPool,
  normalizeCard,
  poolSummary,
  writeCard,
  type Card,
  type CardType,
} from './card-schema'
import {
  DEFAULT_SETTINGS,
  MODE_INFO,
  PLAY_MODES,
  generateScene,
  listScenes,
  loadRecentCards,
  loadScene,
  recordRecentCards,
  renderPlayerBriefing,
  saveScene,
  type PlayMode,
  type SceneSettings,
} from './scene'
import {
  isTerminal,
  listRuns,
  loadRun,
  newRunState,
  renderPublicFrame,
  saveRun,
} from './runtime'

/** Nội dung bị che cho tới khi người dùng chủ động mở niêm phong. */
export const MASKED_TEXT = '— nội dung bị niệm phong —'

export interface WebApiDeps {
  readonly workspaceRoot: () => string | undefined
  readonly now?: () => string
}

export interface RpCardView {
  readonly id: string
  readonly type: string
  readonly title: string
  readonly chaos: number
  readonly visibility: string
  readonly weight: number
  readonly tags: readonly string[]
  readonly description: string
  readonly fragments: {
    readonly prompt: string
    readonly firstMessage: string
    readonly hiddenTruth: string
    readonly heavenRule: string
    readonly contentBoundary: string
  }
  /** `true` khi nội dung đã bị che. */
  readonly masked: boolean
}

function poolDirOf(root: string): string {
  return path.join(root, 'roleplay-machine', 'pool')
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

/**
 * Card nhìn từ UI. Card `gm_only` (và `hidden`) bị che nội dung trừ khi `reveal`.
 * Đây là chỗ duy nhất trong UI chạm tới `hidden_truth`.
 */
export function toCardView(card: Card, reveal: boolean): RpCardView {
  const sealed = card.visibility !== 'public'
  const masked = sealed && !reveal
  return {
    id: card.id,
    type: card.type,
    title: card.title,
    chaos: card.chaos,
    visibility: card.visibility,
    weight: card.weight,
    tags: card.tags,
    description: masked ? '' : card.description,
    fragments: masked
      ? { prompt: MASKED_TEXT, firstMessage: '', hiddenTruth: MASKED_TEXT, heavenRule: MASKED_TEXT, contentBoundary: MASKED_TEXT }
      : { ...card.fragments },
    masked,
  }
}

export class WebApiError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'WebApiError'
  }
}

/**
 * Xử lý một method. Hàm thuần: chỉ đọc/ghi qua các module tầng dưới, không chạm HTTP.
 * Ném `WebApiError` cho lỗi người dùng; lỗi khác để tầng route biến thành 500.
 */
export async function handleRpApi(deps: WebApiDeps, method: string, body: Record<string, unknown>): Promise<unknown> {
  const root = deps.workspaceRoot()
  if (root === undefined || root === '') {
    throw new WebApiError('no-workspace', 'Chưa xác định được workspace của phiên — chưa biết thư viện card nằm ở đâu.')
  }
  const now = (): string => (deps.now ?? (() => new Date().toISOString()))()
  const dir = poolDirOf(root)

  switch (method) {
    case 'status': {
      const loaded = loadPool(dir)
      const summary = poolSummary(loaded.cards)
      return {
        total: summary.total,
        byType: summary.byType,
        gmOnly: summary.gmOnly,
        packs: loaded.packs.length,
        issues: loaded.issues.map(issue => `${issue.where}: ${issue.message}`),
        scenes: listScenes(root),
        runs: listRuns(root),
      }
    }

    case 'cards': {
      const reveal = body['reveal'] === true
      const loaded = loadPool(dir)
      const typeFilter = typeof body['type'] === 'string' && body['type'] !== '' ? body['type'] : undefined
      const filtered = typeFilter === undefined ? loaded.cards : cardsOfType(loaded.cards, typeFilter as CardType)
      return {
        cards: filtered.map(card => toCardView(card, reveal)),
        issues: loaded.issues.map(issue => `${issue.where}: ${issue.message}`),
        types: [...CARD_TYPES],
      }
    }

    case 'save-card': {
      const result = normalizeCard(body['card'], 'card từ UI')
      if (result.card === undefined || result.issues.length > 0) {
        throw new WebApiError('invalid-card', result.issues.map(issue => `${issue.where}: ${issue.message}`).join(' · '))
      }
      const file = writeCard(dir, result.card)
      return { ok: true, id: result.card.id, file }
    }

    case 'delete-card': {
      const id = String(body['id'] ?? '').trim()
      if (id === '') throw new WebApiError('missing-id', 'Thiếu id card cần xoá.')
      return { ok: deleteCard(dir, id), id }
    }

    case 'draw': {
      const mode = body['mode']
      if (typeof mode !== 'string' || !(PLAY_MODES as readonly string[]).includes(mode)) {
        throw new WebApiError('bad-mode', `mode phải là một trong ${PLAY_MODES.join(', ')}.`)
      }
      const loaded = loadPool(dir)
      if (loaded.cards.length === 0) {
        throw new WebApiError('empty-library', 'Thư viện rỗng. Hãy tạo card trước bằng khung Sửa card.')
      }
      const stamp = now()
      const seed = typeof body['seed'] === 'string' && body['seed'].trim() !== '' ? body['seed'].trim() : stamp
      const picksRaw = asRecord(body['picks'])
      const picks: Partial<Record<CardType, string>> = {}
      for (const type of CARD_TYPES) {
        const value = picksRaw[type]
        if (typeof value === 'string' && value.trim() !== '') picks[type] = value.trim()
      }
      const settings: Partial<SceneSettings> = { ...DEFAULT_SETTINGS }
      const outcome = generateScene(loaded.cards, {
        seed,
        mode: mode as PlayMode,
        picks,
        settings,
        sources: loaded.packs.map(pack => ({ id: pack.id, title: pack.title, cards: pack.cards })),
        recentCardIds: loadRecentCards(root),
        now: stamp,
      })
      saveScene(root, outcome.scene)
      const state = newRunState(outcome.scene, stamp)
      saveRun(root, state)
      recordRecentCards(root, CARD_TYPES.map(type => outcome.scene.cards[type].id))
      return {
        ok: true,
        sceneId: outcome.scene.id,
        mode: outcome.scene.mode.id,
        modeLabel: MODE_INFO[outcome.scene.mode.id].label,
        source: outcome.scene.source,
        chaos: {
          total: outcome.scene.chaos.total,
          level: outcome.scene.chaos.level,
          description: outcome.scene.chaos.description,
          eventEvery: outcome.scene.chaos.eventEvery,
        },
        briefing: renderPlayerBriefing(outcome.scene),
        meters: state.meters,
        winSteps: state.winSteps.length,
        frame: renderPublicFrame(state),
        notes: outcome.notes,
      }
    }

    case 'state': {
      const runs = listRuns(root)
      const requested = typeof body['sceneId'] === 'string' && body['sceneId'].trim() !== '' ? body['sceneId'].trim() : runs[0]?.sceneId
      if (requested === undefined) return { ok: false, sceneId: null, status: 'none', frame: 'Chưa có ván nào.', runs }
      const state = loadRun(root, requested)
      if (state === undefined) throw new WebApiError('no-run', `Không thấy ván "${requested}".`)
      return {
        ok: !isTerminal(state.status),
        sceneId: state.sceneId,
        status: state.status,
        frame: renderPublicFrame(state),
        meters: state.meters,
        winSteps: { done: state.winSteps.filter(step => step.done).length, total: state.winSteps.length },
        runs,
      }
    }

    case 'scene': {
      // Khung công khai của một scene đã lưu, để UI xem lại mà không lộ bí mật.
      const id = String(body['sceneId'] ?? '').trim()
      if (id === '') throw new WebApiError('missing-id', 'Thiếu sceneId.')
      const scene = loadScene(root, id)
      if (scene === undefined) throw new WebApiError('no-scene', `Không thấy scene "${id}".`)
      return {
        sceneId: scene.id,
        source: scene.source,
        chaos: { total: scene.chaos.total, level: scene.chaos.level, description: scene.chaos.description },
        briefing: renderPlayerBriefing(scene),
      }
    }

    default:
      throw new WebApiError('unknown-method', `Không có method "${method}".`)
  }
}

// ── Tầng HTTP ──────────────────────────────────────────────────────────────

/** Đọc body JSON, chặn quá lớn. Trả object rỗng khi body trống. */
async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const parts: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += part.length
    if (size > 4 * 1024 * 1024) throw new WebApiError('too-large', 'Request vượt 4 MiB.')
    parts.push(part)
  }
  if (parts.length === 0) return {}
  const text = Buffer.concat(parts).toString('utf8').trim()
  if (text === '') return {}
  try {
    const parsed: unknown = JSON.parse(text)
    return asRecord(parsed)
  } catch {
    throw new WebApiError('bad-json', 'Body không phải JSON hợp lệ.')
  }
}

function reply(response: ServerResponse, status: number, value: unknown): void {
  const payload = JSON.stringify(value)
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  response.end(payload)
}

export interface WebServerLike {
  register(route: {
    kind: 'prefix'
    path: string
    handler(request: IncomingMessage, response: ServerResponse): Promise<void>
  }): () => void
}

/**
 * Tiền tố route. KHÔNG có dấu `/` cuối: DSH khớp prefix theo kiểu `path + '/'`, nên
 * `/rp-machine/api/` sẽ thành `/rp-machine/api//` và không bao giờ khớp. Đây đúng là hình dạng mà
 * plugin cùng họ đang dùng (`/webnovel/api`).
 */
export const RP_API_PREFIX = '/rp-machine/api'

/**
 * Tạo handler cho `POST /rp-machine/api/<method>`.
 *
 * Từ chối mọi request không mang header `x-rp-request: 1` — cùng cách plugin cùng họ đang dùng để chỉ
 * nhận request do UI của chính nó phát ra.
 */
export function createWebApiRoute(deps: WebApiDeps): {
  kind: 'prefix'
  path: string
  handler(request: IncomingMessage, response: ServerResponse): Promise<void>
} {
  return {
    kind: 'prefix',
    path: RP_API_PREFIX,
    handler: async (request, response) => {
      if (request.method !== 'POST') {
        reply(response, 405, { ok: false, code: 'method-not-allowed', error: 'Chỉ nhận POST.' })
        return
      }
      if (request.headers['x-rp-request'] !== '1') {
        reply(response, 403, { ok: false, code: 'forbidden', error: 'Thiếu header x-rp-request.' })
        return
      }
      const url = new URL(request.url ?? '/', 'http://localhost')
      const method = url.pathname.slice(RP_API_PREFIX.length).replace(/^\/+/, '').replace(/\/+$/, '')
      try {
        const body = await readJsonBody(request)
        const value = await handleRpApi(deps, method, body)
        reply(response, 200, { ok: true, value })
      } catch (error) {
        if (error instanceof WebApiError) {
          reply(response, 400, { ok: false, code: error.code, error: error.message })
          return
        }
        reply(response, 500, {
          ok: false,
          code: 'internal',
          error: error instanceof Error ? error.message : String(error),
        })
      }
    },
  }
}
