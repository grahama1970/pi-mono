/**
 * Slash-skill syntax helpers for the transport collaboration room.
 */
import type { Skill } from '../../shared-chat/types'

const SKILL_SLUG_RE = /(?:^|[\s(])(\/([a-z][a-z0-9-]*))/gi

export function extractSkillSlugs(text: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const match of text.matchAll(SKILL_SLUG_RE)) {
    const slug = (match[2] || '').toLowerCase()
    if (slug && !seen.has(slug)) {
      seen.add(slug)
      out.push(slug)
    }
  }
  return out
}

export function primarySkillSlug(text: string, catalog?: Skill[]): string | undefined {
  const slugs = extractSkillSlugs(text)
  if (!slugs.length) return undefined
  if (!catalog?.length) return slugs[0]
  const names = new Set(catalog.map((s) => s.name.toLowerCase()))
  return slugs.find((s) => names.has(s)) ?? slugs[0]
}

export function TransportSkillChips({ text, catalog }: { text: string; catalog?: Skill[] }) {
  const slugs = extractSkillSlugs(text)
  if (!slugs.length) return null
  const known = new Set((catalog ?? []).map((s) => s.name.toLowerCase()))

  return (
    <div className="transport-skill-chips" data-qid="transport:message:skill-chips">
      {slugs.map((slug) => (
        <span
          key={slug}
          className={`transport-skill-chip${known.has(slug) ? '' : ' transport-skill-chip--unknown'}`}
          title={known.has(slug) ? `Registered skill /${slug}` : `Skill-like token /${slug}`}
        >
          /{slug}
        </span>
      ))}
    </div>
  )
}


export function stripSkillSlugs(text: string): string {
  return text.replace(SKILL_SLUG_RE, ' ').replace(/\s+/g, ' ').trim()
}
