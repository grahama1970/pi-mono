According to a document from 2026-06-05, SPARTA/Embry OS readiness displays must stay evidence-first, fail closed on stale or missing proof, and avoid showing status/counts/actions without lineage to authoritative artifacts. 

WEBGPT_SPARTA_CONTEXT

 

WEBGPT_SPARTA_CONTEXT

VERDICT

NEEDS_CHANGES before declaring Embry Voice / Chatterbox / Embry OS ready for SPARTA distance voice control.

The fresh current audible path looks green from the embedded facts:

fresh audible suite: ok=true, mocked=false, live=true, failed_gates=[]
Chatterbox pytest: 121 passed
Embry Voice /test-interactions: 3 PASS / 0 FAIL
receipt reference probe: 34 referenced paths, 0 missing

But the integration is not yet SPARTA-distance-ready because the current UI appears to flatten incompatible evidence types into one “4 failed gates” count. Those four failed JSON receipts should not automatically block the current readiness path, but they also should not be hidden. They must be reclassified into current readiness, historical regression ledger, and device/acoustic qualification matrix.

1. Source-derived numbered step model

Ingest receipt corpus without hiding failures.
The route should continue loading all referenced receipts. The current 0 missing reference probe is good; missing receipts would be a hard blocker.

Classify each receipt before computing readiness.
A receipt must have:

classification: current | historical_regression | device_qualification | acoustic_qualification | negative_evidence
current_profile_applies: true | false
superseded_by?: receipt_id
device_profile?: webcam | default | jabra | loopback | factory_source_68 | unknown

This follows the SPARTA rule that visible statuses/actions need source contracts and explicit missing/fallback states, not implied dashboard truth. 

PAGE_REVIEW_PROCESS

Compute current readiness only from active current-profile receipts.
The fresh 2026-07-07 audible suite should drive the current voice-readiness banner if it is the intended active suite:

current_failed_gates = 0
current_state = READY
evidence = fresh_audible_suite_summary

Do not include superseded or device-negative receipts in this number.

Render historical failures as retained evidence, not current failure.
continuous-voice-loop.json should remain visible as a historical ASR regression record, not counted as current readiness failure if it is superseded by the newer webcam browser-quality pass.

Render device/source failures as device qualification outcomes.
browser-asr-matrix.json should not make the whole system red unless the active deployment profile requires those devices. It should make those device rows red.

Render factory/noisy captures as plant-acoustic qualification, not generic current failure.
The two factory_noise_matrix_ok failures are especially important because SPARTA targets loud plant contexts. They should be amber or red in the plant-acoustic matrix until the human confirms whether those were intended negative tests or required acceptance gates.

Expose the state split in the UI.
The #embry-voice route should show:

Current Voice Readiness: READY / DEGRADED / BLOCKED / UNKNOWN
Historical Regression Ledger: 4 retained failures
Device Qualification Matrix: per-device pass/fail
Plant Acoustic Qualification: pass/fail/unknown

SPARTA distance controller consumes only current readiness + active device profile.
The 10ft/5ft SPARTA board should not react to old failed receipts. It should react to:

active voice readiness
active mic/device qualification
active ASR/TTS daemon health
qid action-router health
transcript availability

Mode transitions remain separate acceptance gates.
SPARTA’s distance model is progressive disclosure: 10ft ambient, 5ft voice triage, lean-in proof/drilldown; qids are runtime contracts for voice, Stream Deck, agents, accessibility, and deterministic tests. 

WEBGPT_SPARTA_CONTEXT

Do not call plant-floor voice ready until noisy/device qualification is scoped.
The current live suite supports lab/browser voice readiness. It does not by itself prove readiness for all factory acoustic/device conditions.

2. Classification of the 4 failed gates
Receipt	Failed gates	Classification	Current readiness impact	UI treatment
continuous-voice-loop.json	realtimestt_listener_ok, listener_transcript_present	Historical regression / superseded browser ASR run	Not a current blocker if the newer webcam browser-quality run is the active path and is explicitly linked as superseded_by.	Amber row in Historical Regression Ledger.
browser-asr-matrix.json	jabra_ns_agc:whisper_transcript, jabra_raw:whisper_transcript, default_ns_agc:browser_ok, default_ns_agc:whisper_transcript	Device/source qualification matrix	Not a global blocker unless Jabra/default NS/AGC is the required active device profile. Red for those device rows.	Amber panel summary, red device rows.
index.json	factory_noise_matrix_ok	Factory acoustic qualification failure	Potential blocker for plant-floor deployment, not necessarily blocker for browser/lab readiness. Needs human scope decision.	Amber/red in Plant Acoustic Qualification.
index.json	factory_noise_matrix_ok	Older factory acoustic negative/noisy capture failure	Not current blocker if superseded or deliberately negative; blocker if still the current required factory-noise acceptance receipt.	Amber historical acoustic row until classified.

Answer to question 1: the four failed gates are not blockers to current browser/lab voice readiness if the fresh live suite is the active authority. They are blockers to declaring full SPARTA plant-floor voice readiness until the factory-noise and active-device scope is resolved. They are also a UI blocker if the route continues to present them as one undifferentiated “4 failed gates” current-readiness count.

3. State model for #embry-voice

Use all three separated:

A. Current readiness

Purpose: “Can Embry voice control SPARTA right now on the active profile?”

Inputs:

fresh audible suite
active route health
active ASR listener health
active transcript present
active TTS/audio artifact path
current qid action-router health
current device profile

UI:

Current Voice Readiness
READY
0 current failed gates
29 voice turns
29 audio artifacts
Active suite: fresh 2026-07-07 audible suite
B. Historical regression ledger

Purpose: “What failed before, and is it retained as regression evidence?”

Inputs:

continuous-voice-loop.json
older index.json noisy/factory failures
any superseded receipt

UI:

Historical Regression Ledger
4 retained failed records
Not counted against current readiness
Open receipt
Superseded by <receipt>
C. Device/acoustic qualification matrix

Purpose: “Which microphones, browser sources, loopback paths, and factory-noise profiles are qualified?”

Inputs:

browser-asr-matrix.json
factory noise matrix receipts
loopback harness receipts
device metadata

UI:

Device Qualification
webcam browser-quality: PASS
Jabra NS/AGC: FAIL
default NS/AGC: FAIL
factory source 68: FAIL / NEEDS SCOPE
loopback: PASS

Do not use a single top-level 4 failed gates number without classification. That creates dashboard theater because it does not tell the operator whether the system is currently failing, whether a device is disqualified, or whether the failure is retained historical evidence. SPARTA’s page-review rules explicitly require deterministic checks plus semantic review; deterministic pass alone is insufficient, but a visual summary cannot override qid/action or evidence-contract failures. 

PAGE_REVIEW_PROCESS

4. What architecture diagram to create

Create a diagram titled:

Embry Voice Readiness: Current Path vs Historical/Device Evidence

It should show three horizontal lanes:

Current voice readiness path — green where proven.

Historical regression ledger — amber retained evidence.

Device/acoustic qualification matrix — per-device red/amber/green.

SPARTA distance-mode integration — amber/missing until idle/spoken/key automation is proven.

5. Architecture YAML proposal
YAML
architecture:
  id: embry_voice_failing_gates_sparta_distance
  title: "Embry Voice / Chatterbox / Embry OS Readiness Model for SPARTA Distance Control"
  subtitle: "Separate current readiness from historical regression and device/acoustic qualification"
  legend:
    green: "#16A34A verified current pass"
    amber: "#F59E0B warning / scoped / not full blocker"
    red: "#DC2626 blocker for the named scope"
    blue: "#2563EB UI or routing component"
    purple: "#7C3AED evidence/receipt store"
    slate: "#475569 infrastructure"
  components:
    - id: embry_voice_route
      label: "#embry-voice route"
      technology: "UX Lab React route on localhost:3002"
      color: "#2563EB"
      state: "amber"
      status_label: "VISIBLE / MODEL NEEDS SPLIT"
      evidence:
        - "Browser route visible: http://localhost:3002/#embry-voice"
        - "UI shows orb, metrics, Replay/Speak/Listen/Open console"
        - "Currently shows 21 passed gates, 1 pending, 4 failed gates"
      attach:
        - "/tmp/codex-ui-verification/pi-mono/embry-voice-integration-probe-r3/20260708T023256Z.png"
      notes:
        - "Route render is good."
        - "Failed gates must be separated by class before readiness claim."

    - id: current_readiness_panel
      label: "Current Voice Readiness Panel"
      technology: "React summary component"
      color: "#16A34A"
      state: "green"
      status_label: "READY IF ACTIVE SUITE = FRESH AUDIBLE"
      evidence:
        - "fresh_audible_suite_summary.ok=true"
        - "mocked=false"
        - "live=true"
        - "failed_gates=[]"
        - "scenario_count=8"
      attach:
        - "fresh 2026-07-07 audible suite receipt"
      notes:
        - "Should display 0 current failed gates."
        - "Should not include historical/device failures."

    - id: fresh_audible_suite
      label: "Fresh Audible Suite"
      technology: "Chatterbox/Embry voice live audible test suite"
      color: "#16A34A"
      state: "green"
      status_label: "LIVE PASS"
      evidence:
        - "passed: S01_S02_S08_S09_S12"
        - "passed: S08"
        - "passed: S10"
        - "passed: S03-unknown-speaker"
        - "passed: S04-ambiguous-speaker"
        - "passed: S05"
        - "passed: S06"
        - "passed: S13"
      attach:
        - "fresh audible suite summary JSON"

    - id: receipt_reference_probe
      label: "Receipt Reference Probe"
      technology: "Local receipt reference scanner"
      color: "#F59E0B"
      state: "amber"
      status_label: "0 MISSING / 4 FAILED JSON"
      evidence:
        - "referenced_paths=34"
        - "missing_count_after_patch=0"
        - "ok_json_count=14"
        - "failed_json_count=4"
      attach:
        - "route_reference_probe result"
      notes:
        - "Green for no missing references."
        - "Amber because failed receipts need classification."

    - id: historical_regression_ledger
      label: "Historical Regression Ledger"
      technology: "Receipt classifier + React ledger"
      color: "#F59E0B"
      state: "amber"
      status_label: "RETAINED FAILED EVIDENCE"
      evidence:
        - "continuous-voice-loop.json old browser ASR EC/NS/AGC run failed"
        - "older factory acoustic negative/noisy capture path failed"
      attach:
        - "continuous-voice-loop.json"
        - "index.json older factory acoustic receipt"
      notes:
        - "Must remain visible."
        - "Must not count as current failure if superseded."

    - id: failed_receipt_continuous_voice_loop
      label: "continuous-voice-loop.json"
      technology: "Historical browser ASR receipt"
      color: "#F59E0B"
      state: "amber"
      status_label: "SUPERSEDED HISTORICAL FAILURE"
      failed_gates:
        - "realtimestt_listener_ok"
        - "listener_transcript_present"
      classification: "historical_regression"
      current_readiness_impact: "none_if_superseded"
      attach:
        - "continuous-voice-loop.json"

    - id: device_qualification_matrix
      label: "Device Qualification Matrix"
      technology: "Receipt classifier + device matrix UI"
      color: "#F59E0B"
      state: "amber"
      status_label: "PER-DEVICE STATUS REQUIRED"
      evidence:
        - "browser-asr-matrix.json documents bad browser audio devices"
      attach:
        - "browser-asr-matrix.json"
      notes:
        - "Overall amber until active device allowlist is declared."
        - "Specific failed device rows are red."

    - id: failed_receipt_browser_asr_matrix
      label: "browser-asr-matrix.json"
      technology: "Browser ASR device/source matrix"
      color: "#DC2626"
      state: "red_scoped"
      status_label: "FAILED FOR NAMED DEVICES"
      failed_gates:
        - "jabra_ns_agc:whisper_transcript"
        - "jabra_raw:whisper_transcript"
        - "default_ns_agc:browser_ok"
        - "default_ns_agc:whisper_transcript"
      classification: "device_qualification"
      current_readiness_impact: "blocks_only_if_active_device_profile_requires_these_sources"
      attach:
        - "browser-asr-matrix.json"

    - id: factory_acoustic_qualification
      label: "Factory Acoustic Qualification"
      technology: "Factory/noisy capture matrix"
      color: "#F59E0B"
      state: "amber"
      status_label: "NEEDS HUMAN SCOPE"
      evidence:
        - "factory_noise_matrix_ok failed in two index.json records"
      attach:
        - "index.json factory source 68"
        - "index.json older factory acoustic negative/noisy capture"
      notes:
        - "Potential red blocker for plant-floor voice deployment."
        - "Not necessarily blocker for lab/browser route."

    - id: failed_receipt_factory_source_68
      label: "factory source 68 noisy capture"
      technology: "Factory acoustic negative/noisy capture receipt"
      color: "#DC2626"
      state: "red_scoped"
      status_label: "FAILED FACTORY NOISE MATRIX"
      failed_gates:
        - "factory_noise_matrix_ok"
      classification: "acoustic_qualification"
      current_readiness_impact: "blocks_if_factory_noise_is_required_for_current_demo"
      attach:
        - "index.json"

    - id: failed_receipt_older_factory_acoustic
      label: "older factory acoustic noisy capture"
      technology: "Historical factory acoustic receipt"
      color: "#F59E0B"
      state: "amber"
      status_label: "OLDER FAILED ACOUSTIC RECORD"
      failed_gates:
        - "factory_noise_matrix_ok"
      classification: "historical_regression_or_acoustic_qualification"
      current_readiness_impact: "needs_scope"
      attach:
        - "index.json"

    - id: chatterbox_core_tests
      label: "Chatterbox Core Tests"
      technology: "Python pytest"
      color: "#16A34A"
      state: "green"
      status_label: "121 PASSED"
      evidence:
        - "PYTHONPATH=src python -m pytest -q tests -> 121 passed, 3 warnings"
      attach:
        - "chatterbox test output"
      notes:
        - "Good core signal."
        - "Does not prove SPARTA browser distance transitions."

    - id: chatterbox_loopback_harness
      label: "Chatterbox Rung 8 Loopback Harness"
      technology: "Loopback capture harness"
      color: "#16A34A"
      state: "green"
      status_label: "CRASH REPAIRED"
      evidence:
        - "Default optional pulse_source/capture_backend args"
        - "Fail-closed test no longer crashes"
      attach:
        - "chatterbox main commit 6c9ad39"

    - id: embry_os_voice_daemon_tests
      label: "Embry OS Voice Daemon Tests"
      technology: "services/tests/test_voice_daemon.py"
      color: "#F59E0B"
      state: "amber"
      status_label: "16 PASSED / MOSTLY MOCKED"
      evidence:
        - ".venv/bin/python -m pytest -q services/tests/test_voice_daemon.py -> 16 passed"
      attach:
        - "voice daemon pytest output"
      notes:
        - "Not red."
        - "Needs live service integration tests before plant readiness."

    - id: ux_test_interactions
      label: "Embry Voice Test Interactions"
      technology: "UX Lab test-interactions manifest"
      color: "#16A34A"
      state: "green_limited"
      status_label: "3 PASS / 0 FAIL"
      evidence:
        - "./run.sh run --manifest packages/ux-lab/test-manifests/embry-voice-10ft.json -> 3 PASS / 0 FAIL"
        - "10ft render"
        - "lean-in action contract"
        - "open-console transition"
      attach:
        - "packages/ux-lab/test-manifests/embry-voice-10ft.json"
      notes:
        - "Good UI action proof."
        - "Does not yet prove SPARTA idle/spoken/key integration."

    - id: qid_action_router
      label: "Voice Intent → QID Action Router"
      technology: "Embry voice daemon + UX qid action registry"
      color: "#F59E0B"
      state: "amber"
      status_label: "CONTRACT REQUIRED"
      evidence:
        - "Existing qid principle applies to voice, Stream Deck, agents, accessibility, and test-interactions"
      attach:
        - "qid/action contract"
      notes:
        - "Needs deterministic tests for SPARTA page commands."

    - id: sparta_distance_controller
      label: "SPARTA Distance Mode Controller"
      technology: "PageDistanceProvider/chatMode + Embry voice events"
      color: "#DC2626"
      state: "red_missing"
      status_label: "AUTOMATION NOT WIRED"
      evidence:
        - "Known limitation: current implementation uses existing distance-mode/chatMode control path"
        - "No real chatterbox/embry-os idle/spoken/key automation yet"
      attach:
        - "SPARTA kiosk implementation notes"
      notes:
        - "Blocker for declaring SPARTA distance voice-control integration ready."

    - id: sparta_10ft_board
      label: "SPARTA 10ft All-Pages Board"
      technology: "SpartaKioskDistanceView"
      color: "#F59E0B"
      state: "amber"
      status_label: "UI EXISTS / VOICE AUTOMATION PENDING"
      evidence:
        - "10ft mode expected after idle"
        - "Embry orb voice anchor required"
      attach:
        - "sparta-kiosk-10ft proof from prior review"

    - id: sparta_5ft_triage
      label: "SPARTA 5ft Voice Triage"
      technology: "SpartaKioskDistanceView selected-page triage"
      color: "#F59E0B"
      state: "amber"
      status_label: "UI EXISTS / TRANSCRIPT AUTOMATION PENDING"
      evidence:
        - "5ft mode expected when spoken/listening/speaking"
      attach:
        - "sparta-kiosk-5ft proof from prior review"

    - id: streamdeck_fallback
      label: "Stream Deck Fallback"
      technology: "QID-targeted tactile HMI"
      color: "#F59E0B"
      state: "amber_missing_proof"
      status_label: "CONTRACT EXISTS / PROOF NEEDED"
      evidence:
        - "Plant operators may be gloved/noisy; voice and Stream Deck must share qid targets"
      attach:
        - "Stream Deck/qid contract"

    - id: human_scope_gate
      label: "Human Scope Gate"
      technology: "Review decision / receipt-classification policy"
      color: "#F59E0B"
      state: "amber"
      status_label: "REQUIRED BEFORE HIDING FAILURES"
      evidence:
        - "Need human decision for active device profile and factory-noise scope"
      attach:
        - "receipt classification decision record"

  connections:
    - from: receipt_reference_probe
      to: current_readiness_panel
      label: "feeds only current-profile receipts"
      color: "#16A34A"

    - from: receipt_reference_probe
      to: historical_regression_ledger
      label: "routes superseded/old failed receipts"
      color: "#F59E0B"

    - from: receipt_reference_probe
      to: device_qualification_matrix
      label: "routes per-device/source receipts"
      color: "#F59E0B"

    - from: receipt_reference_probe
      to: factory_acoustic_qualification
      label: "routes factory/noisy capture receipts"
      color: "#F59E0B"

    - from: fresh_audible_suite
      to: current_readiness_panel
      label: "active live audible readiness"
      color: "#16A34A"

    - from: failed_receipt_continuous_voice_loop
      to: historical_regression_ledger
      label: "superseded old browser ASR failure"
      color: "#F59E0B"

    - from: failed_receipt_browser_asr_matrix
      to: device_qualification_matrix
      label: "bad device/source rows"
      color: "#DC2626"

    - from: failed_receipt_factory_source_68
      to: factory_acoustic_qualification
      label: "factory source 68 failed"
      color: "#DC2626"

    - from: failed_receipt_older_factory_acoustic
      to: factory_acoustic_qualification
      label: "older noisy capture failed"
      color: "#F59E0B"

    - from: chatterbox_core_tests
      to: current_readiness_panel
      label: "core audio pipeline confidence"
      color: "#16A34A"

    - from: chatterbox_loopback_harness
      to: current_readiness_panel
      label: "loopback harness no longer crashes"
      color: "#16A34A"

    - from: embry_os_voice_daemon_tests
      to: qid_action_router
      label: "service contract confidence; live proof still needed"
      color: "#F59E0B"

    - from: ux_test_interactions
      to: embry_voice_route
      label: "route/action smoke proof"
      color: "#16A34A"

    - from: current_readiness_panel
      to: embry_voice_route
      label: "renders current readiness banner"
      color: "#16A34A"

    - from: historical_regression_ledger
      to: embry_voice_route
      label: "renders retained historical failed receipts"
      color: "#F59E0B"

    - from: device_qualification_matrix
      to: embry_voice_route
      label: "renders per-device qualification"
      color: "#F59E0B"

    - from: factory_acoustic_qualification
      to: embry_voice_route
      label: "renders plant acoustic qualification"
      color: "#F59E0B"

    - from: qid_action_router
      to: sparta_distance_controller
      label: "voice intent emits {page,qid,action}"
      color: "#F59E0B"

    - from: sparta_distance_controller
      to: sparta_10ft_board
      label: "idle >= 4-5 minutes -> 10ft"
      color: "#DC2626"

    - from: sparta_distance_controller
      to: sparta_5ft_triage
      label: "spoken/listening/speaking -> 5ft"
      color: "#DC2626"

    - from: sparta_distance_controller
      to: streamdeck_fallback
      label: "voice unreliable -> qid-targeted tactile fallback"
      color: "#F59E0B"

    - from: human_scope_gate
      to: receipt_reference_probe
      label: "approves classification policy"
      color: "#F59E0B"
6. Clarifying questions before hiding or reclassifying the 4 failed gates

What is the authoritative current readiness suite?
Should the fresh 2026-07-07 audible suite be the only current readiness authority for the #embry-voice banner, with older receipts moved to ledger/matrix?

What is the active demo device profile?
Is the SPARTA/UX Lab voice path expected to run on webcam/browser-quality audio, default browser mic, Jabra, loopback, or a named plant-floor microphone?

Are the factory-noise failures required acceptance gates or retained negative tests?
If factory_noise_matrix_ok is required for plant-floor readiness, those receipts are red blockers. If they are stress/negative evidence, they belong in the acoustic matrix and should not fail current lab readiness.

What freshness TTL should current audible receipts use?
For example: does current voice readiness expire after 24 hours, 7 days, or only when code/device config changes?

Should the UI ever show a single failed gates count?
My recommendation is no: show 0 current failed gates, 4 retained failed receipts, and device/acoustic failures separately.

What is the human-approved wording for reclassified failures?
Recommended labels:

Superseded regression
Device not qualified
Factory acoustic not qualified
Negative evidence retained
7. Deterministic tests to add next
Receipt classification tests
embry-voice-receipt-classification-current-ready
- Given fresh audible suite ok/live/no failed gates.
- Given four failed JSON receipts classified historical/device/acoustic.
- Assert current_readiness.failed_gates.length === 0.
- Assert historical/device/acoustic panels preserve all four failed receipts.
embry-voice-receipt-classification-no-hide
- Assert every failed receipt appears in exactly one non-current panel.
- Assert no failed receipt disappears from UI.
embry-voice-stale-current-suite-degrades
- Force fresh suite timestamp outside TTL.
- Assert Current Voice Readiness becomes UNKNOWN or DEGRADED.
- Assert historical/device panels remain visible.
UI state-model tests
embry-voice-current-vs-historical-counts
- Visit http://localhost:3002/#embry-voice.
- Assert current panel says "0 current failed gates".
- Assert historical/device/acoustic sections list 4 retained failed receipts.
- Assert top banner does not simply say "4 failed gates" without class.
embry-voice-device-profile-jabra-blocks-device-only
- Select active device profile = jabra.
- Assert Jabra row is BLOCKED.
- Assert voice command path shows "Use fallback" or "Device not qualified".
- Assert current global path does not falsely show READY for Jabra.
embry-voice-factory-profile-blocks-plant-readiness
- Select deployment profile = factory_noise.
- Assert factory acoustic qualification failure blocks plant-floor readiness.
- Assert lab/browser readiness remains separately visible.
Live-service tests beyond mocked daemon tests
embry-os-voice-daemon-live-health
- Start real daemon or probe real endpoint.
- Assert ASR listener health returns live.
- Assert transcript event arrives for a known utterance.
- Assert TTS/audio artifact emitted or explicit unavailable state shown.
chatterbox-loopback-live-roundtrip
- Use default optional loopback args.
- Capture known utterance.
- Assert transcript present.
- Assert audio artifact present.
- Assert receipt written and referenced by route.
SPARTA distance-mode integration tests
sparta-distance-idle-to-10ft
- Start at #sparta-explorer/qras.
- Simulate idle >= 270000ms or dispatch test idle event.
- Assert 10ft all-pages board visible.
- Assert Embry orb visible.
- Assert current voice readiness displayed.
sparta-distance-spoken-to-5ft
- Dispatch Embry voice state LISTENING with utterance "show QRAs".
- Assert 5ft triage shell visible.
- Assert transcript contains HUMAN SAID / EMBRY HEARD / EMBRY SAYS.
- Assert selected target qid = sparta:kiosk:tile:qras.
sparta-distance-speaking-state
- Dispatch Embry voice state SPEAKING with response text.
- Assert Embry state label says SPEAKING.
- Assert transcript response is visible above fold.
sparta-distance-key-pointer-to-lean-in
- From 5ft, dispatch keydown.
- Assert lean-in renders existing Explorer page.
- Assert selected page/qid/transcriptTurnId preserved.
QID/action tests
embry-voice-command-chip-qid-contract
- Assert Replay/Speak/Listen/Open console have data-qid.
- Assert each has visible focus state.
- Assert each has action metadata.
embry-sparta-voice-intent-to-qid
- Simulate "show Coverage", "show QRAs", "show URLs", "what blocks readiness?"
- Assert each resolves to {page,qid,action}.
- Assert Stream Deck fallback uses the same qid/action.
Failure-mode tests
embry-voice-no-mic-permission-fail-closed
- Deny mic permission.
- Assert state = DEVICE BLOCKED or UNKNOWN.
- Assert UI does not display READY.
- Assert fallback action shown.
embry-voice-missing-receipt-fail-closed
- Remove one referenced receipt in fixture.
- Assert route_reference_probe missing_count > 0.
- Assert Current Readiness = UNKNOWN / DEGRADED.
8. Direct answers to the user’s questions

Are the 4 failed gates blockers?
Not to current browser/lab voice readiness if the fresh audible suite is the active authority. Yes to plant-floor readiness if factory-noise or failed device profiles are required. Yes as a UI/model blocker if they remain flattened into “4 failed gates” without classification.

What state model should #embry-voice use?
All three separated: current readiness, historical regression ledger, and device/acoustic qualification matrix.

What architecture diagram should be created?
Create the “Current Path vs Historical/Device Evidence” architecture diagram from the YAML above. It should visibly separate green current proof, amber historical/device evidence, red scoped blockers, and amber/missing SPARTA distance automation.

What clarifying questions should be asked?
Ask for authoritative current suite, active device profile, factory-noise acceptance scope, receipt freshness TTL, whether a single failed-gate count is allowed, and approved reclassification labels.

What deterministic tests should be added?
Add receipt-classification tests, UI current-vs-historical count tests, active-device/factory-profile tests, live daemon roundtrip tests, and SPARTA idle/spoken/key mode-transition tests.

9. Final readiness classification
Current Embry Voice browser/lab audible path: GREEN
Receipt reference integrity: GREEN for no missing, AMBER for failed-receipt classification
Chatterbox core: GREEN
Embry OS voice daemon service tests: AMBER because mostly mocked
Device qualification: AMBER overall, RED for named failed devices
Factory acoustic qualification: AMBER/RED pending human scope
SPARTA 10ft/5ft voice-control integration: AMBER / NOT READY TO DECLARE until idle-spoken-key automation is deterministic

Do not hide the four failed receipts. Reclassify them, preserve them, and stop counting them as current failures unless the human confirms they are active acceptance gates.

<<<WEBGPT_DONE:20260708T105618Z:4c892a13>>>
