import { v4 as uuidv4 } from 'uuid'
import type { CanvasElement } from '../src/types.ts'

export type { CanvasElement } from '../src/types.ts'

type Snapshot = Record<string, CanvasElement>

const MAX_HISTORY = 50

export class CanvasState {
  elements: Record<string, CanvasElement> = {}
  selectedIds: string[] = []
  history: { past: Snapshot[]; future: Snapshot[] } = { past: [], future: [] }

  private pushHistory(): void {
    this.history.past.push(structuredClone(this.elements))
    if (this.history.past.length > MAX_HISTORY) {
      this.history.past = this.history.past.slice(
        this.history.past.length - MAX_HISTORY,
      )
    }
    this.history.future = []
  }

  addElement(element: Omit<CanvasElement, 'id'>): CanvasElement {
    this.pushHistory()
    const id = uuidv4()
    const full: CanvasElement = { ...element, id }
    this.elements[id] = full
    return full
  }

  updateElement(
    id: string,
    updates: Partial<Omit<CanvasElement, 'id'>>,
  ): CanvasElement | null {
    const existing = this.elements[id]
    if (!existing) return null
    this.pushHistory()
    const updated = { ...existing, ...updates, id }
    this.elements[id] = updated
    return updated
  }

  removeElement(id: string): boolean {
    if (!this.elements[id]) return false
    this.pushHistory()
    delete this.elements[id]
    return true
  }

  removeElements(ids: string[]): string[] {
    const toRemove = ids.filter((id) => this.elements[id])
    if (toRemove.length === 0) return []
    this.pushHistory()
    for (const id of toRemove) {
      delete this.elements[id]
    }
    return toRemove
  }

  getElement(id: string): CanvasElement | undefined {
    return this.elements[id]
  }

  getAllElements(): CanvasElement[] {
    return Object.values(this.elements)
  }

  setSelection(ids: string[]): void {
    this.selectedIds = ids
  }

  undo(): boolean {
    if (this.history.past.length === 0) return false
    const previous = this.history.past.pop()!
    this.history.future.unshift(structuredClone(this.elements))
    if (this.history.future.length > MAX_HISTORY) {
      this.history.future = this.history.future.slice(0, MAX_HISTORY)
    }
    this.elements = previous
    return true
  }

  redo(): boolean {
    if (this.history.future.length === 0) return false
    const next = this.history.future.shift()!
    this.history.past.push(structuredClone(this.elements))
    this.elements = next
    return true
  }

  toJSON(): {
    elements: Record<string, CanvasElement>
    selectedIds: string[]
  } {
    return {
      elements: structuredClone(this.elements),
      selectedIds: [...this.selectedIds],
    }
  }

  loadFromJSON(data: Record<string, CanvasElement>): void {
    this.elements = structuredClone(data)
    this.selectedIds = []
    this.history = { past: [], future: [] }
  }

  clear(): void {
    this.elements = {}
    this.selectedIds = []
    this.history = { past: [], future: [] }
  }
}
