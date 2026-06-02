/**
 * Copy rendered page HTML for external design review.
 */
const STRIP_SCRIPT_RE = /<script\b[\s\S]*?<\/script>/gi
const VITE_CLIENT_RE = /@vite\/client|vite\/dist\/client|@react-refresh/gi
const CRASH_LOG_RE = /CRASH LOG|crash-log/i

function inlineStyles(doc: Document, root: HTMLElement): string {
  const links = [...doc.querySelectorAll('link[rel="stylesheet"]')]
  const chunks: string[] = []
  for (const link of links) {
    try {
      const href = link.getAttribute('href')
      if (!href) continue
      const abs = new URL(href, doc.baseURI).href
      chunks.push(`/* ${abs} */`)
    } catch {
      /* ignore */
    }
  }
  return `<style>/* Transport room snapshot — styles load from source app when opened from file:// may need inline pass */</style>`
}

function buildSnapshotHtml(doc: Document): string {
  const room = doc.querySelector('.transport-room')
  const target = room ?? doc.documentElement
  const clone = target.cloneNode(true) as HTMLElement
  clone.querySelectorAll('script').forEach((el) => el.remove())
  let html = clone.outerHTML
  html = html.replace(STRIP_SCRIPT_RE, '')
  html = html.replace(VITE_CLIENT_RE, '')
  const meta = `<meta name="scillm-transport-review" content="snapshot ${new Date().toISOString()}" />`
  const note = '<p style="font:12px system-ui;color:#666">Transport room snapshot — open in browser for layout review. Styles reference ux-lab transport-room.css.</p>'
  return `<!doctype html><html><head><meta charset="utf-8"/>${meta}${inlineStyles(doc)}</head><body>${note}${html}</body></html>`
}

function buildLiveHtml(doc: Document): string {
  const clone = doc.documentElement.cloneNode(true) as HTMLElement
  return `<!doctype html>\n${clone.outerHTML}`
}

export async function copyPageForWebReview(
  root: HTMLElement | Document = document,
  mode: 'live' | 'snapshot' = 'live',
): Promise<void> {
  const doc = root instanceof Document ? root : root.ownerDocument ?? document
  const html = mode === 'snapshot' ? buildSnapshotHtml(doc) : buildLiveHtml(doc)
  await navigator.clipboard.writeText(html)
}

export async function copyLiveDomForWebReview(root?: HTMLElement | Document): Promise<void> {
  return copyPageForWebReview(root, 'live')
}

export async function copyStaticReviewSnapshot(root?: HTMLElement | Document): Promise<void> {
  return copyPageForWebReview(root, 'snapshot')
}
