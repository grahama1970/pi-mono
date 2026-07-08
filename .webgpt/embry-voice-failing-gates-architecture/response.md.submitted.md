<<<WEBGPT_REQUEST:EMBRY_VOICE_FAILING_GATES_ARCHITECTURE_BROWSER_READABLE>>>

You are reviewing the Embry Voice / Chatterbox / Embry OS integration model for SPARTA/UX Lab.

The local project agent already probed the live browser route and local receipt corpus. This bundle embeds the relevant facts so you do not need local filesystem access.

## What the visible route shows
- URL: http://localhost:3002/#embry-voice
- 10ft monitor text: Memory-first voice monitor.
- Counts visible in UI: 21 passed gates, 1 pending gate, 29 voice turns, 29 audio artifacts, 21 known speakers, 4 failed gates.
- Browser screenshot was visually inspected: route is visible with UX Lab chrome, orb, metrics, and actions Replay/Speak/Listen/Open console.

## Current proof facts
```json
{
  "fresh_audible_suite_summary": {
    "ok": true,
    "mocked": false,
    "live": true,
    "failed_gates": [],
    "passed": [
      "S01_S02_S08_S09_S12",
      "S08",
      "S10",
      "S03-unknown-speaker",
      "S04-ambiguous-speaker",
      "S05",
      "S06",
      "S13"
    ],
    "scenario_count": 8
  },
  "route_reference_probe": {
    "referenced_paths": 34,
    "missing_count_after_patch": 0,
    "ok_json_count": 14,
    "failed_json_count": 4,
    "failed_json": [
      {
        "failed_gates": [
          "realtimestt_listener_ok",
          "listener_transcript_present"
        ],
        "meaning": "old browser ASR EC/NS/AGC run failed; newer webcam browser-quality run passes",
        "receipt_id": "continuous-voice-loop.json"
      },
      {
        "failed_gates": [
          "jabra_ns_agc:whisper_transcript",
          "jabra_raw:whisper_transcript",
          "default_ns_agc:browser_ok",
          "default_ns_agc:whisper_transcript"
        ],
        "meaning": "device/source failure matrix, intentionally documents bad browser audio devices",
        "receipt_id": "browser-asr-matrix.json"
      },
      {
        "failed_gates": [
          "factory_noise_matrix_ok"
        ],
        "meaning": "factory source 68 negative/noisy capture path failed",
        "receipt_id": "index.json"
      },
      {
        "failed_gates": [
          "factory_noise_matrix_ok"
        ],
        "meaning": "older factory acoustic negative/noisy capture path failed",
        "receipt_id": "index.json"
      }
    ]
  },
  "tests": {
    "chatterbox_full_pytest": "PYTHONPATH=src python -m pytest -q tests -> 121 passed, 3 warnings",
    "embry_os_voice_daemon": ".venv/bin/python -m pytest -q services/tests/test_voice_daemon.py -> 16 passed (mostly mocked service tests)",
    "embry_voice_test_interactions": "./run.sh run --manifest packages/ux-lab/test-manifests/embry-voice-10ft.json -> 3 PASS / 0 FAIL",
    "cdp_marker": "/tmp/codex-ui-verification/pi-mono/embry-voice-integration-probe-r3/20260708T023256Z.png"
  },
  "commits": {
    "pi_mono_safety_branch": "origin/persona/tim-blazytko-1774553751276-sparta-kiosk-views @ 0f689d9ba Retarget Embry Voice receipts",
    "chatterbox_main": "6c9ad39 Default optional loopback capture args"
  }
}
```

## Local repairs already made
- EmbryVoiceLabRoute now points its fullSuite constant to the fresh 2026-07-07 audible suite.
- QRA disabled receipt now points to tau-qra-disabled.json, eliminating a missing referenced receipt.
- Chatterbox Rung 8 loopback harness now defaults optional pulse_source/capture_backend, so the fail-closed test no longer crashes.

## Deterministic probes already run
- Chatterbox pytest: 121 passed, 3 warnings.
- Embry OS voice-daemon: 16 passed, but mostly mocked service endpoint tests.
- Embry Voice /test-interactions: 3 PASS / 0 FAIL for 10ft render, lean-in action contract, and open-console transition.
- Receipt reference probe: 34 referenced paths, 0 missing, 14 ok JSON receipts, 4 failed JSON receipts.

## Questions for you
1. Are the 4 failed gates blockers to declaring Embry Voice / Chatterbox / Embry OS integration ready for SPARTA distance/voice control, or are they negative-evidence/device-qualification records that should not count as current readiness failures?
2. What state model should the #embry-voice UI use: current readiness, historical regression ledger, device qualification matrix, or all three separated?
3. What architecture diagram should we create? Please give a component/connection model with labels and colors for create-architecture. Include which nodes are verified green, which are warning/amber, which are red blockers, and which receipts/files attach to each node.
4. What clarifying questions should we ask the human before hiding/reclassifying the 4 failed gates?
5. What deterministic tests should be added next to prove the chosen model, especially for SPARTA 10ft/5ft integration with Embry voice idle/spoken/key states?

Return a source-derived numbered step model, then an implementation-ready architecture YAML proposal using create-architecture component ids/colors/connections. Classify each failed gate. Do not just say “looks good.”

<<<WEBGPT_DONE:EMBRY_VOICE_FAILING_GATES_ARCHITECTURE_BROWSER_READABLE>>>

---

Completion contract for browser automation:

At the very end of your final answer, print exactly:

<<<WEBGPT_DONE:20260708T105618Z:4c892a13>>>

Do not print anything after that marker.
