/**
 * CodePane — Godbolt-inspired code renderer with syntax highlighting,
 * line numbers, address gutter, and hover callbacks for cross-pane linking.
 *
 * Reusable across code view mode and detail panel code tab.
 */
import { useRef, useCallback } from 'react'
import { EMBRY } from '../common/EmbryStyle'

// ── Token-level syntax highlighting (regex tokenizer) ────────────────────────

type TokenType = 'keyword' | 'register' | 'number' | 'string' | 'comment' | 'label' | 'directive' | 'punctuation' | 'type' | 'function' | 'plain'

interface Token { text: string; type: TokenType }

const TOKEN_COLORS: Record<TokenType, string> = {
  keyword: '#c678dd',     // purple — if, else, for, while, return, void, int
  register: '#e06c75',    // red — rax, rbp, rsp, edi, rsi
  number: '#d19a66',      // orange — 0x401000, 42, 0.5
  string: '#98c379',      // green — "hello", 'c'
  comment: '#5c6370',     // gray — //, #, ;
  label: '#61afef',       // blue — main:, .LC0:, sub_401230
  directive: '#56b6c2',   // cyan — .text, .global, .section
  punctuation: '#abb2bf', // light gray — {, }, (, ), [, ]
  type: '#e5c07b',        // yellow — int, char, void, struct, uint64_t
  function: '#61afef',    // blue — printf, malloc, free
  plain: '#abb2bf',       // default
}

const ASM_KEYWORDS = /\b(mov|push|pop|call|ret|jmp|je|jne|jg|jl|jge|jle|ja|jb|jae|jbe|add|sub|mul|div|xor|and|or|not|shl|shr|cmp|test|lea|nop|int|syscall|sysenter|lock|rep|movzx|movsx|cdq|cbw|cwde|imul|idiv)\b/g
const ASM_REGISTERS = /\b(rax|rbx|rcx|rdx|rsi|rdi|rbp|rsp|r8|r9|r10|r11|r12|r13|r14|r15|eax|ebx|ecx|edx|esi|edi|ebp|esp|ax|bx|cx|dx|si|di|bp|sp|al|bl|cl|dl|ah|bh|ch|dh|cs|ds|es|fs|gs|ss|rip|eip|ip|DWORD|QWORD|BYTE|WORD|PTR)\b/g
const C_KEYWORDS = /\b(if|else|for|while|do|switch|case|break|continue|return|goto|sizeof|typedef|struct|union|enum|const|static|extern|volatile|inline|register|auto|signed|unsigned|restrict|_Bool|_Complex|_Imaginary)\b/g
const C_TYPES = /\b(void|int|char|short|long|float|double|size_t|ssize_t|uint8_t|uint16_t|uint32_t|uint64_t|int8_t|int16_t|int32_t|int64_t|bool|FILE|NULL|true|false)\b/g
const PY_KEYWORDS = /\b(def|class|if|elif|else|for|while|try|except|finally|with|as|import|from|return|yield|raise|pass|break|continue|lambda|and|or|not|in|is|None|True|False|self)\b/g

function tokenizeLine(text: string, language: 'asm' | 'c' | 'python'): Token[] {
  if (!text) return [{ text: ' ', type: 'plain' }]

  // Comment detection (full line)
  const trimmed = text.trimStart()
  if (language === 'asm' && (trimmed.startsWith(';') || trimmed.startsWith('#'))) {
    return [{ text, type: 'comment' }]
  }
  if ((language === 'c' || language === 'python') && trimmed.startsWith('//')) {
    return [{ text, type: 'comment' }]
  }
  if (language === 'python' && trimmed.startsWith('#')) {
    return [{ text, type: 'comment' }]
  }

  // Label detection (asm)
  if (language === 'asm' && /^[.\w]+:/.test(trimmed)) {
    return [{ text, type: 'label' }]
  }
  // Directive detection (asm)
  if (language === 'asm' && trimmed.startsWith('.')) {
    return [{ text, type: 'directive' }]
  }

  // Token-level splitting
  const tokens: Token[] = []
  let remaining = text

  const patterns: { regex: RegExp; type: TokenType }[] =
    language === 'asm' ? [
      { regex: ASM_KEYWORDS, type: 'keyword' },
      { regex: ASM_REGISTERS, type: 'register' },
      { regex: /0x[0-9a-fA-F]+|\b\d+\b/g, type: 'number' },
      { regex: /"[^"]*"|'[^']*'/g, type: 'string' },
    ] : language === 'c' ? [
      { regex: C_KEYWORDS, type: 'keyword' },
      { regex: C_TYPES, type: 'type' },
      { regex: /\b[a-zA-Z_]\w*(?=\s*\()/g, type: 'function' },
      { regex: /0x[0-9a-fA-F]+|\b\d+(?:\.\d+)?\b/g, type: 'number' },
      { regex: /"[^"]*"|'[^']*'/g, type: 'string' },
    ] : [
      { regex: PY_KEYWORDS, type: 'keyword' },
      { regex: /\b[a-zA-Z_]\w*(?=\s*\()/g, type: 'function' },
      { regex: /0x[0-9a-fA-F]+|\b\d+(?:\.\d+)?\b/g, type: 'number' },
      { regex: /"[^"]*"|'[^']*'|"""[\s\S]*?"""|'''[\s\S]*?'''/g, type: 'string' },
    ]

  // Simple approach: scan character by character, apply first matching pattern
  // (For performance, this is fine for <500 line source patterns)
  let pos = 0
  while (pos < remaining.length) {
    let bestMatch: { start: number; end: number; type: TokenType } | null = null

    for (const { regex, type } of patterns) {
      regex.lastIndex = pos
      const m = regex.exec(remaining)
      if (m && m.index === pos) {
        if (!bestMatch || m[0].length > (bestMatch.end - bestMatch.start)) {
          bestMatch = { start: m.index, end: m.index + m[0].length, type }
        }
      }
    }

    if (bestMatch && bestMatch.start === pos) {
      tokens.push({ text: remaining.slice(bestMatch.start, bestMatch.end), type: bestMatch.type })
      pos = bestMatch.end
    } else {
      // No match at this position — advance one char as plain
      let nextMatchStart = remaining.length
      for (const { regex } of patterns) {
        regex.lastIndex = pos + 1
        const m = regex.exec(remaining)
        if (m && m.index < nextMatchStart) nextMatchStart = m.index
      }
      tokens.push({ text: remaining.slice(pos, nextMatchStart), type: 'plain' })
      pos = nextMatchStart
    }
  }

  return tokens.length > 0 ? tokens : [{ text, type: 'plain' }]
}

// ── Component ────────────────────────────────────────────────────────────────

interface CodePaneProps {
  code: string
  language: 'asm' | 'c' | 'python'
  /** Optional address for each line (hex string or number) */
  addresses?: (string | number | null)[]
  /** Optional opcode bytes for each line */
  opcodes?: (string | null)[]
  /** Lines to highlight (0-indexed) */
  highlightedLines?: Set<number>
  /** Highlight color for matched lines */
  highlightColor?: string
  /** Callback when a line is hovered */
  onLineHover?: (lineIndex: number | null) => void
  /** Callback when a line is clicked */
  onLineClick?: (lineIndex: number) => void
  /** Show address gutter */
  showAddresses?: boolean
  /** Show opcode bytes */
  showOpcodes?: boolean
  /** Max height (CSS) */
  maxHeight?: string
  /** Header label */
  header?: string
}

export function CodePane({
  code,
  language,
  addresses,
  opcodes,
  highlightedLines,
  highlightColor = '#264f78',
  onLineHover,
  onLineClick,
  showAddresses = false,
  showOpcodes = false,
  maxHeight = '100%',
  header,
}: CodePaneProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const lines = code.split('\n')

  const handleMouseEnter = useCallback((i: number) => onLineHover?.(i), [onLineHover])
  const handleMouseLeave = useCallback(() => onLineHover?.(null), [onLineHover])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, background: '#1e1e1e' }}>
      {header && (
        <div style={{ padding: '4px 12px', borderBottom: `1px solid ${EMBRY.border}`, fontSize: 9, fontWeight: 700, color: EMBRY.dim, textTransform: 'uppercase', background: '#252526', flexShrink: 0 }}>
          {header}
        </div>
      )}
      <div ref={scrollRef} style={{ flex: 1, overflow: 'auto', maxHeight }}>
        <pre style={{ margin: 0, padding: 0 }}>
          {lines.map((line, i) => {
            const tokens = tokenizeLine(line, language)
            const isHighlighted = highlightedLines?.has(i)
            const addr = addresses?.[i]
            const opcode = opcodes?.[i]

            return (
              <div
                key={i}
                style={{
                  display: 'flex',
                  minHeight: 20,
                  background: isHighlighted ? highlightColor : 'transparent',
                  cursor: onLineClick ? 'pointer' : 'default',
                  transition: 'background 0.1s',
                }}
                onMouseEnter={() => handleMouseEnter(i)}
                onMouseLeave={handleMouseLeave}
                onClick={() => onLineClick?.(i)}
              >
                {/* Line number gutter */}
                <span style={{
                  width: 36, textAlign: 'right', paddingRight: 8,
                  color: isHighlighted ? '#8a8a8a' : '#4a4a4a',
                  fontSize: 10, userSelect: 'none', flexShrink: 0,
                  background: '#1a1a1a', borderRight: '1px solid #2d2d2d',
                }}>{i + 1}</span>

                {/* Address gutter (optional) */}
                {showAddresses && (
                  <span style={{
                    width: 70, textAlign: 'right', paddingRight: 8,
                    color: '#5a5a6a', fontSize: 10, userSelect: 'none', flexShrink: 0,
                  }}>
                    {addr != null ? (typeof addr === 'number' ? `0x${addr.toString(16)}` : addr) : ''}
                  </span>
                )}

                {/* Opcode bytes (optional) */}
                {showOpcodes && opcode && (
                  <span style={{
                    width: 90, color: '#4a5568', fontSize: 9,
                    paddingRight: 8, flexShrink: 0, letterSpacing: '0.5px',
                  }}>{opcode}</span>
                )}

                {/* Tokenized code content */}
                <span style={{ padding: '0 8px', whiteSpace: 'pre', flex: 1 }}>
                  {tokens.map((tok, ti) => (
                    <span key={ti} style={{ color: TOKEN_COLORS[tok.type] }}>{tok.text}</span>
                  ))}
                </span>
              </div>
            )
          })}
        </pre>
      </div>
    </div>
  )
}

export { tokenizeLine, TOKEN_COLORS }
export type { Token, TokenType, CodePaneProps }
