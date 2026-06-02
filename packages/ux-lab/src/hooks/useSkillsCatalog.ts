import { useEffect, useState } from 'react'
import type { Skill } from '../components/shared-chat/types'

/** Load /api/skills for ChatWell slash palette (human, project agent, subagent UIs). */
export function useSkillsCatalog(): Skill[] {
  const [skills, setSkills] = useState<Skill[]>([])

  useEffect(() => {
    let cancelled = false
    fetch('/api/skills')
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        if (!cancelled && Array.isArray(data)) setSkills(data)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  return skills
}
