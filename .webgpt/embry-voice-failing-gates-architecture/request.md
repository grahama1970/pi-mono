<<<WEBGPT_REQUEST:EMBRY_VOICE_FAILING_GATES_ARCHITECTURE>>>

You are reviewing the Embry Voice / Chatterbox / Embry OS integration model for SPARTA/UX Lab.

Context:
- User asks whether we should use WebGPT + create-architecture on the failing gates and collaborate with clarifying questions.
- The visible route is http://localhost:3002/#embry-voice.
- The route shows a 10ft Embry Voice monitor with counts: 21 passed gates, 1 pending gate, 29 voice turns, 29 audio artifacts, 21 known speakers, 4 failed gates.
- We need decide whether these 4 failed gates are blockers, expected negative evidence, stale historical receipts, or should be reclassified/hidden from the top-level readiness count.
- The resulting model should become a create-architecture diagram in UX Lab Architecture Editor.

Current proof after local probe:
1. Chatterbox full pytest:
   PYTHONPATH=src python -m pytest -q tests -> 121 passed, 3 warnings.
2. Embry OS voice-daemon tests:
   .venv/bin/python -m pytest -q services/tests/test_voice_daemon.py -> 16 passed.
   These are mostly mocked service endpoint tests and prove wiring only.
3. Embry Voice route /test-interactions:
   3 PASS / 0 FAIL. It proves #embry-voice 10ft route renders, action contract exists, and Open Console transitions to lean-in.
4. CDP screenshot marker:
   /tmp/codex-ui-verification/pi-mono/embry-voice-integration-probe-r3/20260708T023256Z.png
5. Route artifact path probe after patch:
   34 referenced paths, 0 missing, 14 ok JSON receipts, 4 failed JSON receipts.
6. Fresh audible suite:
   /tmp/chatterbox-fork-agent-out/voice-chat-e2e/fresh-all-audible-20260707T155951Z/index.json
   ok=true, mocked=false, live=true, failed_gates=[], 8 scenarios passed:
   S01_S02_S08_S09_S12, S08, S10, S03-unknown-speaker, S04-ambiguous-speaker, S05, S06, S13.

The 4 failed JSON receipts still referenced by the UI are:
1. /tmp/chatterbox-fork-agent-out/voice-chat-e2e/voice-chat-e2e-20260703T223350Z-browser-asr-ec-ns-agc/continuous-voice-loop.json
   failed_gates: realtimestt_listener_ok, listener_transcript_present
   Interpretation: old browser ASR EC/NS/AGC run failed; newer browser-quality webcam run passes.
2. /tmp/chatterbox-fork-agent-out/voice-chat-e2e/browser-asr-matrix-20260703T223244Z/browser-asr-matrix.json
   failed_gates: jabra_ns_agc:whisper_transcript, jabra_raw:whisper_transcript, default_ns_agc:browser_ok, default_ns_agc:whisper_transcript
   Interpretation: device/source failure matrix, intentionally documents bad browser audio device paths.
3. /tmp/chatterbox-fork-agent-out/voice-chat-e2e/voice-chat-e2e-20260703T222756Z-factory-src68/index.json
   failed_gates: factory_noise_matrix_ok
   Interpretation: factory source 68 negative/noisy capture path failed.
4. /tmp/chatterbox-fork-agent-out/voice-chat-e2e/voice-chat-e2e-20260703T212038Z-factory-acoustic/index.json
   failed_gates: factory_noise_matrix_ok
   Interpretation: older factory acoustic negative/noisy capture path failed.

Local repairs already made:
- pi-mono: EmbryVoiceLabRoute now points fullSuite to fresh-all-audible-20260707T155951Z and qra-disabled to tau-qra-disabled.json. Missing referenced receipt count is now zero.
- chatterbox: smoke_rung8_loopback_listener.py now defaults optional pulse_source/capture_backend so fail-closed test passes.

Questions for you:
1. Are the 4 failed gates blockers to declaring Embry Voice / Chatterbox / Embry OS integration ready for SPARTA distance/voice control, or are they negative-evidence/device-qualification records that should not count as current readiness failures?
2. What state model should the #embry-voice UI use: current readiness, historical regression ledger, device qualification matrix, or all three separated?
3. What architecture diagram should we create? Please give a component/connection model with labels and colors for create-architecture. Include which nodes are verified green, which are warning/amber, which are red blockers, and which receipts/files attach to each node.
4. What clarifying questions should we ask the human before hiding/reclassifying the 4 failed gates?
5. What deterministic tests should be added next to prove the chosen model, especially for SPARTA 10ft/5ft integration with Embry voice idle/spoken/key states?

Return a source-derived numbered step model, then an implementation-ready architecture YAML proposal using create-architecture component ids/colors/connections. Do not just say “looks good”; classify each failed gate.

<<<WEBGPT_DONE:EMBRY_VOICE_FAILING_GATES_ARCHITECTURE>>>
