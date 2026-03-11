import { Router } from 'express'
import { z } from 'zod'
import { writeFileSync, readFileSync } from 'fs'
import type { CanvasState } from '../canvas-state.ts'
import {
  createDocument,
  addPage,
  removePage,
  saveDocument,
  loadDocument,
  documentFromCurrentState,
} from '../document.ts'
import { registerAgent, clearState as clearWsState } from '../ws-handler.ts'
import type { UxDesignDocument } from '../../src/types.ts'

const SaveSchema = z.object({
  name: z.string().min(1).optional(),
  path: z.string().min(1).optional(),
})

const LoadContentSchema = z.object({
  content: z.string().min(1),
  path: z.undefined().optional(),
})

const LoadPathSchema = z.object({
  path: z.string().min(1),
  content: z.undefined().optional(),
})

const LoadSchema = z.union([LoadContentSchema, LoadPathSchema])

const AddPageSchema = z.object({
  name: z.string().min(1),
})

// In-memory current document state
let currentDocument: UxDesignDocument | null = null

export function getCurrentDocument(): UxDesignDocument | null {
  return currentDocument
}

export function setCurrentDocument(doc: UxDesignDocument | null): void {
  currentDocument = doc
}

function restoreDocumentToCanvas(doc: UxDesignDocument, canvasState: CanvasState): void {
  // Load first page elements onto canvas
  const firstPage = doc.pages[0]
  if (firstPage) {
    canvasState.loadFromJSON(firstPage.elements)
    // Re-register agents from the page
    for (const agent of firstPage.agents) {
      registerAgent({ name: agent.name, color: agent.color, zone: agent.zone })
    }
  }
}

export function createDocumentRouter(canvasState: CanvasState): Router {
  const router = Router()

  // POST /api/v1/document/save
  router.post('/document/save', (req, res) => {
    const result = SaveSchema.safeParse(req.body)
    if (!result.success) {
      res.status(400).json({ error: 'Validation failed', details: result.error.issues })
      return
    }

    const name = result.data.name ?? currentDocument?.name ?? 'Untitled'
    const doc = documentFromCurrentState(name, canvasState)

    // Preserve created timestamp if updating existing doc
    if (currentDocument && currentDocument.name === name) {
      doc.created = currentDocument.created
    }

    currentDocument = doc

    if (result.data.path) {
      try {
        writeFileSync(result.data.path, saveDocument(doc), 'utf-8')
      } catch (err) {
        res.status(500).json({ error: `Failed to write file: ${(err as Error).message}` })
        return
      }
    }

    res.json(doc)
  })

  // POST /api/v1/document/load
  router.post('/document/load', (req, res) => {
    const result = LoadSchema.safeParse(req.body)
    if (!result.success) {
      res.status(400).json({ error: 'Validation failed', details: result.error.issues })
      return
    }

    let jsonContent: string
    if ('content' in result.data && result.data.content) {
      jsonContent = result.data.content
    } else if ('path' in result.data && result.data.path) {
      try {
        jsonContent = readFileSync(result.data.path, 'utf-8')
      } catch (err) {
        res.status(400).json({ error: `Failed to read file: ${(err as Error).message}` })
        return
      }
    } else {
      res.status(400).json({ error: 'Either content or path is required' })
      return
    }

    let doc: UxDesignDocument
    try {
      doc = loadDocument(jsonContent)
    } catch (err) {
      res.status(400).json({ error: `Invalid document: ${(err as Error).message}` })
      return
    }

    // Clear existing state and restore from document
    clearWsState()
    restoreDocumentToCanvas(doc, canvasState)
    currentDocument = doc

    res.json({
      success: true,
      document: doc,
      elements: canvasState.getAllElements(),
    })
  })

  // GET /api/v1/pages
  router.get('/pages', (_req, res) => {
    if (!currentDocument) {
      res.json({ pages: [] })
      return
    }
    res.json({
      pages: currentDocument.pages.map((p) => ({
        id: p.id,
        name: p.name,
        elementCount: Object.keys(p.elements).length,
      })),
    })
  })

  // POST /api/v1/pages
  router.post('/pages', (req, res) => {
    const result = AddPageSchema.safeParse(req.body)
    if (!result.success) {
      res.status(400).json({ error: 'Validation failed', details: result.error.issues })
      return
    }

    if (!currentDocument) {
      currentDocument = createDocument('Untitled')
    }

    currentDocument = addPage(currentDocument, result.data.name)

    res.json({
      pages: currentDocument.pages.map((p) => ({
        id: p.id,
        name: p.name,
        elementCount: Object.keys(p.elements).length,
      })),
    })
  })

  // DELETE /api/v1/pages/:id
  router.delete('/pages/:id', (req, res) => {
    if (!currentDocument) {
      res.status(400).json({ error: 'No document loaded' })
      return
    }

    try {
      currentDocument = removePage(currentDocument, req.params.id)
    } catch (err) {
      res.status(400).json({ error: (err as Error).message })
      return
    }

    res.json({
      pages: currentDocument.pages.map((p) => ({
        id: p.id,
        name: p.name,
        elementCount: Object.keys(p.elements).length,
      })),
    })
  })

  return router
}
