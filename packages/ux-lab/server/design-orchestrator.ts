import type { AgentZone, CanvasOperation, CanvasElement } from '../src/types.ts'

// --- Types ---

export interface DesignZone {
  name: string
  zone: AgentZone
  phase: 'skeleton' | 'content' | 'refine'
  description: string
}

export interface DesignPlan {
  prompt: string
  zones: DesignZone[]
  phases: ('skeleton' | 'content' | 'refine')[]
  agentCount: number
}

export interface AgentAssignment {
  agentName: string
  color: string
  zone: DesignZone
  ops: CanvasOperation[][]  // grouped by phase
}

// --- NVIS agent palette (cycling for multiple agents) ---

const AGENT_COLORS = [
  '#00ff88', // GREEN
  '#44aaff', // BLUE
  '#ffaa00', // AMBER
  '#7c3aed', // ACCENT (purple)
  '#ff4444', // RED
]

// --- Keyword matchers ---

interface ZoneKeyword {
  patterns: RegExp[]
  name: string
  description: string
  computeZone: (w: number, h: number) => AgentZone
}

const ZONE_KEYWORDS: ZoneKeyword[] = [
  {
    patterns: [/\bnav(?:bar)?\b/i, /\bheader\b/i, /\btop\s*bar\b/i],
    name: 'navbar',
    description: 'navigation bar at the top',
    computeZone: (w, _h) => ({ x: 0, y: 0, width: w, height: 64 }),
  },
  {
    patterns: [/\bsidebar\b/i, /\bside\s*nav\b/i, /\bside\s*menu\b/i],
    name: 'sidebar',
    description: 'sidebar navigation on the left',
    computeZone: (_w, h) => ({ x: 0, y: 64, width: 250, height: h - 64 }),
  },
  {
    patterns: [/\bfooter\b/i, /\bbottom\s*bar\b/i],
    name: 'footer',
    description: 'footer at the bottom',
    computeZone: (w, h) => ({ x: 0, y: h - 80, width: w, height: 80 }),
  },
  {
    patterns: [/\bcards?\b/i, /\bgrid\b/i, /\btable\b/i, /\bcontent\b/i, /\bdashboard\b/i],
    name: 'content',
    description: 'main content area with cards or data',
    computeZone: (w, h) => ({ x: 0, y: 0, width: w, height: h }),  // placeholder, adjusted later
  },
  {
    patterns: [/\bform\b/i, /\blogin\b/i, /\bsignup\b/i, /\bsign[\s-]?up\b/i, /\bregister\b/i],
    name: 'form',
    description: 'centered form area',
    computeZone: (w, h) => ({
      x: Math.floor(w / 4),
      y: Math.floor(h / 4),
      width: Math.floor(w / 2),
      height: Math.floor(h / 2),
    }),
  },
]

// --- Core functions ---

/**
 * Decomposes a natural language prompt into spatial zones using keyword matching.
 * Deterministic — no LLM calls.
 */
export function decomposePrompt(
  prompt: string,
  canvasWidth = 1280,
  canvasHeight = 720,
): DesignPlan {
  const matchedZones: DesignZone[] = []
  const matchedNames = new Set<string>()

  for (const kw of ZONE_KEYWORDS) {
    for (const pattern of kw.patterns) {
      if (pattern.test(prompt)) {
        if (!matchedNames.has(kw.name)) {
          matchedNames.add(kw.name)
          matchedZones.push({
            name: kw.name,
            zone: kw.computeZone(canvasWidth, canvasHeight),
            phase: 'skeleton',
            description: kw.description,
          })
        }
        break
      }
    }
  }

  // If no keywords matched, create a single full-canvas zone
  if (matchedZones.length === 0) {
    matchedZones.push({
      name: 'main',
      zone: { x: 0, y: 0, width: canvasWidth, height: canvasHeight },
      phase: 'skeleton',
      description: 'full canvas layout',
    })
  }

  // Adjust content zone to avoid overlapping with navbar/sidebar/footer
  const hasNavbar = matchedNames.has('navbar')
  const hasSidebar = matchedNames.has('sidebar')
  const hasFooter = matchedNames.has('footer')

  const contentZone = matchedZones.find((z) => z.name === 'content')
  if (contentZone) {
    const topOffset = hasNavbar ? 64 : 0
    const leftOffset = hasSidebar ? 250 : 0
    const bottomOffset = hasFooter ? 80 : 0
    contentZone.zone = {
      x: leftOffset,
      y: topOffset,
      width: canvasWidth - leftOffset,
      height: canvasHeight - topOffset - bottomOffset,
    }
  }

  return {
    prompt,
    zones: matchedZones,
    phases: ['skeleton', 'content', 'refine'],
    agentCount: matchedZones.length,
  }
}

/**
 * Generates skeleton (layout frame) operations for a zone.
 */
export function generateSkeletonOps(zone: DesignZone): CanvasOperation[] {
  const now = Date.now()
  return [
    {
      agent: '',  // filled in by createAgentAssignments
      op: 'create',
      timestamp: now,
      element: {
        type: 'paper:container',
        x: zone.zone.x,
        y: zone.zone.y,
        width: zone.zone.width,
        height: zone.zone.height,
        props: {
          label: zone.name,
          borderStyle: 'dashed',
          fill: 'transparent',
        },
      },
      reason: `skeleton: create ${zone.name} frame`,
    },
  ]
}

/**
 * Generates content operations for a zone based on its description keywords.
 */
export function generateContentOps(zone: DesignZone): CanvasOperation[] {
  const now = Date.now()
  const ops: CanvasOperation[] = []
  const { x, y, width, height } = zone.zone

  switch (zone.name) {
    case 'navbar':
      ops.push({
        agent: '',
        op: 'create',
        timestamp: now,
        element: {
          type: 'paper:navbar',
          x,
          y,
          width,
          height: 64,
          props: {
            logoText: 'Logo',
            navLinks: ['Home', 'About', 'Contact'],
          },
        },
        reason: 'content: create navbar with logo and links',
      })
      break

    case 'sidebar':
      ops.push({
        agent: '',
        op: 'create',
        timestamp: now,
        element: {
          type: 'paper:container',
          x,
          y,
          width,
          height,
          props: { label: 'sidebar', fill: '#111128' },
        },
        reason: 'content: create sidebar container',
      })
      // Add nav buttons inside sidebar
      for (let i = 0; i < 4; i++) {
        ops.push({
          agent: '',
          op: 'create',
          timestamp: now + i + 1,
          element: {
            type: 'paper:button',
            x: x + 16,
            y: y + 16 + i * 48,
            width: width - 32,
            height: 40,
            props: {
              buttonText: `Menu Item ${i + 1}`,
              variant: 'outline',
              size: 'md',
            },
          },
          reason: `content: sidebar menu item ${i + 1}`,
        })
      }
      break

    case 'content': {
      // Generate card elements in a grid
      const cardWidth = 280
      const cardHeight = 160
      const gap = 24
      const cols = Math.max(1, Math.floor((width - gap) / (cardWidth + gap)))
      const cardCount = Math.min(cols * 2, 6) // up to 2 rows, max 6 cards

      for (let i = 0; i < cardCount; i++) {
        const col = i % cols
        const row = Math.floor(i / cols)
        ops.push({
          agent: '',
          op: 'create',
          timestamp: now + i,
          element: {
            type: 'paper:card',
            x: x + gap + col * (cardWidth + gap),
            y: y + gap + row * (cardHeight + gap),
            width: cardWidth,
            height: cardHeight,
            props: {
              cardTitle: `Card ${i + 1}`,
              cardBody: 'Content goes here',
            },
          },
          reason: `content: card ${i + 1}`,
        })
      }
      break
    }

    case 'form':
      ops.push({
        agent: '',
        op: 'create',
        timestamp: now,
        element: {
          type: 'paper:container',
          x,
          y,
          width,
          height,
          props: { label: 'form', fill: '#111128', borderRadius: 8 },
        },
        reason: 'content: create form container',
      })
      // Title
      ops.push({
        agent: '',
        op: 'create',
        timestamp: now + 1,
        element: {
          type: 'paper:text',
          x: x + 24,
          y: y + 24,
          width: width - 48,
          height: 32,
          props: { text: 'Sign In', textStyle: 'h2' },
        },
        reason: 'content: form title',
      })
      // Input fields (simulated as containers with labels)
      const fields = ['Email', 'Password']
      for (let i = 0; i < fields.length; i++) {
        ops.push({
          agent: '',
          op: 'create',
          timestamp: now + 2 + i,
          element: {
            type: 'paper:container',
            x: x + 24,
            y: y + 80 + i * 56,
            width: width - 48,
            height: 44,
            props: {
              label: fields[i],
              fill: '#1a1a3e',
              borderRadius: 4,
              placeholder: `Enter ${fields[i].toLowerCase()}`,
            },
          },
          reason: `content: form field ${fields[i]}`,
        })
      }
      // Submit button
      ops.push({
        agent: '',
        op: 'create',
        timestamp: now + 4,
        element: {
          type: 'paper:button',
          x: x + 24,
          y: y + 200,
          width: width - 48,
          height: 44,
          props: { buttonText: 'Sign In', variant: 'primary', size: 'lg' },
        },
        reason: 'content: form submit button',
      })
      break

    case 'footer':
      ops.push({
        agent: '',
        op: 'create',
        timestamp: now,
        element: {
          type: 'paper:container',
          x,
          y,
          width,
          height,
          props: { label: 'footer', fill: '#111128' },
        },
        reason: 'content: create footer container',
      })
      ops.push({
        agent: '',
        op: 'create',
        timestamp: now + 1,
        element: {
          type: 'paper:text',
          x: x + 24,
          y: y + 24,
          width: width - 48,
          height: 32,
          props: { text: '© 2026 Company', textStyle: 'body' },
        },
        reason: 'content: footer text',
      })
      break

    default:
      // Generic: single container
      ops.push({
        agent: '',
        op: 'create',
        timestamp: now,
        element: {
          type: 'paper:container',
          x,
          y,
          width,
          height,
          props: { label: zone.name, fill: 'transparent' },
        },
        reason: `content: create ${zone.name} content`,
      })
  }

  return ops
}

/**
 * Generates refinement operations to polish existing elements.
 * Adjusts spacing and applies NVIS palette colors.
 */
export function generateRefineOps(
  zone: DesignZone,
  elements: CanvasElement[],
): CanvasOperation[] {
  const now = Date.now()
  const ops: CanvasOperation[] = []

  for (const el of elements) {
    // Only refine elements within this zone's bounds
    if (
      el.x >= zone.zone.x &&
      el.y >= zone.zone.y &&
      el.x < zone.zone.x + zone.zone.width &&
      el.y < zone.zone.y + zone.zone.height
    ) {
      ops.push({
        agent: '',
        op: 'update',
        timestamp: now,
        id: el.id,
        props: {
          ...(el.props ?? {}),
          fill: el.props?.fill ?? '#111128',
          borderColor: '#505050',
        },
        reason: `refine: polish ${el.type} in ${zone.name}`,
      })
    }
  }

  return ops
}

/**
 * Assigns each zone to an agent with a distinct NVIS color.
 * Groups operations by phase (skeleton, content, refine).
 */
export function createAgentAssignments(plan: DesignPlan): AgentAssignment[] {
  return plan.zones.map((zone, i) => {
    const color = AGENT_COLORS[i % AGENT_COLORS.length]
    const agentName = `${zone.name}-agent`

    const skeletonOps = generateSkeletonOps(zone).map((op) => ({
      ...op,
      agent: agentName,
    }))
    const contentOps = generateContentOps(zone).map((op) => ({
      ...op,
      agent: agentName,
    }))
    // Refine phase starts with no existing elements (plan only — caller provides elements later)
    const refineOps: CanvasOperation[] = []

    return {
      agentName,
      color,
      zone,
      ops: [skeletonOps, contentOps, refineOps],
    }
  })
}
