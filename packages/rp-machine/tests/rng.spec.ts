import { describe, expect, it } from 'vitest'
import { createRng, hashSeed } from '../src/rng'

describe('rng có seed', () => {
  it('cùng seed cho cùng chuỗi số', () => {
    const a = createRng(12345)
    const b = createRng(12345)
    const seqA = Array.from({ length: 10 }, () => a.next())
    const seqB = Array.from({ length: 10 }, () => b.next())
    expect(seqA).toEqual(seqB)
  })

  it('seed chữ được băm ổn định', () => {
    expect(hashSeed('xin-chao')).toBe(hashSeed('xin-chao'))
    expect(hashSeed('xin-chao')).not.toBe(hashSeed('xin-chao-2'))
  })

  it('khác seed cho khác chuỗi', () => {
    const a = createRng(1)
    const b = createRng(2)
    expect(Array.from({ length: 6 }, () => a.next())).not.toEqual(Array.from({ length: 6 }, () => b.next()))
  })

  it('int nằm trong khoảng bao gồm hai đầu', () => {
    const rng = createRng('khoang')
    for (let i = 0; i < 500; i++) {
      const value = rng.int(1, 5)
      expect(Number.isInteger(value)).toBe(true)
      expect(value).toBeGreaterThanOrEqual(1)
      expect(value).toBeLessThanOrEqual(5)
    }
  })

  it('int từ chối khoảng rỗng', () => {
    const rng = createRng(1)
    expect(() => rng.int(5, 1)).toThrow(/Khoảng rỗng/)
  })

  it('shuffle không sửa mảng gốc và giữ nguyên phần tử', () => {
    const rng = createRng('xao')
    const source = [1, 2, 3, 4, 5, 6, 7, 8]
    const shuffled = rng.shuffle(source)
    expect(source).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect([...shuffled].sort((a, b) => a - b)).toEqual(source)
  })

  it('sample lấy đúng số lượng và không trùng', () => {
    const rng = createRng('mau')
    const picked = rng.sample(['a', 'b', 'c', 'd'], 3)
    expect(picked).toHaveLength(3)
    expect(new Set(picked).size).toBe(3)
    expect(rng.sample(['a'], 5)).toHaveLength(1)
  })

  it('pick trên mảng rỗng trả undefined', () => {
    expect(createRng(1).pick([])).toBeUndefined()
  })
})
