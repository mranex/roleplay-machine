/**
 * RNG tất định cho Roleplay Machine.
 *
 * Vì sao cần tất định: chaos scale, "Thiên Đạo ban ơn" và deck biến cố phải là ngẫu nhiên
 * THẬT (do code quyết) chứ không phải ngẫu nhiên theo cảm hứng của model. Cùng một seed
 * phải dựng lại đúng bộ card, đúng chuỗi biến cố — nhờ vậy ván chơi kiểm chứng lại được
 * và người chơi không thể "đàm phán" với xúc xắc.
 */

/** Băm chuỗi thành số 32 bit (FNV-1a) để nhận seed dạng chữ. */
export function hashSeed(input: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** mulberry32: nhỏ, nhanh, đủ tốt cho việc rút card. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface Rng {
  /** Số thực [0, 1). */
  next(): number
  /** Số nguyên trong [min, max] (bao gồm hai đầu). */
  int(min: number, max: number): number
  /** Chọn một phần tử; mảng rỗng thì trả undefined. */
  pick<T>(items: readonly T[]): T | undefined
  /** Fisher–Yates, không sửa mảng gốc. */
  shuffle<T>(items: readonly T[]): T[]
  /** Lấy `count` phần tử phân biệt; thiếu thì lấy hết. */
  sample<T>(items: readonly T[], count: number): T[]
}

export function createRng(seed: number | string): Rng {
  const numeric = typeof seed === 'number' ? seed >>> 0 : hashSeed(seed)
  const next = mulberry32(numeric)
  return {
    next,
    int(min, max) {
      if (max < min) throw new Error(`Khoảng rỗng: [${min}, ${max}]`)
      return min + Math.floor(next() * (max - min + 1))
    },
    pick(items) {
      if (items.length === 0) return undefined
      return items[Math.floor(next() * items.length)]
    },
    shuffle<T>(items: readonly T[]): T[] {
      const copy = [...items]
      for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1))
        const a = copy[i] as T
        const b = copy[j] as T
        copy[i] = b
        copy[j] = a
      }
      return copy
    },
    sample(items, count) {
      return this.shuffle(items).slice(0, Math.max(0, count))
    },
  }
}
