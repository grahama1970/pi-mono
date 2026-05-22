#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import process from 'node:process'

function arg(name, fallback = null) {
  const idx = process.argv.indexOf(name)
  if (idx === -1) return fallback
  return process.argv[idx + 1] ?? fallback
}

function hasArg(name) {
  return process.argv.includes(name)
}

function classifyAction(payload) {
  const verdict = payload?.verdict || {}
  const state = String(verdict.state ?? payload?.verdict_state ?? payload?.verdict ?? '').toLowerCase()
  const action = String(verdict.action ?? payload?.response_action ?? '').toLowerCase()
  const mode = String(payload?.diagnostics?.mode ?? '').toLowerCase()
  if (action === 'clarify' || mode === 'clarification_required') return 'clarify'
  if (state === 'satisfied' || state === 'pass' || state === 'passed') return 'answer'
  if (state === 'not_satisfied' || state === 'fail' || state === 'failed') return 'deflect'
  if (state === 'inconclusive' || state === 'needs_review') return 'clarify'
  return 'unknown'
}

function gates(payload) {
  return Array.isArray(payload?.gate_trace) ? payload.gate_trace
    : Array.isArray(payload?.gates) ? payload.gates
      : []
}

function evidenceItems(payload) {
  return Array.isArray(payload?.evidence) ? payload.evidence
    : Array.isArray(payload?.evidence_items) ? payload.evidence_items
      : []
}

function hasQraGate(payload) {
  return gates(payload).some((gate) => String(gate.gate ?? gate.name ?? '').toLowerCase().includes('qra') && gate.passed !== false)
}

function evidenceCaseId(payload) {
  return payload?.evidence_case_version?.id
    || payload?.evidence_case_version?.case_id
    || payload?.evidence_case?.case_id
    || payload?.evidence_case?.id
    || payload?.diagnostics?.run_id
    || null
}

function validateCase(testCase, payload) {
  const failures = []
  const action = classifyAction(payload)
  const acceptable = testCase.acceptable_actions || [testCase.expected_action].filter(Boolean)
  if (acceptable.length > 0 && !acceptable.includes(action)) {
    failures.push(`expected action in ${acceptable.join(',')} but got ${action}`)
  }
  if (action === 'answer' && testCase.require_evidence_case_for_answer !== false) {
    if (!payload || typeof payload !== 'object') failures.push('answer has no payload')
    if (gates(payload).length === 0) failures.push('answer has no gate trace')
  }
  const minEvidence = Number(testCase.min_evidence_items ?? 0)
  if (minEvidence > 0 && evidenceItems(payload).length < minEvidence) {
    failures.push(`expected at least ${minEvidence} evidence items but got ${evidenceItems(payload).length}`)
  }
  if (testCase.require_qra_gate && !hasQraGate(payload)) {
    failures.push('expected passed qra gate')
  }
  return {
    passed: failures.length === 0,
    failures,
    action,
    verdict_state: payload?.verdict?.state ?? null,
    diagnostics_mode: payload?.diagnostics?.mode ?? null,
    evidence_count: evidenceItems(payload).length,
    gate_count: gates(payload).length,
    qra_gate_passed: hasQraGate(payload),
    evidence_case_id: evidenceCaseId(payload),
  }
}

async function postJson(url, body, timeoutMs) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    const text = await response.text()
    let json = null
    try { json = text ? JSON.parse(text) : null } catch {}
    return { ok: response.ok, status: response.status, json, text: json ? undefined : text.slice(0, 2000) }
  } finally {
    clearTimeout(timeout)
  }
}

async function main() {
  const manifestPath = resolve(arg('--manifest', 'test-manifests/sparta-chat-core-e2e.json'))
  const outputJson = resolve(arg('--output-json', 'test-results/sparta-chat-core-e2e-summary.json'))
  const outputJsonl = resolve(arg('--output-jsonl', 'test-results/sparta-chat-core-e2e-results.jsonl'))
  const baseUrl = arg('--base-url', 'http://localhost:3001').replace(/\/$/, '')
  const limit = Number(arg('--limit', '0'))
  const failFast = hasArg('--fail-fast')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const endpoint = manifest.defaults?.endpoint || '/api/evidence-case/run'
  const timeoutMs = Number(arg('--timeout-ms', manifest.defaults?.timeout_ms || '120000'))
  const cases = limit > 0 ? manifest.cases.slice(0, limit) : manifest.cases
  const results = []

  for (const testCase of cases) {
    const started = new Date().toISOString()
    const request = {
      question: testCase.question,
      profile: testCase.profile,
      evidenceProfile: testCase.profile,
      controlId: testCase.control_id || null,
    }
    let result
    try {
      const response = await postJson(`${baseUrl}${endpoint}`, request, timeoutMs)
      const validation = response.ok
        ? validateCase({ ...manifest.defaults, ...testCase }, response.json)
        : { passed: false, failures: [`http ${response.status}`], action: 'error' }
      result = {
        id: testCase.id,
        profile: testCase.profile,
        strata: testCase.strata || [],
        question: testCase.question,
        started,
        completed: new Date().toISOString(),
        http_status: response.status,
        passed: validation.passed,
        validation,
        response_digest: response.json ? {
          verdict: response.json.verdict || null,
          diagnostics: response.json.diagnostics || null,
          gate_trace: gates(response.json),
          evidence_count: evidenceItems(response.json).length,
          evidence_case_id: evidenceCaseId(response.json),
          answer: typeof response.json.answer === 'string' ? response.json.answer.slice(0, 500) : null,
        } : { text: response.text || null },
      }
    } catch (error) {
      result = {
        id: testCase.id,
        profile: testCase.profile,
        strata: testCase.strata || [],
        question: testCase.question,
        started,
        completed: new Date().toISOString(),
        passed: false,
        validation: { passed: false, failures: [error instanceof Error ? error.message : String(error)], action: 'error' },
      }
    }
    results.push(result)
    process.stdout.write(`${result.passed ? 'PASS' : 'FAIL'} ${result.id} ${result.validation.action}${result.validation.failures?.length ? ` (${result.validation.failures.join('; ')})` : ''}\n`)
    if (!result.passed && failFast) break
  }

  const summary = {
    schema: 'sparta_chat_e2e.summary.v1',
    suite: manifest.suite,
    base_url: baseUrl,
    endpoint,
    generated_at: new Date().toISOString(),
    total: results.length,
    passed: results.filter((r) => r.passed).length,
    failed: results.filter((r) => !r.passed).length,
    by_action: results.reduce((acc, r) => {
      const action = r.validation.action || 'unknown'
      acc[action] = (acc[action] || 0) + 1
      return acc
    }, {}),
    failures: results.filter((r) => !r.passed).map((r) => ({ id: r.id, failures: r.validation.failures })),
    results,
  }

  await mkdir(dirname(outputJson), { recursive: true })
  await mkdir(dirname(outputJsonl), { recursive: true })
  await writeFile(outputJson, `${JSON.stringify(summary, null, 2)}\n`)
  await writeFile(outputJsonl, results.map((r) => JSON.stringify(r)).join('\n') + '\n')
  process.stdout.write(`summary ${outputJson}\njsonl ${outputJsonl}\n`)
  process.exit(summary.failed === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(2)
})
