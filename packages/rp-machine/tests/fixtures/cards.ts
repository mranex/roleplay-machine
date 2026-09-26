import * as path from 'node:path'
import {
  CARD_TYPES,
  type Card,
  type CardCompatibility,
  type CardMechanics,
  type CardType,
  type Visibility,
} from '../../src/card-schema'

export interface CardInit {
  readonly id: string
  readonly type: CardType
  readonly title?: string
  readonly chaos?: number
  readonly tags?: readonly string[]
  readonly prompt?: string
  readonly hiddenTruth?: string
  readonly heavenRule?: string
  readonly contentBoundary?: string
  readonly firstMessage?: string
  readonly visibility?: Visibility
  readonly weight?: number
  readonly compatibility?: Partial<CardCompatibility>
  readonly mechanics?: CardMechanics
  readonly source?: string
  readonly sourcePackId?: string
}

export function makeCard(init: CardInit): Card {
  return {
    schemaVersion: 'rsm-card-v1',
    id: init.id,
    type: init.type,
    title: init.title ?? init.id,
    description: '',
    chaos: init.chaos ?? 2,
    tags: init.tags ?? [],
    compatibility: {
      universal: false,
      domain: [],
      compatibleTags: [],
      requiredAnyTags: [],
      requiredAllTags: [],
      incompatibleTags: [],
      compatibleCardIds: [],
      incompatibleCardIds: [],
      ...init.compatibility,
    },
    visibility: init.visibility ?? (init.type === 'hidden_truth' ? 'gm_only' : 'public'),
    weight: init.weight ?? 10,
    fragments: {
      prompt: init.prompt ?? `Chỉ thị hành vi cho ${init.type} trong cảnh này.`,
      firstMessage: init.firstMessage ?? '',
      hiddenTruth: init.hiddenTruth ?? '',
      heavenRule: init.heavenRule ?? '',
      contentBoundary: init.contentBoundary ?? '',
    },
    generationHints: { tone: [], preferredUse: '', avoidUse: '' },
    qualityNotes: [],
    metadata: {
      author: '',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      source: init.source ?? 'fixture',
      ...(init.sourcePackId === undefined ? {} : { sourcePackId: init.sourcePackId }),
    },
    ...(init.mechanics === undefined ? {} : { mechanics: init.mechanics }),
  }
}

/**
 * Pool "sạch": mọi cặp đều có điểm dương (tag chung + domain chung), không card nào có tag yêu cầu.
 * Nhờ vậy không có cảnh báo mềm nào ⇒ mức `strict` thật sự dùng được. Đây là pool để test strictness.
 */
export function makeCleanPool(): Card[] {
  const theme = { tags: ['chung', 'vampire'], domain: ['core'] }
  return [
    makeCard({ id: 'world_sach', type: 'world', tags: theme.tags, compatibility: { domain: theme.domain }, chaos: 2 }),
    makeCard({ id: 'player_role_sach', type: 'player_role', tags: theme.tags, compatibility: { domain: theme.domain }, chaos: 2,
      contentBoundary: 'Người chơi không được tự nhận có vũ khí. Người chơi không được biết trước cái kết.' }),
    makeCard({ id: 'npc_sach', type: 'npc', tags: theme.tags, compatibility: { domain: theme.domain }, chaos: 3,
      heavenRule: 'Kami-sama declares: kẻ này kiêu hãnh và không bao giờ ra tay trước.' }),
    makeCard({ id: 'opening_sach', type: 'opening', tags: theme.tags, compatibility: { domain: theme.domain }, chaos: 3,
      firstMessage: 'Bạn tỉnh dậy trong một căn bếp đầy khói.' }),
    makeCard({ id: 'pressure_sach', type: 'pressure', tags: theme.tags, compatibility: { domain: theme.domain, universal: true }, chaos: 2,
      prompt: 'Cảnh có một thanh nghi ngờ từ 0 tới 5, bắt đầu ở 1.' }),
    makeCard({ id: 'goal_sach', type: 'goal', tags: theme.tags, compatibility: { domain: theme.domain }, chaos: 3,
      prompt: 'Mục tiêu là thuyết phục hắn ăn ba món.' }),
    makeCard({ id: 'hidden_truth_sach', type: 'hidden_truth', tags: theme.tags, compatibility: { domain: theme.domain }, chaos: 2,
      hiddenTruth: 'CÓ CÁC HIỆP SĨ ĐANG TRỐN DƯỚI SÀN BẾP.' }),
    makeCard({ id: 'chaos_sach', type: 'chaos', tags: theme.tags, compatibility: { domain: theme.domain }, chaos: 2,
      prompt: 'Trong ván này, thời trang có thể áp đảo bản năng.' }),
  ]
}

/**
 * Pool "giàu": có tag yêu cầu và card khai báo cơ chế. Dùng để test strictness (cảnh báo mềm luôn
 * tồn tại nên `strict` không thể đạt) và test vật chất hoá có cấu trúc.
 */
export function makeRichPool(): Card[] {
  const core = { tags: ['chung', 'vampire'], domain: ['gothic'] }
  return [
    makeCard({ id: 'world_giau', type: 'world', tags: [...core.tags, 'castle'], compatibility: { domain: core.domain }, chaos: 3 }),
    makeCard({
      id: 'player_role_giau',
      type: 'player_role',
      tags: [...core.tags, 'chef'],
      compatibility: { domain: core.domain },
      chaos: 2,
      mechanics: {
        forbiddenActions: ['tự nhận có vũ khí', 'tự nhận biết ma thuật'],
        allowedAbilities: ['nấu ăn', 'quan sát'],
      },
      contentBoundary: 'Không được tự nhận là hiệp sĩ. Không được biết trước cái kết.',
    }),
    makeCard({ id: 'npc_giau', type: 'npc', tags: [...core.tags, 'noble'], compatibility: { domain: core.domain, requiredAnyTags: ['castle'] }, chaos: 4,
      heavenRule: 'Kami-sama declares: lời nói dối thời thượng chỉ hiệu lực một lần.' }),
    makeCard({ id: 'opening_giau', type: 'opening', tags: [...core.tags, 'kitchen'], compatibility: { domain: core.domain, requiredAnyTags: ['castle'] }, chaos: 4,
      firstMessage: 'Tiếng chuông từ phòng ăn vang lên.' }),
    makeCard({
      id: 'pressure_giau',
      type: 'pressure',
      tags: [...core.tags, 'survival'],
      compatibility: { domain: core.domain, universal: true },
      chaos: 2,
      mechanics: {
        meters: [
          { id: 'nghi-ngo', label: 'Nghi ngờ', min: 0, max: 5, start: 1, failAt: 5, description: 'Mỗi lời nói hớ đều để lại dấu.' },
          { id: 'thoi-gian', label: 'Thời gian', min: 0, max: 3, start: 0, failAt: 3, description: 'Đêm sắp hết.' },
        ],
      },
    }),
    makeCard({
      id: 'goal_giau',
      type: 'goal',
      tags: [...core.tags, 'food'],
      // Cố tình yêu cầu một tag mà chỉ chính nó có, để luôn sinh cảnh báo mềm ở mức cặp
      // nhưng vẫn hợp lệ ở mức cảnh. Đây là thứ phân biệt `strict` với `soft`.
      compatibility: { domain: core.domain, requiredAllTags: ['food'] },
      chaos: 3,
      mechanics: { winSteps: ['Gieo niềm tin sai lệch', 'Dẫn hắn tự chạm điều kiện chí mạng', 'Giữ mạng tới phút cuối'], loseConditions: ['Bị khai thân phận'] },
    }),
    makeCard({ id: 'hidden_truth_giau', type: 'hidden_truth', tags: [...core.tags, 'secret'], compatibility: { domain: core.domain }, chaos: 2,
      hiddenTruth: 'HIỆP SĨ ĐANG TRỐN DƯỚI SÀN.' }),
    makeCard({ id: 'chaos_giau', type: 'chaos', tags: [...core.tags, 'fashion'], compatibility: { domain: core.domain }, chaos: 2,
      prompt: 'Thời trang có thể áp đảo bản năng một lần.' }),
  ]
}

/** Gốc pool thật đã import từ thư viện Python cũ. */
export function realPoolDir(): string {
  return path.resolve(__dirname, '..', '..', '..', '..', 'pool-v2')
}

/**
 * Pool "đa dạng": nhiều card mỗi loại, mọi cặp đều sạch (tag chung + domain chung, không tag yêu
 * cầu) nên mức `strict` đạt được. Dùng để test tất định và ảnh hưởng của seed.
 */
export function makeVariedPool(perType = 3): Card[] {
  const cards: Card[] = []
  for (const type of CARD_TYPES) {
    for (let index = 0; index < perType; index++) {
      cards.push(makeCard({
        id: `${type}_${index}`,
        type,
        title: `${type} ${index}`,
        chaos: 1 + ((index + type.length) % 5),
        tags: ['chung', 'vampire', `${type}_rieng_${index}`],
        compatibility: { domain: ['core'] },
        ...(type === 'player_role' ? { contentBoundary: 'Người chơi không được tự nhận có vũ khí.' } : {}),
        ...(type === 'hidden_truth' ? { hiddenTruth: `SỰ THẬT ${index}` } : {}),
      }))
    }
  }
  return cards
}

export function allTypesPresent(cards: readonly Card[]): boolean {
  return CARD_TYPES.every(type => cards.some(card => card.type === type))
}
