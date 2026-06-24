import React from 'react'
import { createRoot } from 'react-dom/client'
import { PersonaPlexTestPage } from './PersonaPlexTestPage'

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root for PersonaPlex test page')
createRoot(root).render(<PersonaPlexTestPage />)
