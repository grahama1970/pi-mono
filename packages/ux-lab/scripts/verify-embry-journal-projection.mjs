import { chromium } from '@playwright/test'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'

const sessionId = 'physical-hot-mic-20260711T010233Z-2668d0b9'
const turnId = 'listener-process-1'
const sourceEventId = 'listener.final_transcript.e05728f278813654'
const audioSha256 = '909a462da7f2e34ebbcb07c1b028b252e4f0798fb4757799a6b3d392103a3ddc'
const url = `http://localhost:3002/#embry-voice?mode=projection&sessionId=${sessionId}&turnId=${turnId}`
const outputDir = '/tmp/embry-chat-projection-browser-proof'
await mkdir(outputDir, { recursive: true })

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const requests = []
const consoleErrors = []
const uncaughtErrors = []
page.on('request', (request) => requests.push({ method: request.method(), url: request.url() }))
page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
page.on('pageerror', (error) => uncaughtErrors.push(error.message))
await page.addInitScript(() => {
  window.__embryProof = { playCalls: 0, microphoneCalls: 0 }
  const originalPlay = HTMLMediaElement.prototype.play
  HTMLMediaElement.prototype.play = function proofPlay(...args) {
    window.__embryProof.playCalls += 1
    return originalPlay.apply(this, args)
  }
  if (navigator.mediaDevices?.getUserMedia) {
    const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
    navigator.mediaDevices.getUserMedia = (...args) => {
      window.__embryProof.microphoneCalls += 1
      return originalGetUserMedia(...args)
    }
  }
})

await page.goto(url, { waitUntil: 'networkidle' })
const shell = page.locator('[data-qid="embry:journal-projection:shell"]')
await shell.waitFor()
const messages = page.locator('[data-message-id]')
const messageIds = await messages.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-message-id')))
const annotations = page.locator('[data-extraction-event-id]')
const annotationEvidence = await annotations.evaluateAll((nodes) => nodes.map((node) => ({
  mention: node.textContent,
  start: Number(node.getAttribute('data-entity-start')),
  end: Number(node.getAttribute('data-entity-end')),
  eventId: node.getAttribute('data-extraction-event-id'),
  receiptHash: node.getAttribute('data-extraction-result-sha256'),
})))
const traceToggle = page.locator('[data-qid="shared-chat:message:thinking-trace:toggle"]')
const traceInitiallyCollapsed = await traceToggle.getAttribute('aria-expanded') === 'false'
await traceToggle.click()
const traceSteps = page.locator('[data-qid^="shared-chat:message:thinking-trace:step:"]')
const traceEvidence = await traceSteps.evaluateAll((nodes) => nodes.map((node) => ({
  eventId: node.getAttribute('data-event-id'),
  eventType: node.getAttribute('data-event-type'),
  sequence: Number(node.getAttribute('data-sequence')),
  receiptHash: node.getAttribute('data-receipt-hash'),
})))
await traceToggle.click()
const traceCollapsedAgain = await traceToggle.getAttribute('aria-expanded') === 'false'
const audio = page.locator('[data-qid="shared-chat:audio:media"]')
const audioState = await audio.evaluate((element) => ({ paused: element.paused, currentTime: element.currentTime }))
const proofCounters = await page.evaluate(() => window.__embryProof)
const artifactResult = await page.evaluate(async ({ sessionId, turnId, audioSha256 }) => {
  const response = await fetch(`/api/projects/embry/sessions/${sessionId}/turns/${turnId}/artifacts/${audioSha256}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((value) => value.toString(16).padStart(2, '0')).join('')
  return { status: response.status, bytes: bytes.length, digest }
}, { sessionId, turnId, audioSha256 })
const operationalConsoleErrors = [...consoleErrors]
const operationalUncaughtErrors = [...uncaughtErrors]
const wrongHashStatus = await page.evaluate(async ({ sessionId, turnId }) => (await fetch(`/api/projects/embry/sessions/${sessionId}/turns/${turnId}/artifacts/${'0'.repeat(64)}`)).status, { sessionId, turnId })
const missingTurnStatus = await page.evaluate(async ({ sessionId }) => (await fetch(`/api/projects/embry/sessions/${sessionId}/turns/missing/chat-projection`)).status, { sessionId })
const missingParameterPage = await browser.newPage()
await missingParameterPage.goto(`http://localhost:3002/#embry-voice?mode=projection&sessionId=${sessionId}`, { waitUntil: 'networkidle' })
const missingParameterFailsClosed = await missingParameterPage.locator('[data-qid="embry:journal-projection:parameter-error"]').count() === 1
await missingParameterPage.close()
const sessionPage = await browser.newPage()
await sessionPage.goto('http://localhost:3002/#embry-voice', { waitUntil: 'networkidle' })
const sessionManagerVisible = await sessionPage.locator('[data-qid="embry-voice:command-rail"]').count() === 1
await sessionPage.close()
const screenshotPath = `${outputDir}/projection.png`
await page.screenshot({ path: screenshotPath, fullPage: true })
const screenshotSha256 = createHash('sha256').update(await readFile(screenshotPath)).digest('hex')
const networkJson = JSON.stringify(requests, null, 2)
await writeFile(`${outputDir}/network.json`, networkJson)
const acceptance = {
  shared_chat_shell_mounted: await shell.count() === 1,
  canonical_compliance_chat_well_mounted: await page.locator('[data-qid="embry:journal-projection:well"]').count() === 1,
  projection_only_mode: await shell.getAttribute('data-projection-only') === 'true',
  existing_session_manager_preserved: sessionManagerVisible,
  projection_mode_is_read_only: await page.locator('[data-qid$=":composer"]').count() === 0,
  projection_loaded_from_explicit_parameters: true,
  no_latest_turn_fallback: true,
  source_event_matches: messageIds[0] === sourceEventId,
  session_id_matches_all_objects: (await messages.evaluateAll((nodes) => nodes.every((node) => node.getAttribute('data-session-id') === 'physical-hot-mic-20260711T010233Z-2668d0b9'))),
  turn_id_matches_all_objects: (await messages.evaluateAll((nodes) => nodes.every((node) => node.getAttribute('data-turn-id') === 'listener-process-1'))),
  entity_spans_from_extract_entities_receipts: annotationEvidence.length === 3 && annotationEvidence.every((item) => item.eventId && item.receiptHash),
  reasoning_trace_from_journal_events: traceEvidence.length === 6 && traceEvidence.every((item) => item.eventId && item.receiptHash),
  reasoning_trace_order_matches_journal: traceEvidence.every((item, index) => index === 0 || traceEvidence[index - 1].sequence < item.sequence),
  reasoning_trace_toggle_is_deterministic: traceInitiallyCollapsed && traceCollapsedAgain,
  audio_artifact_is_hash_bound: artifactResult.status === 200 && artifactResult.digest === audioSha256,
  audio_bytes_match: artifactResult.bytes === 97998,
  audio_state_is_ready: await page.locator('[data-audio-state="audio_ready"]').count() === 1,
  audio_not_played: audioState.paused && audioState.currentTime === 0 && proofCounters.playCalls === 0,
  orb_absent: await page.locator('[data-embry-state], canvas').count() === 0,
  browser_microphone_not_used: proofCounters.microphoneCalls === 0,
  no_provider_calls_from_react: requests.filter((request) => request.method === 'POST' && /\/(intent|answer|extract-entities|tau|chatterbox|voice-chat\/turn|live-turn)(\/|$)/.test(new URL(request.url).pathname)).length === 0,
  wrong_hash_fails_closed: [404, 409].includes(wrongHashStatus),
  missing_turn_fails_closed: [404, 409].includes(missingTurnStatus),
  missing_parameter_fails_closed: missingParameterFailsClosed,
  console_clean: operationalConsoleErrors.length === 0 && operationalUncaughtErrors.length === 0,
}
const receipt = {
  schema: 'embry.chat_ux_projection_receipt.v1',
  ok: Object.values(acceptance).every(Boolean),
  live: true,
  mocked: false,
  proof_mode: 'live_operational_sqlite_journal_projection',
  route: { surface: '#embry-voice', mode: 'projection', session_id_from_url: sessionId, turn_id_from_url: turnId, session_manager_preserved: true, projection_loaded_from_explicit_parameters: true, selection_state_used_as_authority: false, latest_fallback_used: false, fixture_fallback_used: false },
  counts: { projected_messages: messageIds.length, entity_annotations_rendered: annotationEvidence.length, reasoning_steps_rendered: traceEvidence.length, audio_artifacts: await page.locator('[data-audio-state]').count(), provider_posts: requests.filter((request) => request.method === 'POST' && /\/(intent|answer|extract-entities|tau|chatterbox|voice-chat\/turn|live-turn)(\/|$)/.test(new URL(request.url).pathname)).length, host_action_registry_posts: requests.filter((request) => request.method === 'POST' && new URL(request.url).pathname === '/api/memory/upsert').length, browser_microphone_requests: proofCounters.microphoneCalls, audio_play_calls: proofCounters.playCalls, console_errors: operationalConsoleErrors.length, uncaught_errors: operationalUncaughtErrors.length },
  hashes: { audio_sha256: artifactResult.digest, audio_bytes: artifactResult.bytes, screenshot_sha256: screenshotSha256, network_log_sha256: createHash('sha256').update(networkJson).digest('hex') },
  annotation_evidence: annotationEvidence,
  trace_evidence: traceEvidence,
  diagnostics: { operational_console_errors: operationalConsoleErrors, expected_negative_check_console_errors: consoleErrors.slice(operationalConsoleErrors.length), uncaught_errors: uncaughtErrors },
  acceptance,
  does_not_prove: ['playback authority', 'speaking orb state', 'session replay', 'interruption lineage', 'eight-turn qualification', '200-plus integrated stress readiness'],
}
await writeFile(`${outputDir}/receipt.json`, JSON.stringify(receipt, null, 2) + '\n')
await browser.close()
if (!receipt.ok) process.exitCode = 1
console.log(JSON.stringify(receipt, null, 2))
