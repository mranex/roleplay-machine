/**
 * Khai báo dàn actor cho một ván: cast, bản đồ địa điểm, vị trí người chơi, điều kiện kết thúc.
 *
 * Đây là tầng "nhận dữ liệu thô từ model rồi kiểm trước khi dựng thế giới". Nguyên tắc: một khai báo
 * hỏng phải bị báo thành lỗi cụ thể, chứ không được im lặng bỏ qua — vì một actor thiếu `perceive` sẽ
 * ngồi im cả ván, và một điều kiện kết thúc hỏng sẽ khiến ván không bao giờ kết thúc.
 */

import {
  createWorldState,
  validateCast,
  type ActorDefinition,
  type ActorIssue,
  type LocationSpec,
  type WorldState,
} from './model'
import { validateEndConditions, type EndCondition } from './resolve'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function strList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '') : []
}

/** Bản đồ địa điểm: mỗi chỗ kề ai, cửa có niêm phong không, có tính là cùng phòng với đâu không. */
export function parseLocations(raw: unknown, issues: ActorIssue[]): Record<string, LocationSpec> {
  if (!isRecord(raw) || Object.keys(raw).length === 0) {
    issues.push({ where: 'locations', message: 'phải là object không rỗng: id địa điểm → { adjacent, sealed }' })
    return {}
  }

  const ids = Object.keys(raw)
  const known = new Set(ids)
  const locations: Record<string, LocationSpec> = {}

  for (const id of ids) {
    const spec = raw[id]
    const where = `locations.${id}`
    if (!isRecord(spec)) {
      issues.push({ where, message: 'phải là object { adjacent: string[], sealed?: boolean, sameRoomAs?: string }' })
      continue
    }
    const adjacent = strList(spec['adjacent'])
    for (const neighbour of adjacent) {
      if (!known.has(neighbour)) issues.push({ where, message: `kề với địa điểm không tồn tại: ${neighbour}` })
      if (neighbour === id) issues.push({ where, message: 'tự kề chính mình' })
    }
    // Kề là quan hệ đối xứng. Logic di chuyển đã hiểu cả hai chiều, nên thiếu chiều ngược lại không làm
    // hỏng ván — nhưng nó gần như luôn là lỗi dữ liệu, và im lặng bỏ qua thì lần sau sẽ thành bug khó truy.
    for (const neighbour of adjacent) {
      if (!known.has(neighbour)) continue
      const back = raw[neighbour]
      if (!isRecord(back)) continue
      if (!strList(back['adjacent']).includes(id)) {
        issues.push({ where: `locations.${neighbour}`, message: `thiếu chiều kề ngược lại với ${id} — nên khai cho đủ` })
      }
    }
    const sameRoomAs = typeof spec['sameRoomAs'] === 'string' ? spec['sameRoomAs'].trim() : ''
    if (sameRoomAs !== '' && !known.has(sameRoomAs)) {
      issues.push({ where, message: `sameRoomAs trỏ tới địa điểm không tồn tại: ${sameRoomAs}` })
    }
    locations[id] = {
      adjacent,
      sealed: spec['sealed'] === true,
      ...(sameRoomAs === '' || !known.has(sameRoomAs) ? {} : { sameRoomAs }),
    }
  }

  return locations
}

export interface ActorSetup {
  readonly sceneId: string
  readonly cast: readonly ActorDefinition[]
  readonly locations: Readonly<Record<string, LocationSpec>>
  readonly playerLocation: string
  readonly playerInventory: readonly string[]
  readonly endConditions: readonly EndCondition[]
  readonly secretFacts: readonly string[]
  readonly world: WorldState
  readonly issues: readonly ActorIssue[]
}

export interface ActorSetupInput {
  readonly sceneId: string
  readonly cast: unknown
  readonly locations: unknown
  readonly playerLocation?: unknown
  readonly playerInventory?: unknown
  readonly endConditions?: unknown
  /** Sự thật bị niêm phong. Dùng cho chốt chặn cô lập, không bao giờ vào payload actor. */
  readonly secretFacts?: readonly string[]
}

/**
 * Dựng thế giới ban đầu từ khai báo thô.
 *
 * Trả cả `issues` (cảnh báo đã tự vá) và `blocking` qua độ dài: nếu không có địa điểm hoặc không có
 * actor nào hợp lệ thì world trả về là world rỗng, và người gọi phải từ chối tạo ván.
 */
export function parseActorSetup(input: ActorSetupInput): ActorSetup {
  const issues: ActorIssue[] = []
  const locations = parseLocations(input.locations, issues)

  const castResult = validateCast(input.cast)
  issues.push(...castResult.issues)
  const cast = castResult.definitions

  const locationIds = Object.keys(locations)
  const locationSet = new Set(locationIds)

  for (const definition of cast) {
    if (!locationSet.has(definition.location)) {
      issues.push({ where: `cast.${definition.id}.location`, message: `địa điểm không tồn tại trong bản đồ: ${definition.location}` })
    }
  }

  const requested = typeof input.playerLocation === 'string' ? input.playerLocation.trim() : ''
  const playerLocation = requested !== '' && locationSet.has(requested)
    ? requested
    : (locationIds[0] ?? '')
  if (requested !== '' && !locationSet.has(requested)) {
    issues.push({ where: 'playerLocation', message: `địa điểm không tồn tại: ${requested} — dùng ${playerLocation || '(không có)'}` })
  }

  const parsedConditions = input.endConditions === undefined
    ? { conditions: [] as EndCondition[], issues: [] as { where: string; message: string }[] }
    : validateEndConditions(input.endConditions)
  for (const issue of parsedConditions.issues) issues.push(issue)

  // Actor hỏng bị `validateCast` loại. Nếu không còn ai hoặc không có địa điểm nào thì world vẫn được
  // dựng (rỗng), và người gọi phải kiểm `setupIsUsable` trước khi cho ván chạy.
  const world = createWorldState({
    sceneId: input.sceneId,
    definitions: cast,
    locations,
    playerLocation,
    playerInventory: strList(input.playerInventory),
  })

  return {
    sceneId: input.sceneId,
    cast,
    locations,
    playerLocation,
    playerInventory: strList(input.playerInventory),
    endConditions: parsedConditions.conditions,
    secretFacts: (input.secretFacts ?? []).map(fact => fact.trim()).filter(fact => fact !== ''),
    world,
    issues,
  }
}

/**
 * Actor setup có dùng được không: cần ít nhất một địa điểm, một actor hợp lệ, và MỌI actor phải đứng ở
 * địa điểm có thật trong bản đồ — actor đứng ở chỗ không tồn tại sẽ không bao giờ tri giác đúng.
 */
export function setupIsUsable(setup: ActorSetup): boolean {
  if (setup.cast.length === 0 || Object.keys(setup.locations).length === 0 || setup.playerLocation === '') return false
  return setup.cast.every(definition => setup.locations[definition.location] !== undefined)
}
