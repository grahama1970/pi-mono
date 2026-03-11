import { v4 as uuidv4 } from 'uuid'
import { z } from 'zod'
import type {
  UxDesignDocument,
  UxDesignPage,
  UxDesignVariables,
  CanvasElement,
  AgentRegistration,
  CanvasOperation,
} from '../src/types.ts'
import type { CanvasState } from './canvas-state.ts'
import { getAgents, getOpsLog } from './ws-handler.ts'

const MAX_PAGE_OPS = 50

// --- Zod schema for validation on load ---

const CanvasElementSchema = z.object({
  id: z.string(),
  type: z.string(),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  props: z.record(z.string(), z.unknown()),
})

const AgentRegistrationSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
  zone: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
  }).optional(),
  status: z.enum(['idle', 'working', 'done', 'error']),
})

const CanvasOperationSchema = z.object({
  agent: z.string(),
  op: z.enum(['create', 'update', 'delete', 'select']),
  timestamp: z.number(),
  element: z.object({
    type: z.string(),
    id: z.string().optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    props: z.record(z.string(), z.unknown()).optional(),
  }).optional(),
  id: z.string().optional(),
  props: z.record(z.string(), z.unknown()).optional(),
  reason: z.string().optional(),
})

const UxDesignPageSchema = z.object({
  id: z.string(),
  name: z.string(),
  elements: z.record(z.string(), CanvasElementSchema),
  agents: z.array(AgentRegistrationSchema),
  ops_log: z.array(CanvasOperationSchema),
})

const UxDesignVariablesSchema = z.object({
  colors: z.record(z.string(), z.string()),
  spacing: z.record(z.string(), z.number()),
})

const UxDesignDocumentSchema = z.object({
  version: z.literal(1),
  name: z.string().min(1),
  created: z.string(),
  modified: z.string(),
  theme: z.string(),
  pages: z.array(UxDesignPageSchema).min(1),
  variables: UxDesignVariablesSchema,
  brief: z.record(z.string(), z.unknown()).optional(),
})

// --- Document management functions ---

export function createDocument(name: string): UxDesignDocument {
  const now = new Date().toISOString()
  return {
    version: 1,
    name,
    created: now,
    modified: now,
    theme: 'nvis-dark',
    pages: [createPage('Page 1')],
    variables: {
      colors: {},
      spacing: {},
    },
  }
}

function createPage(name: string): UxDesignPage {
  return {
    id: uuidv4(),
    name,
    elements: {},
    agents: [],
    ops_log: [],
  }
}

export function addPage(doc: UxDesignDocument, name: string): UxDesignDocument {
  return {
    ...doc,
    modified: new Date().toISOString(),
    pages: [...doc.pages, createPage(name)],
  }
}

export function removePage(doc: UxDesignDocument, pageId: string): UxDesignDocument {
  if (doc.pages.length <= 1) {
    throw new Error('Cannot remove the last page')
  }
  const filtered = doc.pages.filter((p) => p.id !== pageId)
  if (filtered.length === doc.pages.length) {
    throw new Error(`Page not found: ${pageId}`)
  }
  return {
    ...doc,
    modified: new Date().toISOString(),
    pages: filtered,
  }
}

export function saveDocument(doc: UxDesignDocument): string {
  return JSON.stringify(doc, null, 2)
}

export function loadDocument(json: string): UxDesignDocument {
  const parsed = JSON.parse(json)
  const result = UxDesignDocumentSchema.safeParse(parsed)
  if (!result.success) {
    throw new Error(`Invalid .ux.json document: ${result.error.message}`)
  }
  return result.data as UxDesignDocument
}

export function documentFromCurrentState(
  name: string,
  canvasState: CanvasState,
): UxDesignDocument {
  const now = new Date().toISOString()
  const elements: Record<string, CanvasElement> = structuredClone(canvasState.elements)
  const agents: AgentRegistration[] = getAgents()
  const ops: CanvasOperation[] = getOpsLog(MAX_PAGE_OPS)

  return {
    version: 1,
    name,
    created: now,
    modified: now,
    theme: 'nvis-dark',
    pages: [
      {
        id: uuidv4(),
        name: 'Page 1',
        elements,
        agents,
        ops_log: ops,
      },
    ],
    variables: {
      colors: {},
      spacing: {},
    },
  }
}

export { UxDesignDocumentSchema }
