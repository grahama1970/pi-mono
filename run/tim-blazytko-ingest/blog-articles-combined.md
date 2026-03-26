# Tim Blazytko - Blog Articles from synthesis.to

## 1. Building a Pipeline for Agentic Malware Analysis (2026-03-18)
Core argument: Distinguishes between LLM-assisted RE and agentic workflows. An agent is "an LLM that can use tools in a loop to achieve a goal." Structured pipeline with six phases: triage fingerprinting, signal filtering, hypothesis building, structural mapping, deep-analysis planning, targeted validation. Three coordinated roles: orchestrator, planner, reporter. Uses Docker, MCP-connected disassemblers (Binary Ninja or Ghidra). Results: recovered command-dispatch vtables with 10 remotely callable functions, protocol implementation details, and cryptographic routine locations that simple triage missed.

## 2. Identification of API Functions in Binaries (2023-08-02)
Call frequency analysis: functions called by many independent callers are likely API functions. Top 10% by caller count. Validated on Coreutils ls (printf, strlen, strcmp), XOR DDos malware (free, malloc, memcpy), embedded firmware (crypto libs), PlugX malware (API hashing routines). "Simplistic and easy to implement, but also extremely efficient."

## 3. Statistical Analysis to Detect Uncommon Code (2023-01-26)
N-gram analysis (3-grams) on assembly opcodes, abstracting away registers/addresses. Build ground truth from normal code (System32, compilers, blender). Score functions by ratio of uncommon 3-grams. Uses Binary Ninja LLIL for architecture-agnostic support. Detects: obfuscated state-management, Warbird VM handlers, crypto operations, virtualization-based obfuscation, floating-point/hardware encryption.

## 4. Practical MBA Deobfuscation with msynth (2021-11-11)
Mixed Boolean-Arithmetic obfuscation: encodes simple operations in complex arithmetic expressions. msynth: pre-computed database mapping input-output behaviors to minimal expressions + recursive simplification algorithm. Successfully simplified FinSpy MBA expressions to constants. Useful beyond deobfuscation - simplifies aggressive compiler optimizations.

## 5. Writing Disassemblers for VM-based Obfuscators (2021-10-21)
Virtual machines create custom ISA in software: dispatcher routes through handlers. Methodology: build symbolic executor following VM execution flow, add callbacks at handlers to extract semantic information. Demonstrated on Tigress-protected Fibonacci. Pattern recognition recovers high-level semantics from VM instruction traces.

## 6. Automated Detection of Obfuscated Code (2021-08-10)
Three heuristics: cyclomatic complexity (edges - blocks + 2), large basic blocks (avg instructions per block), instruction overlapping (multiple instructions at same bytes). Tested on Emotet, VMProtect-protected Adylkuzz, Windows kernel. Functions in top 10% by complexity warrant investigation.

## 7. Automation in Reverse Engineering: String Decryption (2021-06-30)
Automate repetitive tasks via disassembler APIs. Example: Mirai botnet XOR string decryption (bytewise XOR with 0x22). ~20 lines of Binary Ninja HLIL API code to decrypt all strings. Reveals hardcoded credentials. Key message: learn your tool's API.

## 8. Introduction to Control-flow Graph Analysis (2021-03-15)
Dominance relations, loop detection, dominator trees using Miasm's DiGraph. Foundation for deobfuscation training. Essential for detecting control-flow flattening.

## 9. Automated Detection of Control-flow Flattening (2021-03-03)
Detect flattened functions via dominance analysis: blocks with back edges to dominators that dominate >=90% of function blocks. FinSpy (OLLVM): 17.54% flagged. Emotet: 41.30% flagged. PlugX (unobfuscated): 5.16% (legitimate state machines). False positive rate in normal programs: 2-5%.
