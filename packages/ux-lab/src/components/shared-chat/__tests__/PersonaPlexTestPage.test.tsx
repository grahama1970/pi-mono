import '@testing-library/jest-dom/vitest'
import React from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PersonaPlexTestPage } from '../PersonaPlexTestPage'

describe('PersonaPlexTestPage', () => {
  it('renders the standalone Embry test page shell', () => {
    render(<PersonaPlexTestPage />)
    expect(screen.getByText('Embry Live Voice')).toBeInTheDocument()
    expect(document.querySelector('[data-qid="sparta:chat:panel"]')).toBeTruthy()
  })
})
