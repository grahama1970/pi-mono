import '@testing-library/jest-dom/vitest'
import React from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PersonaPlexChatWell } from '../PersonaPlexChatWell'

describe('PersonaPlexChatWell', () => {
  it('renders PersonaPlex mode with qids and engineer flag details', () => {
    render(
      <PersonaPlexChatWell
        mode="personaplex"
        showTracePanel={false}
        initialMessages={[{ id: 'u1', role: 'user', content: 'Embry, can you hear me?' }]}
        initialTraceRows={[
          {
            id: 'gpu',
            label: 'GPU PersonaPlex',
            status: 'ok',
            realFlag: 'real_gpu_personaplex',
            real: true,
            detail: 'LMGen.step generated output',
          },
        ]}
      />,
    )

    expect(screen.getByTestId('personaplex-chat-well')).toHaveAttribute('data-mode', 'personaplex')
    expect(screen.getByText('Embry, can you hear me?')).toBeInTheDocument()
    expect(document.querySelector('[data-qid="sparta:chat:panel"]')).toBeTruthy()
    expect(document.querySelector('[data-qid="sparta:hud:transmit"]')).toBeTruthy()
    expect(screen.getByText('live')).toBeInTheDocument()
  })

  it('renders compliance mode copy', () => {
    render(<PersonaPlexChatWell mode="compliance" showTracePanel={false} />)
    expect(screen.getByTestId('personaplex-chat-well')).toHaveAttribute('data-mode', 'compliance')
    expect(screen.getByText(/SPARTA compliance/)).toBeInTheDocument()
  })
})
