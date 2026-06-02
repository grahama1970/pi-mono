/**
 * Scan installed Embry skills (SKILL.md) for ux-lab /api/skills and ChatWell palette.
 */
import { readdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, resolve } from 'node:path'

export interface SkillCatalogEntry {
  name: string
  description: string
  triggers: string[]
}

const PI_SKILLS = resolve(import.meta.dirname, '../../../.pi/skills')
const CLAUDE_SKILLS = resolve(homedir(), '.claude/skills')

function parseFrontmatter(raw: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of raw.split('\n')) {
    const idx = line.indexOf(':')
    if (idx < 1) continue
    const key = line.slice(0, idx).trim()
    let val = line.slice(idx + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    out[key] = val
  }
  return out
}

function parseTriggers(meta: Record<string, string>, body: string): string[] {
  const fromMeta = (meta.triggers || meta.trigger || '').split(/[,;|]/).map((t) => t.trim()).filter(Boolean)
  if (fromMeta.length) return fromMeta
  const m = body.match(/Triggers?:\s*([^\n]+)/i)
  if (!m) return []
  return m[1].split(/[,;|]/).map((t) => t.trim()).filter(Boolean)
}

async function readSkill(skillDir: string, skillPath: string): Promise<SkillCatalogEntry | null> {
  try {
    const raw = await readFile(skillPath, 'utf8')
    const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/)
    const meta = fm ? parseFrontmatter(fm[1]) : {}
    const body = fm ? raw.slice(fm[0].length) : raw
    const dirName = basename(skillDir)
    const name = (meta.name || dirName).replace(/^\//, '').trim()
    if (!name || name.startsWith('.')) return null
    const description = (meta.description || '').trim() || `/${name} skill`
    return { name, description, triggers: parseTriggers(meta, body) }
  } catch {
    return null
  }
}

async function scanRoot(root: string): Promise<SkillCatalogEntry[]> {
  if (!existsSync(root)) return []
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  const skills: SkillCatalogEntry[] = []
  for (const ent of entries) {
    if (!ent.isDirectory() || ent.name.startsWith('.')) continue
    const skillPath = resolve(root, ent.name, 'SKILL.md')
    if (!existsSync(skillPath)) continue
    const skill = await readSkill(resolve(root, ent.name), skillPath)
    if (skill) skills.push(skill)
  }
  return skills
}

/** Deduplicate by skill name; pi-mono wins over ~/.claude on conflicts. */
export async function listSkillsCatalog(): Promise<SkillCatalogEntry[]> {
  const merged = new Map<string, SkillCatalogEntry>()
  for (const skill of await scanRoot(CLAUDE_SKILLS)) {
    merged.set(skill.name, skill)
  }
  for (const skill of await scanRoot(PI_SKILLS)) {
    merged.set(skill.name, skill)
  }
  return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name))
}
