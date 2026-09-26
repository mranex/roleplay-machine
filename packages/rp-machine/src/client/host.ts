/**
 * Hợp đồng host mà DSH đưa cho plugin chạy trong trình duyệt.
 *
 * Cố tình khai báo tối thiểu: chỉ những gì panel thật sự dùng. Plugin không
 * import package `@deepseek-ai/*` nào, nên đây là bản sao cục bộ của hợp đồng
 * (mirror của `ctx` phía client), không phải bản đầy đủ.
 */

import type { ComponentType, ReactNode } from 'react'

/** Nội dung do một slot khác trong cây render ra. */
export interface RenderSlot {
  (name: string, owner: object, options?: object): ReactNode
}

/** Một ô đăng ký trong slot registry. */
export interface SlotRegistry {
  inject(name: string, callback: () => (() => void) | void): unknown
  register<P>(
    options: {
      name: string
      id?: string
      key?: string
      label?: string
      priority?: number
      order?: number
      children?: Record<string, { kind: string; scope: string }>
      store?: unknown
      locale?: string
      inject?: (...args: never[]) => unknown
    },
    component: ComponentType<P>,
  ): () => void
  entries(name: string): readonly unknown[]
  subscribe(name: string, listener: () => void): () => void
}

export interface ClientHost {
  slots: SlotRegistry
  sidebarRight: {
    openTab(kind: string, options?: { paneId?: string; revealIfOpened?: boolean }): void
    isExpanded(): boolean
    toggleExpanded(): void
  }
  sidebarRightTabs: {
    register(definition: {
      id: string
      kind: string
      title: (address: string) => string
      guide?: readonly { order: number; title: () => string; description: () => string }[]
    }): () => void
  }
  sessions: {
    list: {
      getSnapshot(): { current?: string; byId: Record<string, { cwd?: string }> }
    }
  }
  effect(callback: () => (() => void) | void, label?: string): unknown
  get(name: string): unknown
}
