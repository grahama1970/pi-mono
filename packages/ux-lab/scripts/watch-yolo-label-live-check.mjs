import fs from 'node:fs'
import { chromium } from 'playwright'

const BASE_URL = process.env.WATCH_URL || 'http://localhost:3002'
const ROW_INDEX = Number(process.env.WATCH_ROW_INDEX || 9)
const TARGET_TRACK_ID = process.env.WATCH_TEST_TRACK_ID || 'track_3'
const TARGET_CHARACTER = process.env.WATCH_TEST_CHARACTER || 'Willie'
const SURFACE_URL = `${BASE_URL}/watch#watch?clipRow=${ROW_INDEX}`
const OUT_JSON = process.env.WATCH_YOLO_LABEL_OUT || '/tmp/watch-row9-yolo-label-live-check-current.json'
const OUT_SCREENSHOT = process.env.WATCH_YOLO_LABEL_SCREENSHOT || '/tmp/watch-row9-yolo-label-live-check-current.png'

function assert(condition, message, details = undefined) {
  if (!condition) {
    const error = new Error(message)
    error.details = details
    throw error
  }
}

async function jsonFetch(path, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  })
  const text = await response.text()
  const payload = text ? JSON.parse(text) : {}
  if (!response.ok || payload.ok === false) {
    throw new Error(`${path} failed: ${response.status} ${text}`)
  }
  return payload
}

async function rowAnnotations() {
  const payload = await jsonFetch(`/api/projects/watch/annotations/rows/${ROW_INDEX}`)
  return payload.annotations || []
}

async function detectorCandidates() {
  const payload = await jsonFetch(`/api/projects/watch/detector-candidates/rows/${ROW_INDEX}?source_width=1280&source_height=696`)
  return payload.candidates || []
}

function detectorRefsForTrack(annotations, trackId) {
  return annotations.filter((item) => (
    item?.detector_observation_ref?.track_id === trackId
    || item?.detector_track_id === trackId
  ))
}

async function waitForIsland(page) {
  await page.waitForSelector('[data-qid="watch:annotation-island"]', { timeout: 20_000 })
  await page.waitForFunction(() => {
    const status = document.querySelector('[data-qid="watch:annotation-island:status"]')?.textContent || ''
    return /loaded|saved|labeled|cleared|suggest|candidates/i.test(status)
  }, { timeout: 20_000 })
  await page.waitForTimeout(800)
}

async function reloadIsland(page) {
  await page.goto('about:blank')
  await page.goto(SURFACE_URL, { waitUntil: 'domcontentloaded' })
  await waitForIsland(page)
}

async function setTimeline(page, seconds) {
  await page.locator('[data-qid="watch:annotation-island:timeline"]').evaluate((input, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter.call(input, String(value))
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }, seconds)
  await page.waitForTimeout(500)
}

async function snapshotState(page) {
  return page.evaluate((trackId) => {
    const text = (selector) => document.querySelector(selector)?.textContent?.trim() || ''
    const labels = [...document.querySelectorAll('[data-qid="watch:annotation-island:detector-candidate-label"]')]
      .map((el) => {
        const rect = el.getBoundingClientRect()
        const style = getComputedStyle(el)
        const box = el.closest('[data-qid="watch:annotation-island:detector-candidate"]')
        const boxStyle = box ? getComputedStyle(box) : null
        const boxRect = box?.getBoundingClientRect()
        return {
          trackId: el.getAttribute('data-track-id'),
          text: el.textContent?.trim() || '',
          zIndex: Number(style.zIndex || 0),
          boxZIndex: Number(boxStyle?.zIndex || 0),
          top: rect.top,
          bottom: rect.bottom,
          left: rect.left,
          right: rect.right,
          boxBottom: boxRect?.bottom ?? null,
        }
      })
    const label = labels.find((candidate) => candidate.trackId === trackId) || null
    const candidateButtons = [...document.querySelectorAll('[data-qid="watch:annotation-island:detector-candidate"]')]
      .map((el) => ({
        trackId: el.getAttribute('data-track-id'),
        assigned: el.getAttribute('data-assigned-character'),
        text: el.textContent?.trim() || '',
      }))
    const inlineSelect = document.querySelector('[data-qid="watch:annotation-island:inline-detector-label-select"]')
    const characterSelect = document.querySelector('[data-qid="watch:annotation-island:character-select"]')
    const drawSurface = document.querySelector('[data-qid="watch:annotation-island:draw-surface"]')
    const drawSurfaceStyle = drawSurface ? getComputedStyle(drawSurface) : null
    const readinessRows = [...document.querySelectorAll('[data-qid="watch:annotation-island:identity-readiness-row"]')]
      .map((el) => el.textContent?.replace(/\s+/g, ' ').trim() || '')
    const yoloPanelRows = [...document.querySelectorAll('[data-qid="watch:annotation-island:yolo-person-box-row"]')]
      .map((el) => el.textContent?.replace(/\s+/g, ' ').trim() || '')
    return {
      selectedCharacter: characterSelect?.value || null,
      selectedExactText: text('[data-qid="watch:annotation-island:selected-exact"]'),
      status: text('[data-qid="watch:annotation-island:status"]'),
      detectorStatus: text('[data-qid="watch:annotation-island:detector-status"]'),
      label,
      labels,
      candidateButtons,
      inlineSelectOpen: Boolean(inlineSelect),
      inlineOptions: [...(inlineSelect?.querySelectorAll('option') || [])].map((option) => ({
        value: option.value,
        text: option.textContent?.trim() || '',
      })),
      inlineResetVisible: Boolean(document.querySelector('[data-qid="watch:annotation-island:inline-detector-label-reset"]')),
      selectedPanelVisible: Boolean(document.querySelector('[data-qid="watch:annotation-island:new-target-panel"]')),
      saveTargetVisible: Boolean(document.querySelector('[data-qid="watch:annotation-island:save-new-target"]')),
      resetTargetVisible: Boolean(document.querySelector('[data-qid="watch:annotation-island:clear-detector-label"]')),
      manualToggleVisible: Boolean(document.querySelector('[data-qid="watch:annotation-island:manual-annotation-toggle"]')),
      manualTogglePressed: document.querySelector('[data-qid="watch:annotation-island:manual-annotation-toggle"]')?.getAttribute('aria-pressed') || null,
      drawSurfacePointerEvents: drawSurfaceStyle?.pointerEvents || null,
      pendingTargetVisible: Boolean(document.querySelector('[data-qid="watch:annotation-island:overlay"][data-overlay-kind="pending"]')),
      readinessRows,
      yoloPanelRows,
    }
  }, TARGET_TRACK_ID)
}

async function clickTrackLabel(page, trackId) {
  const label = page.locator(`[data-qid="watch:annotation-island:detector-candidate-label"][data-track-id="${trackId}"]`).first()
  await label.waitFor({ state: 'visible', timeout: 20_000 })
  await label.click()
  await page.waitForSelector('[data-qid="watch:annotation-island:inline-detector-label-select"]', { timeout: 10_000 })
  await page.waitForTimeout(100)
}

async function selectInlineLabel(page, value) {
  await page.selectOption('[data-qid="watch:annotation-island:inline-detector-label-select"]', value)
  await page.waitForTimeout(500)
}

async function waitForTrackAssigned(page, trackId, characterName) {
  await page.waitForFunction(({ trackId: targetTrackId, characterName: targetCharacterName }) => {
    const label = [...document.querySelectorAll('[data-qid="watch:annotation-island:detector-candidate-label"]')]
      .find((el) => el.getAttribute('data-track-id') === targetTrackId)
    return label?.textContent?.toLowerCase().includes(targetCharacterName.toLowerCase())
  }, { trackId, characterName }, { timeout: 45_000 })
  await page.waitForTimeout(1000)
}

async function waitForTrackReset(page, trackId) {
  await page.waitForFunction((targetTrackId) => {
    const label = [...document.querySelectorAll('[data-qid="watch:annotation-island:detector-candidate-label"]')]
      .find((el) => el.getAttribute('data-track-id') === targetTrackId)
    const text = label?.textContent?.toLowerCase() || ''
    return text.includes(`yolo ${targetTrackId}`.toLowerCase()) || text.includes(`yolo ${targetTrackId.replace('_', ' ')}`.toLowerCase())
  }, trackId, { timeout: 45_000 })
  await page.waitForTimeout(1000)
}

async function ensureNoVisibleAssignment(trackId, characterName) {
  const annotations = await rowAnnotations()
  const refs = detectorRefsForTrack(annotations, trackId)
  const visible = refs.filter((item) => (
    item.status !== 'human_rejected_yolo_label'
    && item.lifecycle_status !== 'deleted'
    && String(item.character_name || '').toLowerCase() === characterName.toLowerCase()
  ))
  assert(visible.length === 0, `${trackId} already has a visible ${characterName} assignment; refusing destructive proof`, visible)
  return refs
}

async function run() {
  const evidence = {
    schema: 'watch.yolo_label_live_check.v1',
    mocked: false,
    live: true,
    url: SURFACE_URL,
    rowIndex: ROW_INDEX,
    targetTrackId: TARGET_TRACK_ID,
    targetCharacter: TARGET_CHARACTER,
    outJson: OUT_JSON,
    outScreenshot: OUT_SCREENSHOT,
    checks: [],
  }

  evidence.initialDetectorCandidateCount = (await detectorCandidates()).length
  evidence.initialTrackRefs = await ensureNoVisibleAssignment(TARGET_TRACK_ID, TARGET_CHARACTER)

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 2048, height: 1400 }, acceptDownloads: true })
  const page = await context.newPage()
  page.on('console', (message) => {
    if (message.type() === 'error') {
      evidence.consoleErrors ||= []
      evidence.consoleErrors.push(message.text())
    }
  })
  page.on('pageerror', (error) => {
    evidence.pageErrors ||= []
    evidence.pageErrors.push(String(error.stack || error.message || error))
  })

  try {
    await reloadIsland(page)
    await setTimeline(page, 0)
    const initial = await snapshotState(page)
    assert(initial.manualToggleVisible, 'manual annotation pencil toggle must be visible', initial)
    assert(initial.manualTogglePressed === 'false', 'manual annotation mode must start disabled', initial)
    assert(initial.drawSurfacePointerEvents === 'none', 'manual drawing surface must not accept clicks while pencil is disabled', initial)
    assert(initial.detectorStatus.includes('YOLO') || initial.status.includes('YOLO'), 'YOLO detector status must render', initial)
    assert(initial.label, `${TARGET_TRACK_ID} label must be visible`, initial)
    assert(initial.label.zIndex > initial.label.boxZIndex, 'YOLO label must stack above its box', initial.label)
    evidence.checks.push({ name: 'initial_yolo_ui_state', pass: true, state: initial })

    await clickTrackLabel(page, TARGET_TRACK_ID)
    const menuOpen = await snapshotState(page)
    assert(menuOpen.inlineSelectOpen, 'clicking YOLO label must open inline character select', menuOpen)
    assert(menuOpen.inlineOptions.some((option) => option.value === TARGET_CHARACTER), `inline character select must include ${TARGET_CHARACTER}`, menuOpen)
    assert(
      menuOpen.inlineOptions.some((option) => (
        option.value === 'Unassigned'
        && option.text.toLowerCase().includes(`yolo ${TARGET_TRACK_ID}`.toLowerCase())
      )),
      'inline character select must include reset-to-YOLO option',
      menuOpen,
    )
    assert(menuOpen.inlineResetVisible, 'inline reset button must be visible when label menu is open', menuOpen)
    evidence.checks.push({ name: 'label_click_opens_inline_character_chooser', pass: true, state: menuOpen })

    await selectInlineLabel(page, TARGET_CHARACTER)
    await waitForTrackAssigned(page, TARGET_TRACK_ID, TARGET_CHARACTER)
    const afterAssign = await snapshotState(page)
    const assignedRefs = detectorRefsForTrack(await rowAnnotations(), TARGET_TRACK_ID).filter((item) => (
      item.status !== 'human_rejected_yolo_label'
      && item.lifecycle_status !== 'deleted'
      && String(item.character_name || '').toLowerCase() === TARGET_CHARACTER.toLowerCase()
    ))
    assert(assignedRefs.length >= 1, `${TARGET_TRACK_ID} ${TARGET_CHARACTER} label must persist in row annotations after save`, assignedRefs)
    assert(afterAssign.label?.text.toLowerCase().includes(TARGET_CHARACTER.toLowerCase()), 'saved label must update visible YOLO label text', afterAssign)
    evidence.checks.push({ name: 'inline_label_save_persists_and_updates_label', pass: true, state: afterAssign, persistedCount: assignedRefs.length })

    await reloadIsland(page)
    await setTimeline(page, 0)
    const afterReloadAssigned = await snapshotState(page)
    assert(afterReloadAssigned.label?.text.toLowerCase().includes(TARGET_CHARACTER.toLowerCase()), 'saved YOLO label must survive browser reload', afterReloadAssigned)
    evidence.checks.push({ name: 'saved_label_survives_reload', pass: true, state: afterReloadAssigned })

    await clickTrackLabel(page, TARGET_TRACK_ID)
    const beforeReset = await snapshotState(page)
    assert(beforeReset.inlineSelectOpen, 'assigned YOLO label must reopen inline character select before reset', beforeReset)
    assert(
      beforeReset.inlineOptions.some((option) => (
        option.value === 'Unassigned'
        && option.text.toLowerCase().includes(`yolo ${TARGET_TRACK_ID}`.toLowerCase())
      )),
      'assigned inline character select must include reset-to-YOLO option',
      beforeReset,
    )
    await selectInlineLabel(page, 'Unassigned')
    await waitForTrackReset(page, TARGET_TRACK_ID)
    const afterReset = await snapshotState(page)
    const refsAfterReset = detectorRefsForTrack(await rowAnnotations(), TARGET_TRACK_ID)
    const visibleAfterReset = refsAfterReset.filter((item) => (
      item.status !== 'human_rejected_yolo_label'
      && item.lifecycle_status !== 'deleted'
      && String(item.character_name || '').toLowerCase() === TARGET_CHARACTER.toLowerCase()
    ))
    const rejectionAfterReset = refsAfterReset.filter((item) => (
      item.status === 'human_rejected_yolo_label'
      && String(item.character_name || '').toLowerCase() === TARGET_CHARACTER.toLowerCase()
    ))
    assert(visibleAfterReset.length === 0, 'reset must remove visible persisted character assignment for target track', visibleAfterReset)
    assert(rejectionAfterReset.length >= 1, 'reset/reject must persist a rejection ledger record', refsAfterReset)
    assert(afterReset.label?.text.toLowerCase().includes(`yolo ${TARGET_TRACK_ID}`.toLowerCase()) || afterReset.label?.text.toLowerCase().includes(`yolo ${TARGET_TRACK_ID.replace('_', ' ')}`.toLowerCase()), 'visible label must reset to YOLO track_N', afterReset)
    evidence.checks.push({ name: 'reset_reject_restores_yolo_track_label_and_persists_rejection', pass: true, state: afterReset, rejectionCount: rejectionAfterReset.length })

    await reloadIsland(page)
    await setTimeline(page, 0)
    const afterReloadReset = await snapshotState(page)
    assert(afterReloadReset.label?.text.toLowerCase().includes(`yolo ${TARGET_TRACK_ID}`.toLowerCase()) || afterReloadReset.label?.text.toLowerCase().includes(`yolo ${TARGET_TRACK_ID.replace('_', ' ')}`.toLowerCase()), 'reset state must survive browser reload', afterReloadReset)
    assert(afterReloadReset.drawSurfacePointerEvents === 'none', 'manual drawing must remain disabled after label/reset flow', afterReloadReset)
    evidence.checks.push({ name: 'reset_state_survives_reload_and_manual_draw_remains_disabled', pass: true, state: afterReloadReset })

    const candidate = (await detectorCandidates()).find((item) => item.track_id === TARGET_TRACK_ID && Math.abs(Number(item.time_seconds || 0)) < 0.06)
    if (candidate) {
      const suggestion = await jsonFetch('/api/projects/watch/detector-candidates/suggest-label', {
        method: 'POST',
        body: JSON.stringify({
          asset_uid: 'bad_santa_unrated_2003_brrip_xvidhd_720p_npw',
          row_index: ROW_INDEX,
          track_id: TARGET_TRACK_ID,
          bbox: candidate.bbox,
          time_seconds: candidate.time_seconds,
          allowed_characters: [
            { character_name: 'Marcus', actor_name: 'Tony Cox' },
            { character_name: 'Willie', actor_name: 'Billy Bob Thornton' },
          ],
        }),
      })
      evidence.memorySuggestion = suggestion
      assert(suggestion.memory_called === true || suggestion.suggestion || suggestion.rejection_reason, 'suggest-label endpoint must exercise Memory/Qdrant path or return a structured rejection', suggestion)
      evidence.checks.push({ name: 'memory_qdrant_suggestion_endpoint_exercised', pass: true, suggestion })
    }

    await page.screenshot({ path: OUT_SCREENSHOT, fullPage: true })
    evidence.screenshot = OUT_SCREENSHOT
  } finally {
    await browser.close()
  }

  evidence.finalTrackRefs = await detectorRefsForTrack(await rowAnnotations(), TARGET_TRACK_ID)
  evidence.pass = evidence.checks.every((check) => check.pass)
  fs.writeFileSync(OUT_JSON, `${JSON.stringify(evidence, null, 2)}\n`)
  console.log(JSON.stringify({
    pass: evidence.pass,
    checks: evidence.checks.map((check) => check.name),
    outJson: OUT_JSON,
    outScreenshot: OUT_SCREENSHOT,
  }, null, 2))
}

run().catch((error) => {
  const payload = {
    schema: 'watch.yolo_label_live_check.v1',
    mocked: false,
    live: true,
    pass: false,
    error: error instanceof Error ? error.message : String(error),
    details: error?.details,
    outJson: OUT_JSON,
    outScreenshot: OUT_SCREENSHOT,
  }
  fs.writeFileSync(OUT_JSON, `${JSON.stringify(payload, null, 2)}\n`)
  console.error(JSON.stringify(payload, null, 2))
  process.exit(1)
})
