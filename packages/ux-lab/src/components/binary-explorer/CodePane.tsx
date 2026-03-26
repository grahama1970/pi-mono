/**
 * CodePane — Godbolt-inspired code renderer with syntax highlighting,
 * line numbers, address gutter, and hover callbacks for cross-pane linking.
 *
 * Reusable across code view mode and detail panel code tab.
 */
import { useRef, useCallback, useState } from 'react'
import { EMBRY } from '../common/EmbryStyle'

// ── Token-level syntax highlighting (regex tokenizer) ────────────────────────

type TokenType = 'keyword' | 'register' | 'number' | 'string' | 'comment' | 'label' | 'directive' | 'punctuation' | 'type' | 'function' | 'plain' | 'sizespec' | 'symbol'

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
  sizespec: '#56b6c2',   // cyan — DWORD PTR, QWORD PTR, BYTE PTR, WORD PTR
  symbol: '#e5c07b',     // yellow — known libc/WinAPI import names
}

const ASM_KEYWORDS = /\b(mov|movzx|movsx|movsxd|movabs|movdqu|movdqa|movaps|movups|push|pop|pushf|popf|pushfq|popfq|call|ret|retn|retf|jmp|je|jne|jz|jnz|jg|jl|jge|jle|ja|jb|jae|jbe|js|jns|jo|jno|jp|jnp|jcxz|jecxz|jrcxz|add|sub|mul|div|imul|idiv|inc|dec|neg|not|xor|and|or|shl|shr|sar|sal|rol|ror|rcl|rcr|cmp|test|lea|nop|int|syscall|sysenter|sysexit|sysret|lock|rep|repe|repne|repz|repnz|cdq|cdqe|cbw|cwde|cqo|bsf|bsr|bswap|bt|bts|btr|btc|xchg|xadd|cmpxchg|cmpxchg8b|cmpxchg16b|leave|enter|hlt|pause|lfence|mfence|sfence|endbr32|endbr64|cmove|cmovne|cmovz|cmovnz|cmovg|cmovge|cmovl|cmovle|cmova|cmovae|cmovb|cmovbe|cmovs|cmovns|cmovo|cmovno|sete|setne|setz|setnz|setg|setge|setl|setle|seta|setae|setb|setbe|sets|setns|seto|setno|lahf|sahf|stc|clc|std|cld|sti|cli|rdtsc|rdtscp|cpuid|nop|ud2|int3|into|iret|iretd|iretq|popfd|pushfd|pushfq|popfq|vmovdqu|vmovdqa|vpxor|vpand|vpor|vpcmpeqb|vpcmpeqd|vpsubb|vpsubw|vpsubd|vpsllq|vpsrlq|addss|subss|mulss|divss|addsd|subsd|mulsd|divsd|xorps|xorpd|andps|andpd|orps|orpd|comisd|comiss|ucomisd|ucomiss|cvtsi2sd|cvtsi2ss|cvttsd2si|cvttss2si)\b/g
// Intel syntax registers — size specifiers (DWORD/QWORD/etc.) are NOT registers; kept separate below
const ASM_REGISTERS = /\b(rax|rbx|rcx|rdx|rsi|rdi|rbp|rsp|r8|r9|r10|r11|r12|r13|r14|r15|r8d|r9d|r10d|r11d|r12d|r13d|r14d|r15d|r8w|r9w|r10w|r11w|r12w|r13w|r14w|r15w|r8b|r9b|r10b|r11b|r12b|r13b|r14b|r15b|eax|ebx|ecx|edx|esi|edi|ebp|esp|ax|bx|cx|dx|si|di|bp|sp|al|bl|cl|dl|ah|bh|ch|dh|cs|ds|es|fs|gs|ss|rip|eip|ip|xmm0|xmm1|xmm2|xmm3|xmm4|xmm5|xmm6|xmm7|xmm8|xmm9|xmm10|xmm11|xmm12|xmm13|xmm14|xmm15|ymm0|ymm1|ymm2|ymm3|ymm4|ymm5|ymm6|ymm7|ymm8|ymm9|ymm10|ymm11|ymm12|ymm13|ymm14|ymm15|zmm0|zmm1|zmm2|zmm3|zmm4|zmm5|zmm6|zmm7|zmm8|zmm9|zmm10|zmm11|zmm12|zmm13|zmm14|zmm15|st0|st1|st2|st3|st4|st5|st6|st7|mm0|mm1|mm2|mm3|mm4|mm5|mm6|mm7|cr0|cr2|cr3|cr4|cr8|dr0|dr1|dr2|dr3|dr6|dr7)\b/g
// AT&T syntax: %register (percent-prefixed)
const ASM_REGISTERS_ATT = /%([re]?[abcd]x|[re]?[sd]i|[re]?[sb]p|r(?:1[0-5]|[89])[dwb]?|r(?:1[0-5]|[89])|[re]ip|[re]flags|[abcd][lh]|[csdefs]s|xmm\d{1,2}|ymm\d{1,2}|zmm\d{1,2}|mm[0-7]|st[0-7])\b/g
// Intel size specifiers (operand width qualifiers, not registers)
const ASM_SIZE_SPECS = /\b(BYTE|WORD|DWORD|QWORD|OWORD|TBYTE|XMMWORD|YMMWORD|ZMMWORD|PTR)\b/g
// Known libc / POSIX / Windows API / C++ runtime symbols commonly seen in disassembly
const ASM_KNOWN_SYMBOLS = /\b(printf|fprintf|sprintf|snprintf|vprintf|vfprintf|vsprintf|vsnprintf|scanf|fscanf|sscanf|malloc|calloc|realloc|free|cfree|malloc_usable_size|posix_memalign|aligned_alloc|memcpy|memmove|memset|memcmp|memchr|memrchr|strlen|strnlen|strcpy|strncpy|stpcpy|stpncpy|strcmp|strncmp|strcasecmp|strncasecmp|strcat|strncat|strchr|strrchr|strstr|strtok|strtok_r|strtol|strtoul|strtoll|strtoull|strtod|strtof|strtold|atoi|atol|atoll|atof|fopen|fclose|fread|fwrite|fseek|fseeko|ftell|ftello|rewind|fflush|fgetc|fputc|fgets|fputs|getc|putc|getchar|putchar|ungetc|ferror|feof|clearerr|fileno|fdopen|popen|pclose|exit|_exit|abort|atexit|at_quick_exit|quick_exit|getenv|putenv|setenv|unsetenv|system|qsort|bsearch|rand|srand|rand_r|time|clock|difftime|mktime|localtime|gmtime|strftime|gettimeofday|clock_gettime|nanosleep|sleep|usleep|open|close|read|write|lseek|pread|pwrite|stat|fstat|lstat|access|chmod|chown|unlink|rename|mkdir|rmdir|getcwd|chdir|fork|exec|execv|execvp|execve|waitpid|wait|kill|signal|sigaction|mmap|munmap|mprotect|brk|sbrk|ioctl|fcntl|pipe|dup|dup2|socket|bind|connect|listen|accept|send|recv|sendto|recvfrom|sendmsg|recvmsg|setsockopt|getsockopt|shutdown|closesocket|WSAStartup|WSACleanup|WSAGetLastError|CreateFileA|CreateFileW|ReadFile|WriteFile|CloseHandle|VirtualAlloc|VirtualFree|VirtualProtect|VirtualQuery|HeapAlloc|HeapFree|HeapCreate|HeapDestroy|LocalAlloc|LocalFree|GlobalAlloc|GlobalFree|LoadLibraryA|LoadLibraryW|FreeLibrary|GetProcAddress|GetModuleHandleA|GetModuleHandleW|CreateProcessA|CreateProcessW|OpenProcess|TerminateProcess|GetCurrentProcess|GetCurrentThread|WaitForSingleObject|WaitForMultipleObjects|CreateThread|ExitThread|GetLastError|SetLastError|RegOpenKeyA|RegOpenKeyW|RegCloseKey|RegQueryValueA|RegQueryValueW|RegSetValueA|RegSetValueW|MessageBoxA|MessageBoxW|GetTickCount|GetTickCount64|QueryPerformanceCounter|QueryPerformanceFrequency|__libc_start_main|__stack_chk_fail|__stack_chk_guard|__cxa_allocate_exception|__cxa_throw|__cxa_begin_catch|__cxa_end_catch|__cxa_rethrow|__cxa_free_exception|__gxx_personality_v0|__dso_handle|_ZdlPv|_Znwm|_Znam|_ZdaPv|operator_new|operator_delete)\b/g
const C_KEYWORDS = /\b(if|else|for|while|do|switch|case|break|continue|return|goto|sizeof|typedef|struct|union|enum|const|static|extern|volatile|inline|register|auto|signed|unsigned|restrict|_Bool|_Complex|_Imaginary)\b/g
const C_TYPES = /\b(void|int|char|short|long|float|double|size_t|ssize_t|uint8_t|uint16_t|uint32_t|uint64_t|int8_t|int16_t|int32_t|int64_t|bool|FILE|NULL|true|false)\b/g
const PY_KEYWORDS = /\b(def|class|if|elif|else|for|while|try|except|finally|with|as|import|from|return|yield|raise|pass|break|continue|lambda|and|or|not|in|is|assert|del|global|nonlocal|async|await|None|True|False|self)\b/g

function tokenizeLine(text: string, language: 'asm' | 'c' | 'python'): Token[] {
  if (!text) return [{ text: ' ', type: 'plain' }]

  // Comment detection (full line)
  const trimmed = text.trimStart()
  if (language === 'asm' && (trimmed.startsWith(';') || trimmed.startsWith('#'))) {
    return [{ text, type: 'comment' }]
  }
  if (language === 'c' && trimmed.startsWith('//')) {
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

  // Inline comment detection — split off trailing comment before tokenizing code
  // ASM: find first ';' not inside a string
  // C/Python: find '//' or '#' not inside a string
  let codepart = text
  let commentSuffix: string | null = null

  if (language === 'asm') {
    const idx = text.indexOf(';')
    if (idx >= 0) { codepart = text.slice(0, idx); commentSuffix = text.slice(idx) }
  } else if (language === 'c') {
    const idx = text.indexOf('//')
    if (idx >= 0) { codepart = text.slice(0, idx); commentSuffix = text.slice(idx) }
  } else if (language === 'python') {
    // Find '#' not inside a string — scan char by char tracking quote state
    let inStr = false; let strChar = ''; let pyCommentIdx = -1
    for (let ci = 0; ci < text.length; ci++) {
      const ch = text[ci]
      if (inStr) { if (ch === strChar && text[ci - 1] !== '\\') inStr = false }
      else if (ch === '"' || ch === "'") { inStr = true; strChar = ch }
      else if (ch === '#') { pyCommentIdx = ci; break }
    }
    if (pyCommentIdx >= 0) { codepart = text.slice(0, pyCommentIdx); commentSuffix = text.slice(pyCommentIdx) }
  }

  // Token-level splitting
  const tokens: Token[] = []
  const remaining = codepart

  const patterns: { regex: RegExp; type: TokenType }[] =
    language === 'asm' ? [
      { regex: ASM_KEYWORDS, type: 'keyword' },
      { regex: ASM_KNOWN_SYMBOLS, type: 'symbol' },
      { regex: ASM_SIZE_SPECS, type: 'sizespec' },
      { regex: ASM_REGISTERS, type: 'register' },
      { regex: ASM_REGISTERS_ATT, type: 'register' },
      // Hex address/immediate: uppercase with 0x prefix for display consistency
      { regex: /0x[0-9a-fA-F]+/g, type: 'number' },
      { regex: /\b\d+\b/g, type: 'number' },
      { regex: /"[^"]*"|'[^']*'/g, type: 'string' },
    ] : language === 'c' ? [
      { regex: C_KEYWORDS, type: 'keyword' },
      { regex: C_TYPES, type: 'type' },
      { regex: /\b[a-zA-Z_]\w*(?=\s*\()/g, type: 'function' },
      { regex: /0x[0-9a-fA-F]+|\b\d+(?:\.\d+)?\b/g, type: 'number' },
      { regex: /"[^"]*"|'[^']*'/g, type: 'string' },
    ] : [
      { regex: PY_KEYWORDS, type: 'keyword' },
      // ctypes / struct / bytes types common in binary analysis pseudocode
      { regex: /\b(int|str|bytes|bytearray|bool|float|list|dict|tuple|set|type|object|memoryview|c_uint8|c_uint16|c_uint32|c_uint64|c_int8|c_int16|c_int32|c_int64|c_char|c_void_p|c_size_t|Structure|Union|POINTER|Array)\b/g, type: 'type' },
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

  // Append inline comment as a single comment token
  if (commentSuffix) tokens.push({ text: commentSuffix, type: 'comment' })

  return tokens.length > 0 ? tokens : [{ text, type: 'plain' }]
}

// ── Basic block & obfuscation analysis ───────────────────────────────────────

const isBlockEnd = (line: string) => {
  const t = line.trim().split(/\s+/)[0].toLowerCase().replace(/^(lock|rep[ne]?z?)\s+/, '')
  return /^(ret|retn|retf|jmp|ud2|hlt)$/.test(t)
}
const isLabelLine = (line: string) => /^\s*[.\w]+:/.test(line)

interface ObfuscationAnalysis {
  deadCodeLines: Set<number>
  nopSledLines: Set<number>
  opaquePredLines: Set<number>
}

function analyzeObfuscation(lines: string[]): ObfuscationAnalysis {
  const deadCodeLines = new Set<number>()
  const nopSledLines = new Set<number>()
  const opaquePredLines = new Set<number>()
  let inDeadCode = false

  lines.forEach((line, i) => {
    const trimmed = line.trim()
    if (!trimmed) { inDeadCode = false; return }

    if (inDeadCode) {
      if (isLabelLine(line)) {
        inDeadCode = false
      } else {
        deadCodeLines.add(i)
      }
    }

    if (!inDeadCode && isBlockEnd(line)) inDeadCode = true

    // NOP sled: single nop or string of nops
    if (/^\s*nop\b/i.test(line)) nopSledLines.add(i)

    // Opaque predicate candidates: xor reg,reg or cmp reg,const before a conditional jump
    if (/^\s*(xor\s+\w+,\s*\w+|cmp\s+\w+,\s*(0x[0-9a-fA-F]+|\d+))\b/i.test(line)) {
      const next = lines[i + 1]?.trim() ?? ''
      if (/^(je|jne|jz|jnz|jg|jl|jge|jle|ja|jb|jae|jbe)\b/i.test(next)) {
        opaquePredLines.add(i)
        opaquePredLines.add(i + 1)
      }
    }
  })

  return { deadCodeLines, nopSledLines, opaquePredLines }
}

// ── Assembly helpers ──────────────────────────────────────────────────────────

const BRANCH_MNEMONICS = /^\s*(jmp|je|jne|jz|jnz|jg|jl|jge|jle|ja|jb|jae|jbe|js|jns|jo|jno|jp|jnp|jcxz|jecxz|jrcxz|call)\s+/i

/** Extract the branch/call target operand (label name or hex address) from an asm line. */
function parseBranchTarget(line: string): string | null {
  const m = line.match(/^\s*(?:lock\s+)?(?:j\w+|call)\s+((?:0x[0-9a-fA-F]+|\w[\w.@$+\-]*))(?:\s|$)/i)
  return m ? m[1] : null
}

/** Format a numeric address as zero-padded uppercase hex (8 digits for 32-bit, 16 for 64-bit). */
function formatAddress(addr: string | number): string {
  if (typeof addr === 'number') {
    const hex = addr.toString(16).toUpperCase()
    // Heuristic: ≤ 0xFFFFFFFF → 32-bit (8 digits), else 64-bit (16 digits)
    return addr <= 0xFFFFFFFF ? `0x${hex.padStart(8, '0')}` : `0x${hex.padStart(16, '0')}`
  }
  // Already a string — normalise: if it starts with 0x, uppercase the hex digits
  if (/^0x[0-9a-fA-F]+$/i.test(addr)) {
    const hex = addr.slice(2).toUpperCase()
    return `0x${hex.padStart(hex.length <= 8 ? 8 : 16, '0')}`
  }
  return addr
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
  /** Show copy-to-clipboard button in header */
  showCopyButton?: boolean
  /** Max height (CSS) */
  maxHeight?: string
  /** Header label */
  header?: string
  /** data-testid for the root element */
  testId?: string
  /** Enable obfuscation pattern hints: dead code, NOP sleds, opaque predicate candidates */
  obfuscationHints?: boolean
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
  showCopyButton = false,
  maxHeight = '100%',
  header,
  testId,
  obfuscationHints = false,
}: CodePaneProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [copied, setCopied] = useState(false)
  const lines = code.split('\n')

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }).catch(() => {/* ignore clipboard errors */})
  }, [code])

  const handleMouseEnter = useCallback((i: number) => onLineHover?.(i), [onLineHover])
  const handleMouseLeave = useCallback(() => onLineHover?.(null), [onLineHover])

  // Obfuscation analysis (ASM only, gated on prop)
  const obfAnalysis: ObfuscationAnalysis | null =
    language === 'asm' && obfuscationHints ? analyzeObfuscation(lines) : null

  // Branch target index: label name → line index (for visual branch connection)
  const labelIndex = new Map<string, number>()
  if (language === 'asm') {
    lines.forEach((line, i) => {
      const m = line.match(/^\s*([.\w@$]+):/)
      if (m) labelIndex.set(m[1], i)
    })
  }

  return (
    <div data-testid={testId ?? 'code-pane'} style={{ display: 'flex', flexDirection: 'column', height: '100%', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, background: '#1e1e1e' }}>
      {header && (
        <div style={{ padding: '4px 12px', borderBottom: `1px solid ${EMBRY.border}`, fontSize: 9, fontWeight: 700, color: EMBRY.dim, textTransform: 'uppercase', background: '#252526', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ flex: 1 }}>{header}</span>
          {showCopyButton && (
            <button
              data-testid="code-pane-copy"
              onClick={handleCopy}
              title="Copy to clipboard"
              style={{
                fontSize: 8, padding: '1px 6px', background: copied ? `${EMBRY.green}20` : 'transparent',
                border: `1px solid ${copied ? EMBRY.green : EMBRY.border}`, color: copied ? EMBRY.green : EMBRY.dim,
                borderRadius: 2, cursor: 'pointer', fontWeight: 700, letterSpacing: '0.5px',
              }}
            >{copied ? 'COPIED' : 'COPY'}</button>
          )}
        </div>
      )}
      <div ref={scrollRef} style={{ flex: 1, overflow: 'auto', maxHeight }}>
        <pre style={{ margin: 0, padding: 0 }}>
          {lines.map((line, i) => {
            const tokens = tokenizeLine(line, language)
            const isHighlighted = highlightedLines?.has(i)
            const addr = addresses?.[i]
            const opcode = opcodes?.[i]
            // Basic block separator: insert a thin rule before a label line that follows
            // a non-empty, non-label previous line (i.e., start of a new block)
            const showBlockSeparator = language === 'asm' && i > 0 && isLabelLine(line) && lines[i - 1].trim() !== ''
            const blockEnd = language === 'asm' && isBlockEnd(line)

            // Branch target indicator: resolve target label to a line number if possible
            const isBranchLine = language === 'asm' && BRANCH_MNEMONICS.test(line)
            const branchTarget = isBranchLine ? parseBranchTarget(line) : null
            const branchTargetLine = branchTarget != null ? labelIndex.get(branchTarget) : undefined
            const branchTargetDisplay = branchTarget != null
              ? (branchTargetLine != null ? `→ L${branchTargetLine + 1}` : `→ ${branchTarget}`)
              : null

            // Obfuscation hint backgrounds (layered under highlight)
            const isDeadCode = obfAnalysis?.deadCodeLines.has(i)
            const isNopSled = obfAnalysis?.nopSledLines.has(i)
            const isOpaquePred = obfAnalysis?.opaquePredLines.has(i)
            const obfBg = isHighlighted ? highlightColor
              : isDeadCode ? '#1a0f0f'
              : isNopSled ? '#0f1a10'
              : isOpaquePred ? '#1a140a'
              : 'transparent'

            return (
              <div key={i}>
              {showBlockSeparator && (
                <div data-testid="asm-block-separator" style={{ height: 1, background: '#2a2a2a', margin: '4px 0', borderTop: '1px solid #2d2d2d' }} />
              )}
              <div
                data-block-end={blockEnd ? 'true' : undefined}
                data-dead-code={isDeadCode ? 'true' : undefined}
                data-nop-sled={isNopSled ? 'true' : undefined}
                data-opaque-pred={isOpaquePred ? 'true' : undefined}
                style={{
                  display: 'flex',
                  minHeight: 20,
                  background: obfBg,
                  borderBottom: blockEnd ? '1px solid #2d2d2d' : undefined,
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

                {/* Address gutter (optional) — zero-padded uppercase hex (8 or 16 digits) */}
                {showAddresses && (
                  <span style={{
                    width: 110, textAlign: 'right', paddingRight: 8,
                    color: '#5a5a6a', fontSize: 10, userSelect: 'none', flexShrink: 0,
                    fontVariantNumeric: 'tabular-nums',
                  }}>
                    {addr != null ? formatAddress(addr) : ''}
                  </span>
                )}

                {/* Opcode bytes (optional) — wide enough for 15-byte encodings (e.g. VEX/EVEX) */}
                {showOpcodes && opcode && (
                  <span style={{
                    width: 150, color: '#4a5568', fontSize: 9,
                    paddingRight: 8, flexShrink: 0, letterSpacing: '0.5px',
                    fontVariantNumeric: 'tabular-nums',
                  }}>{opcode}</span>
                )}

                {/* Tokenized code content */}
                <span style={{ padding: '0 8px', whiteSpace: 'pre', flex: 1 }}>
                  {tokens.map((tok, ti) => (
                    <span key={ti} style={{ color: isDeadCode ? '#4a3a3a' : TOKEN_COLORS[tok.type] }}>{tok.text}</span>
                  ))}
                </span>

                {/* Obfuscation hint badges */}
                {isDeadCode && <span title="Unreachable code (after unconditional transfer)" style={{ fontSize: 8, color: '#7a3a3a', paddingRight: 6, flexShrink: 0, userSelect: 'none', alignSelf: 'center' }}>DEAD</span>}
                {isNopSled && <span title="NOP sled — possible padding or anti-disassembly" style={{ fontSize: 8, color: '#3a7a3a', paddingRight: 6, flexShrink: 0, userSelect: 'none', alignSelf: 'center' }}>NOP</span>}
                {isOpaquePred && <span title="Potential opaque predicate candidate" style={{ fontSize: 8, color: '#7a6a2a', paddingRight: 6, flexShrink: 0, userSelect: 'none', alignSelf: 'center' }}>OP?</span>}
              </div>
              </div>
            )
          })}
        </pre>
      </div>
    </div>
  )
}

export { tokenizeLine, TOKEN_COLORS, analyzeObfuscation, isBlockEnd, isLabelLine }
export type { Token, TokenType, CodePaneProps, ObfuscationAnalysis }
