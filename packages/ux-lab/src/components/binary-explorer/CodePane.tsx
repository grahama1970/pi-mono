/**
 * CodePane — Godbolt-inspired code renderer with syntax highlighting,
 * line numbers, address gutter, and hover callbacks for cross-pane linking.
 *
 * Reusable across code view mode and detail panel code tab.
 */
import { useRef, useCallback, useState } from 'react'
import { EMBRY } from '../common/EmbryStyle'

// ── Token-level syntax highlighting (regex tokenizer) ────────────────────────

type TokenType = 'keyword' | 'register' | 'number' | 'string' | 'comment' | 'label' | 'directive' | 'punctuation' | 'type' | 'function' | 'plain' | 'sizespec' | 'symbol' | 'operator'

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
  operator: '#e06c75',   // red — bitwise/shift ops critical in binary analysis pseudocode (&, |, ^, ~, <<, >>)
}

const ASM_KEYWORDS = /\b(mov|movzx|movsx|movsxd|movabs|movdqu|movdqa|movaps|movups|push|pop|pushf|popf|pushfq|popfq|call|ret|retn|retf|jmp|je|jne|jz|jnz|jg|jl|jge|jle|ja|jb|jae|jbe|js|jns|jo|jno|jp|jnp|jcxz|jecxz|jrcxz|add|sub|mul|div|imul|idiv|inc|dec|neg|not|xor|and|or|shl|shr|sar|sal|rol|ror|rcl|rcr|cmp|test|lea|nop|int|syscall|sysenter|sysexit|sysret|lock|rep|repe|repne|repz|repnz|cdq|cdqe|cbw|cwde|cqo|bsf|bsr|bswap|bt|bts|btr|btc|xchg|xadd|cmpxchg|cmpxchg8b|cmpxchg16b|leave|enter|hlt|pause|lfence|mfence|sfence|endbr32|endbr64|cmove|cmovne|cmovz|cmovnz|cmovg|cmovge|cmovl|cmovle|cmova|cmovae|cmovb|cmovbe|cmovs|cmovns|cmovo|cmovno|sete|setne|setz|setnz|setg|setge|setl|setle|seta|setae|setb|setbe|sets|setns|seto|setno|lahf|sahf|stc|clc|std|cld|sti|cli|rdtsc|rdtscp|cpuid|nop|ud2|int3|into|iret|iretd|iretq|popfd|pushfd|pushfq|popfq|vmovdqu|vmovdqa|vpxor|vpand|vpor|vpcmpeqb|vpcmpeqd|vpsubb|vpsubw|vpsubd|vpsllq|vpsrlq|addss|subss|mulss|divss|addsd|subsd|mulsd|divsd|xorps|xorpd|andps|andpd|orps|orpd|comisd|comiss|ucomisd|ucomiss|cvtsi2sd|cvtsi2ss|cvttsd2si|cvttss2si|ldr|ldrb|ldrh|ldrsb|ldrsh|ldrsw|ldrex|ldxr|ldxrb|ldxrh|ldar|ldarb|ldarh|str|strb|strh|stlex|stlxr|stlxrb|stlxrh|stlr|stlrb|stlrh|ldp|stp|ldur|stur|ldurb|ldurh|ldursb|ldursh|ldursw|adrp|adr|movk|movn|movz|madd|msub|mneg|sdiv|udiv|smull|umull|smulh|umulh|orr|eor|bic|orn|mvn|tst|cmn|cbz|cbnz|tbz|tbnz|bl|blr|bx|blx|br|eret|drps|svc|hvc|smc|brk|dmb|dsb|isb|clrex|prfm|mrs|msr|rev|rev16|rev32|clz|cls|rbit|extr|ubfm|sbfm|bfm|ubfx|sbfx|bfi|bfxil|uxtb|uxth|sxtb|sxth|sxtw|fcmp|fcmpe|fmov|fadd|fsub|fmul|fdiv|fneg|fabs|fsqrt|frintn|frintz|frinta|frintm|frintp|fcvtzs|fcvtzu|scvtf|ucvtf|fcvt|fmla|fmls|fmax|fmin|fmaxnm|fminnm)\b/g
// AT&T size-suffixed mnemonics: b=byte w=word l=long/32-bit q=quad/64-bit; listed longest first to win over base mnemonic
const ASM_KEYWORDS_ATT = /\b(movsbw|movsbl|movsbq|movswl|movswq|movslq|movzbw|movzbl|movzbq|movzwl|movzwq|movabsq|movb|movw|movl|movq|leab|leaw|leal|leaq|pushb|pushw|pushl|pushq|popb|popw|popl|popq|addb|addw|addl|addq|subb|subw|subl|subq|imulb|imulw|imull|imulq|idivb|idivw|idivl|idivq|mulb|mulw|mull|mulq|divb|divw|divl|divq|incb|incw|incl|incq|decb|decw|decl|decq|negb|negw|negl|negq|notb|notw|notl|notq|xorb|xorw|xorl|xorq|andb|andw|andl|andq|orb|orw|orl|orq|shlb|shlw|shll|shlq|shrb|shrw|shrl|shrq|sarb|sarw|sarl|sarq|rolb|rolw|roll|rolq|rorb|rorw|rorl|rorq|cmpb|cmpw|cmpl|cmpq|testb|testw|testl|testq|callq|retq|retl|cltq|cltd|cwtl|cwtd|cqto|flds|fldl|fldt|fsts|fstl|fstps|fstpl|fstpt|fadds|faddl|fsubs|fsubl|fmuls|fmull|fdivs|fdivl)\b/g
// Intel/AArch64 registers — size specifiers (DWORD/QWORD/etc.) are NOT registers; kept separate below
const ASM_REGISTERS = /\b(rax|rbx|rcx|rdx|rsi|rdi|rbp|rsp|r8|r9|r10|r11|r12|r13|r14|r15|r8d|r9d|r10d|r11d|r12d|r13d|r14d|r15d|r8w|r9w|r10w|r11w|r12w|r13w|r14w|r15w|r8b|r9b|r10b|r11b|r12b|r13b|r14b|r15b|eax|ebx|ecx|edx|esi|edi|ebp|esp|ax|bx|cx|dx|si|di|bp|sp|al|bl|cl|dl|ah|bh|ch|dh|cs|ds|es|fs|gs|ss|rip|eip|ip|xmm0|xmm1|xmm2|xmm3|xmm4|xmm5|xmm6|xmm7|xmm8|xmm9|xmm10|xmm11|xmm12|xmm13|xmm14|xmm15|ymm0|ymm1|ymm2|ymm3|ymm4|ymm5|ymm6|ymm7|ymm8|ymm9|ymm10|ymm11|ymm12|ymm13|ymm14|ymm15|zmm0|zmm1|zmm2|zmm3|zmm4|zmm5|zmm6|zmm7|zmm8|zmm9|zmm10|zmm11|zmm12|zmm13|zmm14|zmm15|st0|st1|st2|st3|st4|st5|st6|st7|mm0|mm1|mm2|mm3|mm4|mm5|mm6|mm7|cr0|cr2|cr3|cr4|cr8|dr0|dr1|dr2|dr3|dr6|dr7|x0|x1|x2|x3|x4|x5|x6|x7|x8|x9|x10|x11|x12|x13|x14|x15|x16|x17|x18|x19|x20|x21|x22|x23|x24|x25|x26|x27|x28|x29|x30|w0|w1|w2|w3|w4|w5|w6|w7|w8|w9|w10|w11|w12|w13|w14|w15|w16|w17|w18|w19|w20|w21|w22|w23|w24|w25|w26|w27|w28|w29|w30|xzr|wzr|r0|r1|r2|r3|r4|r5|r6|r7|r8|r9|r10|r11|r12|r13|r14|r15|v0|v1|v2|v3|v4|v5|v6|v7|v8|v9|v10|v11|v12|v13|v14|v15|v16|v17|v18|v19|v20|v21|v22|v23|v24|v25|v26|v27|v28|v29|v30|v31|q0|q1|q2|q3|q4|q5|q6|q7|q8|q9|q10|q11|q12|q13|q14|q15|q16|q17|q18|q19|q20|q21|q22|q23|q24|q25|q26|q27|q28|q29|q30|q31|d0|d1|d2|d3|d4|d5|d6|d7|d8|d9|d10|d11|d12|d13|d14|d15|d16|d17|d18|d19|d20|d21|d22|d23|d24|d25|d26|d27|d28|d29|d30|d31|s0|s1|s2|s3|s4|s5|s6|s7|s8|s9|s10|s11|s12|s13|s14|s15|s16|s17|s18|s19|s20|s21|s22|s23|s24|s25|s26|s27|s28|s29|s30|s31|h0|h1|h2|h3|h4|h5|h6|h7|h8|h9|h10|h11|h12|h13|h14|h15|h16|h17|h18|h19|h20|h21|h22|h23|h24|h25|h26|h27|h28|h29|h30|h31|b0|b1|b2|b3|b4|b5|b6|b7|b8|b9|b10|b11|b12|b13|b14|b15|b16|b17|b18|b19|b20|b21|b22|b23|b24|b25|b26|b27|b28|b29|b30|b31|fp|lr|pc)\b/g
// AT&T syntax: %register (percent-prefixed)
const ASM_REGISTERS_ATT = /%([re]?[abcd]x|[re]?[sd]i|[re]?[sb]p|r(?:1[0-5]|[89])[dwb]?|r(?:1[0-5]|[89])|[re]ip|[re]flags|[abcd][lh]|[csdefs]s|xmm\d{1,2}|ymm\d{1,2}|zmm\d{1,2}|mm[0-7]|st[0-7])\b/g
// Intel size specifiers (operand width qualifiers, not registers)
const ASM_SIZE_SPECS = /\b(BYTE|WORD|DWORD|QWORD|OWORD|TBYTE|XMMWORD|YMMWORD|ZMMWORD|PTR)\b/g
// Known libc / POSIX / Windows API / C++ runtime symbols commonly seen in disassembly
const ASM_KNOWN_SYMBOLS = /\b(printf|fprintf|sprintf|snprintf|vprintf|vfprintf|vsprintf|vsnprintf|scanf|fscanf|sscanf|malloc|calloc|realloc|free|cfree|malloc_usable_size|posix_memalign|aligned_alloc|memcpy|memmove|memset|memcmp|memchr|memrchr|strlen|strnlen|strcpy|strncpy|stpcpy|stpncpy|strcmp|strncmp|strcasecmp|strncasecmp|strcat|strncat|strchr|strrchr|strstr|strtok|strtok_r|strtol|strtoul|strtoll|strtoull|strtod|strtof|strtold|atoi|atol|atoll|atof|fopen|fclose|fread|fwrite|fseek|fseeko|ftell|ftello|rewind|fflush|fgetc|fputc|fgets|fputs|getc|putc|getchar|putchar|ungetc|ferror|feof|clearerr|fileno|fdopen|popen|pclose|exit|_exit|abort|atexit|at_quick_exit|quick_exit|getenv|putenv|setenv|unsetenv|system|qsort|bsearch|rand|srand|rand_r|time|clock|difftime|mktime|localtime|gmtime|strftime|gettimeofday|clock_gettime|nanosleep|sleep|usleep|open|close|read|write|lseek|pread|pwrite|stat|fstat|lstat|access|chmod|chown|unlink|rename|mkdir|rmdir|getcwd|chdir|fork|exec|execv|execvp|execve|waitpid|wait|kill|signal|sigaction|mmap|munmap|mprotect|brk|sbrk|ioctl|fcntl|pipe|dup|dup2|socket|bind|connect|listen|accept|send|recv|sendto|recvfrom|sendmsg|recvmsg|setsockopt|getsockopt|shutdown|closesocket|WSAStartup|WSACleanup|WSAGetLastError|CreateFileA|CreateFileW|ReadFile|WriteFile|CloseHandle|VirtualAlloc|VirtualFree|VirtualProtect|VirtualQuery|HeapAlloc|HeapFree|HeapCreate|HeapDestroy|LocalAlloc|LocalFree|GlobalAlloc|GlobalFree|LoadLibraryA|LoadLibraryW|FreeLibrary|GetProcAddress|GetModuleHandleA|GetModuleHandleW|CreateProcessA|CreateProcessW|OpenProcess|TerminateProcess|GetCurrentProcess|GetCurrentThread|WaitForSingleObject|WaitForMultipleObjects|CreateThread|ExitThread|GetLastError|SetLastError|RegOpenKeyA|RegOpenKeyW|RegCloseKey|RegQueryValueA|RegQueryValueW|RegSetValueA|RegSetValueW|MessageBoxA|MessageBoxW|GetTickCount|GetTickCount64|QueryPerformanceCounter|QueryPerformanceFrequency|__libc_start_main|__stack_chk_fail|__stack_chk_guard|__cxa_allocate_exception|__cxa_throw|__cxa_begin_catch|__cxa_end_catch|__cxa_rethrow|__cxa_free_exception|__gxx_personality_v0|__dso_handle|_ZdlPv|_Znwm|_Znam|_ZdaPv|operator_new|operator_delete)\b/g
const C_KEYWORDS = /\b(if|else|for|while|do|switch|case|break|continue|return|goto|sizeof|typedef|struct|union|enum|const|static|extern|volatile|inline|register|auto|signed|unsigned|restrict|_Bool|_Complex|_Imaginary)\b/g
const C_TYPES = /\b(void|int|char|short|long|float|double|size_t|ssize_t|uint8_t|uint16_t|uint32_t|uint64_t|int8_t|int16_t|int32_t|int64_t|bool|FILE|NULL|true|false)\b/g
const PY_KEYWORDS = /\b(def|class|if|elif|else|for|while|try|except|finally|with|as|import|from|return|yield|raise|pass|break|continue|lambda|and|or|not|in|is|assert|del|global|nonlocal|async|await|None|True|False|self)\b/g
// Bitwise/shift operators are the core logic in binary analysis pseudocode — highlight them distinctly
// so readers can scan mask operations (& 0xFF), bit tests (flags & (1 << n)), rotates, etc. at a glance.
// Compound assignments first so >>= / <<= don't split into >> and =.
const PY_OPERATORS = /(<<=|>>=|&=|\|=|\^=|<<|>>|~)/g
// Known Python stdlib + binary-analysis helpers seen in pseudocode
const PY_KNOWN_SYMBOLS = /\b(struct|binascii|hashlib|hmac|ctypes|zlib|lzma|bz2|base64|codecs|io|os|sys|re|pack|unpack|pack_into|unpack_from|calcsize|hexlify|unhexlify|b2a_hex|a2b_hex|digest|hexdigest|compress|decompress|b64encode|b64decode|open|len|range|enumerate|zip|map|filter|sorted|reversed|list|dict|set|tuple|bytes|bytearray|int|str|hex|bin|oct|ord|chr|abs|min|max|sum|print|repr|isinstance|issubclass|getattr|setattr|hasattr|type|id|hash)\b/g

/**
 * Detect assembly syntax dialect by sampling up to the first 60 lines.
 * Returns 'att' if AT&T indicators (%reg, $imm) dominate,
 * 'arm' if AArch64/AArch32 indicators dominate (x0-x30, w0-w30, adrp, ldp),
 * 'intel' if Intel indicators (PTR, [reg+disp]) dominate, or 'unknown'.
 */
function detectAsmSyntax(code: string): 'intel' | 'att' | 'arm' | 'unknown' {
  const lines = code.split('\n').slice(0, 60)
  let att = 0, intel = 0, arm = 0
  for (const line of lines) {
    if (/%[re]?[abcd]x|%[re]?[sd]i|%[re]?[sb]p|\$0x|\$-?\d/.test(line)) att++
    if (/\bDWORD PTR\b|\bQWORD PTR\b|\bBYTE PTR\b|\bWORD PTR\b|\[r[abcdesbp]/.test(line)) intel++
    if (/\b[xw][0-9]|[xw][12][0-9]|[xw]30\b|\badrp\b|\bldp\b|\bstp\b|\blr\b/.test(line)) arm++
  }
  if (arm > att && arm > intel) return 'arm'
  if (att > intel) return 'att'
  if (intel > att) return 'intel'
  return 'unknown'
}

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
      // AT&T size-suffixed mnemonics before base keywords so movl beats mov
      { regex: ASM_KEYWORDS_ATT, type: 'keyword' },
      { regex: ASM_KEYWORDS, type: 'keyword' },
      { regex: ASM_KNOWN_SYMBOLS, type: 'symbol' },
      { regex: ASM_SIZE_SPECS, type: 'sizespec' },
      { regex: ASM_REGISTERS, type: 'register' },
      { regex: ASM_REGISTERS_ATT, type: 'register' },
      // Hex address/immediate: 0x-prefixed, uppercase hex digits for display consistency
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
      { regex: PY_OPERATORS, type: 'operator' },
      { regex: PY_KNOWN_SYMBOLS, type: 'symbol' },
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
  const trimmed = line.trim().toLowerCase()
  // Strip lock/rep prefix before checking the mnemonic
  const stripped = trimmed.replace(/^(?:lock|rep[ne]?z?)\s+/, '')
  const mnem = stripped.split(/\s+/)[0]
  return /^(ret|retn|retf|jmp|ud2|hlt)$/.test(mnem)
}
const isLabelLine = (line: string) => /^\s*[.\w]+:/.test(line)

interface ObfuscationAnalysis {
  deadCodeLines: Set<number>
  nopSledLines: Set<number>
  opaquePredLines: Set<number>
  /** Lines that look like a CFF dispatcher (cmp state_var, const → je/jne back-edge pattern) */
  cffSuspectLines: Set<number>
}

function analyzeObfuscation(lines: string[]): ObfuscationAnalysis {
  const deadCodeLines = new Set<number>()
  const nopSledLines = new Set<number>()
  const opaquePredLines = new Set<number>()
  const cffSuspectLines = new Set<number>()
  let inDeadCode = false

  // Pass 1: build label → line index map for back-edge detection
  const labelIdx = new Map<string, number>()
  lines.forEach((line, i) => {
    const m = line.match(/^\s*([.\w@$]+):/)
    if (m) labelIdx.set(m[1], i)
  })

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

    // CFF dispatcher heuristic: cmp reg/mem, const followed by a conditional jump
    // whose target is a back-edge (target line < current line) — characteristic of
    // OLLVM-style control flow flattening where the dispatcher routes to basic blocks
    // via a state variable comparison.
    if (/^\s*cmp\s+/i.test(line)) {
      const next = lines[i + 1]?.trim() ?? ''
      const jmpMatch = next.match(/^(je|jne|jz|jnz|jg|jl|jge|jle|ja|jb|jae|jbe)\s+(\S+)/i)
      if (jmpMatch) {
        const target = jmpMatch[2]
        const targetLine = labelIdx.get(target)
        // Back-edge: target is before the cmp — this is the dispatcher loop pattern
        if (targetLine != null && targetLine < i) {
          cffSuspectLines.add(i)
          cffSuspectLines.add(i + 1)
          // Mark the target label line as CFF entry point too
          cffSuspectLines.add(targetLine)
        }
      }
    }
  })

  return { deadCodeLines, nopSledLines, opaquePredLines, cffSuspectLines }
}

// ── Assembly helpers ──────────────────────────────────────────────────────────

const BRANCH_MNEMONICS = /^\s*(jmp|je|jne|jz|jnz|jg|jl|jge|jle|ja|jb|jae|jbe|js|jns|jo|jno|jp|jnp|jcxz|jecxz|jrcxz|call|cbz|cbnz|tbz|tbnz|bl|blr|bx|blx|b\.eq|b\.ne|b\.lt|b\.gt|b\.le|b\.ge|b\.cs|b\.cc|b\.mi|b\.pl|b\.vs|b\.vc|b\.hi|b\.ls)\s+/i

/** Extract the branch/call target operand (label name or hex address) from an asm line. */
function parseBranchTarget(line: string): string | null {
  const m = line.match(/^\s*(?:lock\s+)?(?:j\w+|call|cbz\s+\w+,|cbnz\s+\w+,|tbz\s+\w+,\w+,|tbnz\s+\w+,\w+,|b\.\w+|bl?r?x?)\s+((?:0x[0-9a-fA-F]+|\w[\w.@$+\-]*))(?:\s|$)/i)
  return m ? m[1] : null
}

/** Format a numeric address as zero-padded uppercase hex (8 digits for 32-bit, 16 for 64-bit). */
function formatAddress(addr: string | number): string {
  if (typeof addr === 'number') {
    const hex = addr.toString(16).toUpperCase()
    // Heuristic: ≤ 0xFFFFFFFF → 32-bit (8 digits), else 64-bit (16 digits)
    return addr <= 0xFFFFFFFF ? `0x${hex.padStart(8, '0')}` : `0x${hex.padStart(16, '0')}`
  }
  // Already a string — normalise: if it starts with 0x, uppercase the hex digits and zero-pad
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

  // Syntax dialect detection — shown as a badge in the header
  const asmSyntax = language === 'asm' ? detectAsmSyntax(code) : null

  // Branch target index: label name → line index (for visual branch connection)
  const labelIndex = new Map<string, number>()
  if (language === 'asm') {
    lines.forEach((line, i) => {
      const m = line.match(/^\s*([.\w@$]+):/)
      if (m) labelIndex.set(m[1], i)
    })
  }

  // Obfuscation summary for pipeline integration / legend
  const obfSummary = obfAnalysis ? {
    cff: obfAnalysis.cffSuspectLines.size,
    op: obfAnalysis.opaquePredLines.size,
    dead: obfAnalysis.deadCodeLines.size,
    nop: obfAnalysis.nopSledLines.size,
  } : null

  return (
    <div
      data-testid={testId ?? 'code-pane'}
      data-obfuscation-summary={obfSummary ? JSON.stringify(obfSummary) : undefined}
      style={{ display: 'flex', flexDirection: 'column', height: '100%', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, background: '#1e1e1e' }}
    >
      {header && (
        <div style={{ padding: '4px 12px', borderBottom: `1px solid ${EMBRY.border}`, fontSize: 9, fontWeight: 700, color: EMBRY.dim, textTransform: 'uppercase', background: '#252526', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ flex: 1 }}>{header}</span>
          {/* Syntax dialect badge — Intel / AT&T / ARM / unknown */}
          {asmSyntax && asmSyntax !== 'unknown' && (
            <span
              data-asm-syntax={asmSyntax}
              title={asmSyntax === 'att' ? 'AT&T syntax: %reg, $imm, size suffixes on mnemonics' : asmSyntax === 'arm' ? 'AArch64/AArch32 assembly' : 'Intel syntax: reg, imm, DWORD PTR [reg+disp]'}
              style={{ fontSize: 8, padding: '1px 5px', border: `1px solid ${asmSyntax === 'arm' ? '#4a7a4a' : '#4a5a7a'}`, color: asmSyntax === 'arm' ? '#6abf6a' : '#8aaabf', borderRadius: 2, cursor: 'default' }}
            >{asmSyntax === 'att' ? 'AT&T' : asmSyntax === 'arm' ? 'ARM' : 'INTEL'}</span>
          )}
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
      {obfSummary && (obfSummary.cff > 0 || obfSummary.op > 0 || obfSummary.dead > 0 || obfSummary.nop > 0) && (
        <div style={{ display: 'flex', gap: 8, padding: '3px 12px', background: '#1a1a2e', borderBottom: '1px solid #2d2d3d', flexShrink: 0, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 8, color: '#4a4a6a', textTransform: 'uppercase', fontWeight: 700, marginRight: 4 }}>Obfuscation</span>
          {obfSummary.cff > 0 && (
            <span title={`${obfSummary.cff} lines — control flow flattening suspect (OLLVM-style dispatcher back-edge)`} style={{ fontSize: 8, color: '#6a7abf', background: '#0d0f1a', border: '1px solid #2a2f5a', borderRadius: 2, padding: '1px 5px', cursor: 'default' }}>
              CFF ×{obfSummary.cff}
            </span>
          )}
          {obfSummary.op > 0 && (
            <span title={`${obfSummary.op} lines — opaque predicate candidates (xor/cmp → conditional jump)`} style={{ fontSize: 8, color: '#bf9a3a', background: '#1a140a', border: '1px solid #5a4a1a', borderRadius: 2, padding: '1px 5px', cursor: 'default' }}>
              OP? ×{obfSummary.op}
            </span>
          )}
          {obfSummary.dead > 0 && (
            <span title={`${obfSummary.dead} lines — unreachable code (after unconditional transfer)`} style={{ fontSize: 8, color: '#bf4a4a', background: '#1a0f0f', border: '1px solid #5a2a2a', borderRadius: 2, padding: '1px 5px', cursor: 'default' }}>
              DEAD ×{obfSummary.dead}
            </span>
          )}
          {obfSummary.nop > 0 && (
            <span title={`${obfSummary.nop} lines — NOP sled (padding or anti-disassembly)`} style={{ fontSize: 8, color: '#4abf4a', background: '#0f1a10', border: '1px solid #2a5a2a', borderRadius: 2, padding: '1px 5px', cursor: 'default' }}>
              NOP ×{obfSummary.nop}
            </span>
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

            // Branch target indicator: resolve target label to a line number if possible.
            // Direction arrow: ↑ = back-edge (loop/goto earlier), ↓ = forward branch, → = unresolved
            const isBranchLine = language === 'asm' && BRANCH_MNEMONICS.test(line)
            const branchTarget = isBranchLine ? parseBranchTarget(line) : null
            const branchTargetLine = branchTarget != null ? labelIndex.get(branchTarget) : undefined
            const branchArrow = branchTargetLine != null ? (branchTargetLine < i ? '↑' : '↓') : '→'
            const branchTargetDisplay = branchTarget != null
              ? (branchTargetLine != null ? `${branchArrow} L${branchTargetLine + 1}` : `→ ${branchTarget}`)
              : null
            // Back-edge branches (loops/dispatchers) use a warmer color to stand out
            const branchColor = branchTargetLine != null && branchTargetLine < i ? '#c07a4a' : '#4a7a9a'

            // Obfuscation hint backgrounds (layered under highlight)
            const isDeadCode = obfAnalysis?.deadCodeLines.has(i)
            const isNopSled = obfAnalysis?.nopSledLines.has(i)
            const isOpaquePred = obfAnalysis?.opaquePredLines.has(i)
            const isCff = obfAnalysis?.cffSuspectLines.has(i)
            const obfBg = isHighlighted ? highlightColor
              : isDeadCode ? '#1a0f0f'
              : isNopSled ? '#0f1a10'
              : isCff ? '#0d0f1a'
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
                data-cff-suspect={isCff ? 'true' : undefined}
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

                {/* Opcode bytes (optional) — always reserve the column when showOpcodes=true
                    so alignment is preserved on lines that have no encoding (labels, directives) */}
                {showOpcodes && (
                  <span style={{
                    width: 150, color: '#4a5568', fontSize: 9,
                    paddingRight: 8, flexShrink: 0, letterSpacing: '0.5px',
                    fontVariantNumeric: 'tabular-nums',
                  }}>{opcode ?? ''}</span>
                )}

                {/* Tokenized code content */}
                <span style={{ padding: '0 8px', whiteSpace: 'pre', flex: 1 }}>
                  {tokens.map((tok, ti) => (
                    <span key={ti} style={{ color: isDeadCode ? '#4a3a3a' : TOKEN_COLORS[tok.type] }}>{tok.text}</span>
                  ))}
                </span>

                {/* Branch target indicator — ↑ back-edge (loop), ↓ forward branch, → unresolved */}
                {branchTargetDisplay && (
                  <span
                    data-branch-target={branchTarget ?? undefined}
                    data-branch-target-line={branchTargetLine != null ? String(branchTargetLine) : undefined}
                    title={branchTargetLine != null ? `Branch target: ${branchTarget} (line ${branchTargetLine + 1})` : `Branch target: ${branchTarget}`}
                    style={{ fontSize: 8, color: branchColor, paddingRight: 6, flexShrink: 0, userSelect: 'none', alignSelf: 'center', fontStyle: 'italic' }}
                  >{branchTargetDisplay}</span>
                )}
                {/* Obfuscation hint badges */}
                {isDeadCode && <span title="Unreachable code (after unconditional transfer)" style={{ fontSize: 8, color: '#7a3a3a', paddingRight: 6, flexShrink: 0, userSelect: 'none', alignSelf: 'center' }}>DEAD</span>}
                {isNopSled && <span title="NOP sled — possible padding or anti-disassembly" style={{ fontSize: 8, color: '#3a7a3a', paddingRight: 6, flexShrink: 0, userSelect: 'none', alignSelf: 'center' }}>NOP</span>}
                {isOpaquePred && <span title="Potential opaque predicate candidate" style={{ fontSize: 8, color: '#7a6a2a', paddingRight: 6, flexShrink: 0, userSelect: 'none', alignSelf: 'center' }}>OP?</span>}
                {isCff && <span title="Control flow flattening suspect — dispatcher back-edge (OLLVM-style state variable)" style={{ fontSize: 8, color: '#3a4a7a', paddingRight: 6, flexShrink: 0, userSelect: 'none', alignSelf: 'center' }}>CFF</span>}
              </div>
              </div>
            )
          })}
        </pre>
      </div>
    </div>
  )
}

export { tokenizeLine, TOKEN_COLORS, analyzeObfuscation, isBlockEnd, isLabelLine, parseBranchTarget, formatAddress, detectAsmSyntax }
export type { Token, TokenType, CodePaneProps, ObfuscationAnalysis }
