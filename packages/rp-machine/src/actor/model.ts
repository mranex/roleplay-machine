/**
 * Tầng actor của Multi-Actor-Agent Mode — mô hình dữ liệu.
 *
 * Nguyên tắc trung tâm của mode này: **thông tin bị cô lập bằng kiến trúc, không bằng lời dặn trong
 * prompt**. Nếu Lucien không biết có hiệp sĩ dưới hầm, thì chuỗi nói về hiệp sĩ không bao giờ được
 * xuất hiện trong context của Lucien — chứ không phải "xuất hiện rồi bảo nó giả vờ không biết".
 *
 * Bốn loại dữ liệu phải tách hẳn (spec §25):
 *
 *   Canonical truth   — tỏi nằm trong túi người chơi.        → WorldState, do CODE sở hữu
 *   Actor knowledge   — quản gia thấy người chơi ra khỏi kho. → ActorState.memory
 *   Actor belief      — quản gia NGHĨ người chơi lấy hành.    → ActorState.beliefs (có thể sai)
 *   Actor intent      — quản gia MUỐN kiểm tra túi.           → output của actor, chưa là gì cả
 *
 * Không loại nào được tự động đồng bộ sang loại khác. Belief sai thì để nó sai.
 */

export type ActorKind = 'npc' | 'faction' | 'environment'

/** Actor nhìn được gì. Đây là dữ liệu của perception router, không phải gợi ý cho model. */
export type PerceptionScope =
  /** Cùng phòng với nguồn phát. */
  | 'same_room'
  /** Được gọi tên trực tiếp, kể cả khi không cùng phòng. */
  | 'addressed'
  /** Nghe được âm thanh lớn từ phòng kề. */
  | 'loud_nearby'
  /** Nhận biết sự hiện diện ở phòng kề, không có nội dung. */
  | 'adjacent_presence'
  /** Cảm nhận thay đổi vật lý trong phạm vi nó trông coi (dùng cho actor môi trường). */
  | 'physical_change'

export interface ActorDefinition {
  readonly id: string
  readonly kind: ActorKind
  readonly name: string
  readonly role: string
  /** trait → 0..5. Ảnh hưởng cách actor phản ứng, không phải dữ liệu canon. */
  readonly personality: Readonly<Record<string, number>>
  readonly goals: readonly string[]
  /**
   * Những câu actor này ĐƯỢC biết ngay từ đầu. Đây là ranh giới cô lập chính: không có gì khác được
   * đưa vào payload của nó.
   */
  readonly allowedKnowledge: readonly string[]
  readonly initialBeliefs: readonly { readonly claim: string; readonly confidence: number }[]
  /** Trait thuộc sở hữu của actor và được commit vào world state (suspicion, hunger, readiness...). */
  readonly traits: Readonly<Record<string, number>>
  readonly location: string
  readonly perceive: readonly PerceptionScope[]
  readonly act: readonly string[]
  /** Id của actor khác mà nó để mắt tới: hành động nhắm vào đó sẽ đánh thức nó. */
  readonly watches?: readonly string[]
}

export interface Belief {
  readonly claim: string
  /** 0..1. Belief KHÔNG phải canon và không bao giờ được tự động sửa thành sự thật. */
  readonly confidence: number
  readonly source: string
  readonly turn: number
}

export interface Observation {
  readonly turn: number
  readonly text: string
  /** 1 = nghe rõ toàn bộ; 0 = chỉ biết có chuyện gì đó xảy ra. */
  readonly fidelity: number
}

export interface ActorPlan {
  readonly goal: string
  readonly trigger: string
  readonly createdTurn: number
}

/** Trạng thái riêng của một actor. Chỉ actor đó và Resolver được đọc. */
export interface ActorState {
  readonly id: string
  readonly location: string
  readonly traits: Record<string, number>
  readonly memory: Observation[]
  readonly beliefs: Belief[]
  readonly plans: ActorPlan[]
  /** Lượt mà actor này thực sự được đánh thức — dùng để kiểm "actor ngủ không tốn model call". */
  readonly awakeTurns: number[]
}

/**
 * Một địa điểm. `sameRoomAs` mô hình hoá chỗ đứng nửa trong nửa ngoài — ngưỡng cửa bếp, hành lang
 * thông phòng: đứng đó vẫn nghe rõ như đứng trong phòng, nhưng vẫn là một địa điểm riêng để mô tả.
 */
export interface LocationSpec {
  readonly adjacent: readonly string[]
  /** Cửa của địa điểm này đang niêm phong: chặn mọi quan sát qua lại với phòng kề. */
  readonly sealed: boolean
  /** Đứng ở đây được tính là cùng phòng với địa điểm kia. */
  readonly sameRoomAs?: string
}

export interface WorldState {
  readonly sceneId: string
  turn: number
  readonly locations: Readonly<Record<string, LocationSpec>>
  readonly actors: Record<string, ActorState>
  readonly player: { location: string; inventory: string[]; oocStrikes: number }
  readonly items: Record<string, { location: string; count: number }>
  readonly flags: Record<string, boolean | number | string>
}

export interface ActorIssue {
  readonly where: string
  readonly message: string
}

const ID_PATTERN = /^[a-z0-9]+(?:_[a-z0-9]+)*$/
export const ACTOR_KINDS: readonly ActorKind[] = ['npc', 'faction', 'environment']
export const PERCEPTION_SCOPES: readonly PerceptionScope[] = [
  'same_room',
  'addressed',
  'loud_nearby',
  'adjacent_presence',
  'physical_change',
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function strList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}

function numRecord(value: unknown): Record<string, number> {
  if (!isRecord(value)) return {}
  const out: Record<string, number> = {}
  for (const [key, raw] of Object.entries(value)) if (typeof raw === 'number' && Number.isFinite(raw)) out[key] = raw
  return out
}

/** Kiểm tra một định nghĩa actor thô. Card/pack cũ không có khái niệm này nên nó do Heaven soạn ra. */
export function validateActorDefinition(raw: unknown, where = '(không rõ)'): {
  definition?: ActorDefinition
  issues: ActorIssue[]
} {
  const issues: ActorIssue[] = []
  if (!isRecord(raw)) return { issues: [{ where, message: 'Actor phải là object' }] }

  const id = typeof raw['id'] === 'string' ? raw['id'].trim() : ''
  if (!ID_PATTERN.test(id)) issues.push({ where, message: `id phải là snake_case: ${JSON.stringify(raw['id'])}` })

  const kind = typeof raw['kind'] === 'string' ? raw['kind'] : ''
  if (!(ACTOR_KINDS as readonly string[]).includes(kind)) {
    issues.push({ where, message: `kind phải là một trong ${ACTOR_KINDS.join(', ')}` })
  }

  const name = typeof raw['name'] === 'string' ? raw['name'].trim() : ''
  if (name === '') issues.push({ where, message: 'thiếu name' })

  const location = typeof raw['location'] === 'string' ? raw['location'].trim() : ''
  if (location === '') issues.push({ where, message: 'thiếu location' })

  const allowedKnowledge = strList(raw['allowedKnowledge'])
  if (allowedKnowledge.length === 0) {
    issues.push({ where, message: 'allowedKnowledge rỗng — actor không biết gì thì không đóng được vai' })
  }

  const perceive = strList(raw['perceive'])
  if (perceive.length === 0) issues.push({ where, message: 'perceive rỗng — actor sẽ không bao giờ được đánh thức' })
  for (const scope of perceive) {
    if (!(PERCEPTION_SCOPES as readonly string[]).includes(scope)) {
      issues.push({ where, message: `perceive không hợp lệ: ${scope}` })
    }
  }

  const traits = numRecord(raw['traits'])
  const initialBeliefsRaw = Array.isArray(raw['initialBeliefs']) ? raw['initialBeliefs'] : []
  const initialBeliefs: { claim: string; confidence: number }[] = []
  for (const [index, entry] of initialBeliefsRaw.entries()) {
    if (!isRecord(entry) || typeof entry['claim'] !== 'string' || entry['claim'].trim() === '') {
      issues.push({ where: `${where}.initialBeliefs[${index}]`, message: 'belief phải có claim' })
      continue
    }
    const confidence = typeof entry['confidence'] === 'number' ? entry['confidence'] : 0.5
    if (confidence < 0 || confidence > 1) {
      issues.push({ where: `${where}.initialBeliefs[${index}]`, message: 'confidence phải trong 0..1' })
    }
    initialBeliefs.push({ claim: entry['claim'].trim(), confidence })
  }

  if (issues.length > 0) return { issues }
  return {
    definition: {
      id,
      kind: kind as ActorKind,
      name,
      role: typeof raw['role'] === 'string' ? raw['role'] : '',
      personality: numRecord(raw['personality']),
      goals: strList(raw['goals']),
      allowedKnowledge,
      initialBeliefs,
      traits,
      location,
      perceive: perceive as PerceptionScope[],
      act: strList(raw['act']),
      watches: strList(raw['watches']),
    },
    issues,
  }
}

/** Kiểm tra cả dàn actor. Id trùng bị loại; actor hỏng không làm hỏng phần còn lại. */
export function validateCast(raw: unknown): { definitions: ActorDefinition[]; issues: ActorIssue[] } {
  const issues: ActorIssue[] = []
  if (!Array.isArray(raw)) return { definitions: [], issues: [{ where: 'cast', message: 'Cast phải là array' }] }
  const definitions: ActorDefinition[] = []
  const seen = new Set<string>()
  for (const [index, entry] of raw.entries()) {
    const result = validateActorDefinition(entry, `cast[${index}]`)
    issues.push(...result.issues)
    if (result.definition === undefined) continue
    if (seen.has(result.definition.id)) {
      issues.push({ where: `cast[${index}]`, message: `id trùng: ${result.definition.id}` })
      continue
    }
    seen.add(result.definition.id)
    definitions.push(result.definition)
  }
  return { definitions, issues }
}

/**
 * Dựng world state ban đầu từ dàn actor.
 *
 * Lưu ý: đây là chỗ duy nhất biến định nghĩa thành state. `allowedKnowledge` KHÔNG được copy vào state
 * — nó là hằng số của định nghĩa và chỉ được đọc lúc dựng payload. State chỉ chứa thứ thay đổi được.
 */
export function createWorldState(input: {
  readonly sceneId: string
  readonly definitions: readonly ActorDefinition[]
  readonly locations: Readonly<Record<string, LocationSpec>>
  readonly playerLocation: string
  readonly playerInventory?: readonly string[]
}): WorldState {
  // Bản đồ địa điểm được sao chép: nếu dùng thẳng object của caller thì một ván niêm phong cửa sẽ sửa
  // vào định nghĩa cảnh, và mọi ván sau đó thừa hưởng cánh cửa đã khoá.
  const locations: Record<string, LocationSpec> = {}
  for (const [id, spec] of Object.entries(input.locations)) {
    locations[id] = { ...spec, adjacent: [...spec.adjacent] }
  }

  const actors: Record<string, ActorState> = {}
  for (const definition of input.definitions) {
    actors[definition.id] = {
      id: definition.id,
      location: definition.location,
      traits: { ...definition.traits },
      memory: [],
      beliefs: definition.initialBeliefs.map(belief => ({
        claim: belief.claim,
        confidence: belief.confidence,
        source: 'initial',
        turn: 0,
      })),
      plans: [],
      awakeTurns: [],
    }
  }
  return {
    sceneId: input.sceneId,
    turn: 0,
    locations,
    actors,
    player: {
      location: input.playerLocation,
      inventory: [...(input.playerInventory ?? [])],
      oocStrikes: 0,
    },
    items: {},
    flags: {},
  }
}

export function actorById(world: WorldState, id: string): ActorState | undefined {
  return world.actors[id]
}

/** Hai phòng có kề nhau không (theo một trong hai chiều). */
export function areAdjacent(world: WorldState, a: string, b: string): boolean {
  if (a === b) return false
  return (world.locations[a]?.adjacent ?? []).includes(b) || (world.locations[b]?.adjacent ?? []).includes(a)
}

/**
 * Cửa giữa hai chỗ có đang niêm phong không.
 *
 * Niêm phong là thuộc tính của một phía, nhưng chặn theo CẢ HAI chiều: nếu bếp bị niêm phong thì người
 * trong phòng ăn cũng không nghe được gì từ bếp.
 */
export function isBlocked(world: WorldState, a: string, b: string): boolean {
  if (!areAdjacent(world, a, b)) return false
  return world.locations[a]?.sealed === true || world.locations[b]?.sealed === true
}

/** Hai chỗ này có được tính là cùng phòng không (tính cả `sameRoomAs`, ví dụ ngưỡng cửa). */
export function sameRoomWith(world: WorldState, a: string, b: string): boolean {
  if (a === b) return true
  return world.locations[a]?.sameRoomAs === b || world.locations[b]?.sameRoomAs === a
}
