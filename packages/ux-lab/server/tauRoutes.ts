import type { Express, Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { existsSync } from 'fs'
import { mkdir, readFile, stat, writeFile } from 'fs/promises'
import { resolve } from 'path'

type JsonRecord = Record<string, unknown>

const TAU_REPO_ROOT = resolve(process.env.TAU_REPO_ROOT ?? '/home/graham/workspace/experiments/tau')
const TAU_COMMAND_LOOP_PROOF_ROOT = resolve(
	process.env.TAU_COMMAND_LOOP_PROOF_ROOT ?? '/tmp/tau-command-loop-explicit-ticket-source-proof',
)
const TAU_COMMAND_LOOP_SUMMARY_PATH = resolve(
	process.env.TAU_COMMAND_LOOP_SUMMARY_PATH ?? resolve(TAU_COMMAND_LOOP_PROOF_ROOT, 'summary.json'),
)
const TAU_SUBAGENT_EXPECTATION_PROOF_ROOT = resolve(
	process.env.TAU_SUBAGENT_EXPECTATION_PROOF_ROOT ?? '/tmp/tau-subagent-receipt-expectations',
)
const TAU_CHAT_UX_CONTRACT_PATH = resolve(
	process.env.TAU_CHAT_UX_CONTRACT_PATH ?? '/home/graham/workspace/experiments/tau/ui/tau-chat-contract.json',
)
const TAU_MEMORY_ROUTE_PROOF_ROOT = resolve(
	process.env.TAU_MEMORY_ROUTE_PROOF_ROOT
		?? '/home/graham/workspace/experiments/tau/experiments/goal-locked-subagents/proofs/live-memory-route-failclosed-20260628T140048Z',
)
const TAU_MEMORY_ROUTE_PROOF_MANIFEST = resolve(
	process.env.TAU_MEMORY_ROUTE_PROOF_MANIFEST ?? resolve(TAU_MEMORY_ROUTE_PROOF_ROOT, 'manifest.json'),
)
const TAU_WATCHDOG_RECEIPT_CHAIN_PROOF_ROOT = resolve(
	process.env.TAU_WATCHDOG_RECEIPT_CHAIN_PROOF_ROOT
		?? '/home/graham/workspace/experiments/tau/experiments/goal-locked-subagents/proofs/project-watchdog-fresh-compliance-ui-handoff-20260628T143800Z',
)
const TAU_WATCHDOG_RECEIPT_CHAIN_MANIFEST = resolve(
	process.env.TAU_WATCHDOG_RECEIPT_CHAIN_MANIFEST ?? resolve(TAU_WATCHDOG_RECEIPT_CHAIN_PROOF_ROOT, 'manifest.json'),
)
const TAU_TUI_RECEIPT_STREAM_RUN_DIR = resolve(
	process.env.TAU_TUI_RECEIPT_STREAM_RUN_DIR
		?? '/home/graham/workspace/experiments/tau/experiments/loop2-alignment/reliability-stress-20260626T205339Z/math_add/.loop2/runs/loop2-tau-stress-math_add-1782507220-da39d0',
)
const TAU_PERSONAPLEX_EMBRY_RECEIPT_PATH = resolve(
	process.env.TAU_PERSONAPLEX_EMBRY_RECEIPT_PATH
		?? '/home/graham/workspace/experiments/tau/experiments/loop2-alignment/reliability-stress-20260626T205025Z/persona-voice/personaplex-publish-receipt.json',
)
const TAU_PERSONAPLEX_EMBRY_METADATA_RECEIPT_PATH = resolve(
	process.env.TAU_PERSONAPLEX_EMBRY_METADATA_RECEIPT_PATH
		?? '/home/graham/workspace/experiments/tau/experiments/loop2-alignment/reliability-stress-20260626T205025Z/persona-voice/embry-memory-receipt.json',
)
const TAU_TEXTUAL_TUI_PROOF_ROOT = resolve(
	process.env.TAU_TEXTUAL_TUI_PROOF_ROOT
		?? '/home/graham/workspace/experiments/tau/experiments/goal-locked-subagents/proofs/textual-tui-proof-cli-20260628T204400Z',
)
const TAU_TEXTUAL_TUI_PROOF_MANIFEST = resolve(
	process.env.TAU_TEXTUAL_TUI_PROOF_MANIFEST ?? resolve(TAU_TEXTUAL_TUI_PROOF_ROOT, 'manifest.json'),
)
const TAU_ANNOTATION_RECEIPT_ROOT = resolve(
	process.env.TAU_ANNOTATION_RECEIPT_ROOT ?? '/tmp/tau-annotation-receipts',
)

function isPathInside(root: string, absolutePath: string): boolean {
	const normalizedRoot = root.endsWith('/') ? root : `${root}/`
	return absolutePath === root || absolutePath.startsWith(normalizedRoot)
}

function asRecord(value: unknown): JsonRecord | null {
	return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : null
}

function asString(value: unknown): string | null {
	return typeof value === 'string' && value.trim() ? value : null
}

function asBoolean(value: unknown): boolean | null {
	return typeof value === 'boolean' ? value : null
}

function asNumber(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function commandToText(command: unknown): string | null {
	if (!Array.isArray(command) || command.some((part) => typeof part !== 'string')) return null
	return command.join(' ')
}

function stringArray(value: unknown): string[] {
	if (!Array.isArray(value)) return []
	return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

function normalizedBbox(value: unknown, prefix: string): [number, number, number, number] {
	if (!Array.isArray(value) || value.length !== 4) throw new Error(`${prefix}.bbox must contain four normalized numbers`)
	const bbox = value.map((part) => asNumber(part))
	if (bbox.some((part) => part === null)) throw new Error(`${prefix}.bbox must contain four normalized numbers`)
	const [x1, y1, x2, y2] = bbox as [number, number, number, number]
	if ([x1, y1, x2, y2].some((part) => part < 0 || part > 1)) {
		throw new Error(`${prefix}.bbox values must be between 0 and 1`)
	}
	if (x2 <= x1 || y2 <= y1) throw new Error(`${prefix}.bbox must have positive width and height`)
	return [x1, y1, x2, y2]
}

function readJsonlRecords(text: string): JsonRecord[] {
	return text
		.split(/\r?\n/)
		.filter((line) => line.trim().length > 0)
		.map((line) => asRecord(JSON.parse(line)))
		.filter((record): record is JsonRecord => record !== null)
}

function resolveTauProofArtifact(path: string, proofRoot: string): string {
	const absoluteProofRoot = resolve(proofRoot)
	if (path.startsWith('/')) return resolve(path)
	const repoRelative = resolve(TAU_REPO_ROOT, path)
	if (isPathInside(absoluteProofRoot, repoRelative)) return repoRelative
	return resolve(absoluteProofRoot, path)
}

function normalizeGoal(value: unknown, prefix: string): JsonRecord {
	const goal = asRecord(value)
	if (!goal) throw new Error(`${prefix} goal is missing`)
	const goalId = asString(goal.goal_id)
	const goalVersion = goal.goal_version
	const goalHash = asString(goal.goal_hash)
	if (!goalId) throw new Error(`${prefix} goal.goal_id is missing`)
	if (typeof goalVersion !== 'number' || !Number.isInteger(goalVersion) || goalVersion < 1) {
		throw new Error(`${prefix} goal.goal_version is invalid`)
	}
	if (!goalHash) throw new Error(`${prefix} goal.goal_hash is missing`)
	return {
		goal_id: goalId,
		goal_version: goalVersion,
		goal_hash: goalHash,
	}
}

function goalsMatch(actual: JsonRecord, expected: JsonRecord): boolean {
	return (
		asString(actual.goal_id) === asString(expected.goal_id)
		&& actual.goal_version === expected.goal_version
		&& asString(actual.goal_hash) === asString(expected.goal_hash)
	)
}

function parseGithubTarget(target: string): { kind: 'new' } | { kind: 'issue' | 'pr'; number: string } | null {
	if (target === 'new') return { kind: 'new' }
	const match = /^(issue|pr)#([1-9]\d*)$/.exec(target)
	if (!match) return null
	return { kind: match[1] as 'issue' | 'pr', number: match[2] }
}

function isGithubLabel(value: string): boolean {
	return /^[A-Za-z0-9_.:-]+$/.test(value)
}

function renderExternalSubagentReceiptComment(receipt: JsonRecord): string {
	const nextAgent = asRecord(receipt.next_agent)
	const result = asRecord(receipt.result)
	const context = asRecord(receipt.context)
	return [
		'## Tau External Subagent Receipt',
		'',
		`Result: \`${asString(result?.status) ?? 'unknown'}\``,
		`Previous subagent: \`${asString(receipt.previous_subagent) ?? 'unknown'}\``,
		`Next agent: \`${asString(nextAgent?.name) ?? 'unknown'}\``,
		`Executor: \`${asString(nextAgent?.executor) ?? 'either'}\``,
		'',
		'### Context',
		'',
		asString(context?.summary) ?? 'No context summary supplied.',
		'',
		'### Result',
		'',
		asString(result?.summary) ?? 'No result summary supplied.',
		'',
		'### Required Evidence',
		'',
		...(
			stringArray(receipt.required_evidence).length
				? stringArray(receipt.required_evidence).map((item) => `- ${item}`)
				: ['- None specified']
		),
		'',
		'### Stop Condition',
		'',
		asString(receipt.stop_condition) ?? 'No stop condition supplied.',
		'',
		'<!-- tau-agent-handoff:v1 -->',
		'```json',
		JSON.stringify(receipt, null, 2),
		'```',
	].join('\n')
}

export async function normalizeTauChatUxContract(contractPath = TAU_CHAT_UX_CONTRACT_PATH): Promise<JsonRecord> {
	const absoluteContractPath = resolve(contractPath)
	if (!absoluteContractPath.endsWith('/ui/tau-chat-contract.json')) {
		throw new Error('Tau chat UX contract path must end with /ui/tau-chat-contract.json')
	}
	if (!existsSync(absoluteContractPath)) throw new Error('Tau chat UX contract not found')

	const contractStat = await stat(absoluteContractPath)
	if (!contractStat.isFile()) throw new Error('Tau chat UX contract path is not a file')

	const contract = await readJson(absoluteContractPath)
	if (contract.schema !== 'tau.chat_ux_contract.v1') {
		throw new Error('unexpected Tau chat UX contract schema')
	}
	const sourceOfTruth = asRecord(contract.source_of_truth)
	const repository = asString(sourceOfTruth?.repository)
	const path = asString(sourceOfTruth?.path)
	if (repository !== 'grahama1970/tau') throw new Error('Tau chat UX contract source repository mismatch')
	if (path !== 'ui/tau-chat-contract.json') throw new Error('Tau chat UX contract source path mismatch')

	const integrationSurfaces = Array.isArray(contract.integration_surfaces) ? contract.integration_surfaces : []
	const uxLabSurface = integrationSurfaces.map(asRecord).find((surface) => asString(surface?.host) === 'ux-lab')
	if (!uxLabSurface) throw new Error('Tau chat UX contract missing ux-lab integration surface')
	if (asString(uxLabSurface.role) !== 'integration_viewer') {
		throw new Error('Tau chat UX contract ux-lab surface must be integration_viewer')
	}

	const memoryPipeline = asRecord(contract.memory_pipeline)
	const supportedRoutes = stringArray(memoryPipeline?.supported_routes)
	const requiredRoutes = ['CLARIFY', 'DEFLECT', 'ANSWER', 'RESEARCH', 'COMPLIANCE']
	for (const route of requiredRoutes) {
		if (!supportedRoutes.includes(route)) throw new Error(`Tau chat UX contract missing supported route ${route}`)
	}

	const handoffContracts = stringArray(contract.handoff_contracts)
	for (const schema of ['tau.agent_handoff.v1', 'tau.external_subagent_github_projection.v1']) {
		if (!handoffContracts.includes(schema)) throw new Error(`Tau chat UX contract missing handoff schema ${schema}`)
	}

	const orchestrationMode = asRecord(contract.orchestration_mode)
	const orchestrationModeName = asString(orchestrationMode?.name)
	if (orchestrationModeName !== 'parameter_driven_orchestrated_loop') {
		throw new Error('Tau chat UX contract missing parameter-driven orchestration mode')
	}
	const activation = asString(orchestrationMode.activation)
	const runner = asString(orchestrationMode.runner)
	const scheduler = asString(orchestrationMode.scheduler)
	const loopRule = asString(orchestrationMode.loop_rule)
	const nonClaims = stringArray(orchestrationMode.non_claims)
	if (!activation || !activation.includes('--start') || !activation.includes('TAU_ORCHESTRATOR_START')) {
		throw new Error('Tau orchestration mode must document --start and TAU_ORCHESTRATOR_START activation')
	}
	if (runner !== 'handoff-command-loop') {
		throw new Error('Tau orchestration mode runner must be handoff-command-loop')
	}
	if (scheduler !== 'docker/tau-cron.sh') {
		throw new Error('Tau orchestration mode scheduler must be docker/tau-cron.sh')
	}
	if (!loopRule || !loopRule.includes('one selected bounded subagent command')) {
		throw new Error('Tau orchestration mode must document bounded subagent command ticks')
	}
	const requiredNonClaims = [
		'The browser chat does not execute real subagents.',
		'Dry-run projections do not mutate GitHub.',
		'Cron scheduling is not proof that a task succeeded.',
	]
	for (const nonClaim of requiredNonClaims) {
		if (!nonClaims.includes(nonClaim)) throw new Error(`Tau orchestration mode missing non-claim: ${nonClaim}`)
	}

	return {
		schema: 'tau.chat_ux_contract_view.v1',
		ok: true,
		sourcePath: absoluteContractPath,
		contract,
		sourceOfTruth: {
			repository,
			path,
		},
		integrationSurface: {
			host: asString(uxLabSurface.host),
			role: asString(uxLabSurface.role),
			route: asString(uxLabSurface.route),
		},
		supportedRoutes,
		handoffContracts,
		orchestrationMode: {
			name: orchestrationModeName,
			activation,
			runner,
			scheduler,
			loopRule,
			agentSource: asString(orchestrationMode.agent_source),
			githubTransport: asString(orchestrationMode.github_transport),
			nonClaims,
		},
		claims: {
			proves: [
				'UX Lab can load the T’au-owned chat UX contract from the T’au repository.',
				'UX Lab is marked as an integration viewer rather than the canonical source of truth.',
				'UX Lab can surface the T’au-owned parameter-driven orchestration mode without owning it.',
			],
			does_not_prove: [
				'The full T’au UX source has moved out of UX Lab.',
				'Final Sparta Chat readiness.',
				'Live GitHub mutation.',
				'Actual external subagent execution from the browser chat.',
			],
		},
	}
}

export async function normalizeTauTuiReceiptStream(
	runDir = TAU_TUI_RECEIPT_STREAM_RUN_DIR,
	repoRoot = TAU_REPO_ROOT,
): Promise<JsonRecord> {
	const absoluteRunDir = resolve(runDir)
	const absoluteRepoRoot = resolve(repoRoot)
	if (!isPathInside(absoluteRepoRoot, absoluteRunDir)) {
		throw new Error('Tau TUI receipt stream run directory must be inside the Tau repository')
	}
	const eventsPath = resolve(absoluteRunDir, 'events.jsonl')
	const finalReceiptPath = resolve(absoluteRunDir, 'final-receipt.json')
	if (!existsSync(eventsPath)) throw new Error('Tau TUI receipt stream events.jsonl not found')
	if (!existsSync(finalReceiptPath)) throw new Error('Tau TUI receipt stream final-receipt.json not found')

	const [eventsText, finalReceiptText] = await Promise.all([
		readFile(eventsPath, 'utf8'),
		readFile(finalReceiptPath, 'utf8'),
	])
	const events = readJsonlRecords(eventsText)
	const finalReceipt = asRecord(JSON.parse(finalReceiptText))
	if (!finalReceipt) throw new Error('Tau TUI receipt stream final receipt must be a JSON object')
	const runId = asString(finalReceipt.run_id)
	if (!runId) throw new Error('Tau TUI receipt stream final receipt missing run_id')
	if (finalReceipt.schema !== 'loop2.final_receipt.v1') {
		throw new Error('Tau TUI receipt stream final receipt schema mismatch')
	}
	if (finalReceipt.mocked !== false || finalReceipt.live !== true) {
		throw new Error('Tau TUI receipt stream must be backed by mocked=false live=true final receipt')
	}
	if (!events.length) throw new Error('Tau TUI receipt stream events are empty')
	for (const [index, event] of events.entries()) {
		if (event.schema !== 'loop2.event.v1') throw new Error(`Tau TUI receipt stream event ${index + 1} schema mismatch`)
		if (asString(event.run_id) !== runId) throw new Error(`Tau TUI receipt stream event ${index + 1} run_id mismatch`)
		if (!asString(event.event_id)) throw new Error(`Tau TUI receipt stream event ${index + 1} missing event_id`)
		if (!asString(event.event_type)) throw new Error(`Tau TUI receipt stream event ${index + 1} missing event_type`)
	}

	const status = asString(finalReceipt.status) ?? 'UNKNOWN'
	const streamEventCount = asNumber(asRecord(finalReceipt.scillm)?.stream_event_count)
	const transportRunId = asString(asRecord(finalReceipt.scillm)?.transport_run_id)
	const proves = stringArray(asRecord(finalReceipt.claims)?.proves)
	const doesNotProve = stringArray(asRecord(finalReceipt.claims)?.does_not_prove)
	const tailEvents = events.slice(-8)
	const terminalLines = [
		'tau@receipt-stream:~/loop2$ tail --schema loop2.event.v1 events.jsonl',
		`run_id=${runId}`,
		`source=${eventsPath}`,
		`mocked=false live=true status=${status}`,
		transportRunId ? `transport_run_id=${transportRunId}` : null,
		streamEventCount === null ? null : `scillm_stream_event_count=${streamEventCount}`,
		'',
		'event stream tail:',
		...tailEvents.map((event, index) => {
			const sequence = events.length - tailEvents.length + index + 1
			const eventType = asString(event.event_type) ?? 'unknown_event'
			const eventStatus = asString(event.status) ?? 'unknown'
			const message = asString(event.message) ?? ''
			return `${String(sequence).padStart(3, '0')} ${eventType} ${eventStatus}${message ? ` - ${message}` : ''}`
		}),
		'',
		`claims.proves=${proves.length}`,
		`claims.does_not_prove=${doesNotProve.length}`,
	].filter((line): line is string => typeof line === 'string')

	return {
		schema: 'tau.tui_receipt_stream_view.v1',
		ok: true,
		mocked: false,
		live: true,
		runId,
		runDir: absoluteRunDir,
		eventsPath,
		finalReceiptPath,
		eventCount: events.length,
		status,
		proofScope: asString(finalReceipt.proof_scope) ?? null,
		transportRunId,
		streamEventCount,
		latestEventType: asString(events[events.length - 1].event_type),
		terminalLines,
		claims: {
			proves,
			does_not_prove: doesNotProve,
		},
	}
}

export async function normalizeTauTextualTuiProof(
	manifestPath = TAU_TEXTUAL_TUI_PROOF_MANIFEST,
	proofRoot = TAU_TEXTUAL_TUI_PROOF_ROOT,
	repoRoot = TAU_REPO_ROOT,
): Promise<JsonRecord> {
	const absoluteManifestPath = resolve(manifestPath)
	const absoluteProofRoot = resolve(proofRoot)
	const absoluteRepoRoot = resolve(repoRoot)
	if (!isPathInside(absoluteRepoRoot, absoluteProofRoot)) {
		throw new Error('Tau Textual TUI proof root must be inside the Tau repository')
	}
	if (!isPathInside(absoluteProofRoot, absoluteManifestPath)) {
		throw new Error('Tau Textual TUI proof manifest path escapes proof root')
	}
	if (!existsSync(absoluteManifestPath)) throw new Error('Tau Textual TUI proof manifest not found')
	const manifestStat = await stat(absoluteManifestPath)
	if (!manifestStat.isFile()) throw new Error('Tau Textual TUI proof manifest path is not a file')

	const manifest = await readJson(absoluteManifestPath)
	if (manifest.schema !== 'tau.proof_manifest.v1') {
		throw new Error('unexpected Tau Textual TUI proof manifest schema')
	}
	if (asString(manifest.surface) !== 'tau:textual-tui') {
		throw new Error('Tau Textual TUI proof manifest surface mismatch')
	}
	if (manifest.mocked !== true || manifest.live !== false) {
		throw new Error('Tau Textual TUI proof must be mocked=true live=false')
	}
	const implementationScope = asRecord(manifest.implementation_scope)
	const evidence = asRecord(manifest.evidence)
	const cliProof = asRecord(evidence?.cli_proof)
	if (!implementationScope) throw new Error('Tau Textual TUI proof missing implementation_scope')
	if (!cliProof) throw new Error('Tau Textual TUI proof missing cli_proof evidence')
	const runId = asString(implementationScope.shared_run_id)
	const prompt = asString(implementationScope.fixture_prompt)
	const receiptPath = asString(cliProof.receipt)
	const screenshotSvg = asString(cliProof.screenshot_svg)
	const screenshotPng = asString(cliProof.screenshot_png)
	if (!runId) throw new Error('Tau Textual TUI proof missing shared_run_id')
	if (!prompt) throw new Error('Tau Textual TUI proof missing fixture_prompt')
	if (!receiptPath) throw new Error('Tau Textual TUI proof missing receipt path')
	if (!screenshotSvg) throw new Error('Tau Textual TUI proof missing screenshot_svg')
	if (!screenshotPng) throw new Error('Tau Textual TUI proof missing screenshot_png')
	if (cliProof.ok !== true || cliProof.mocked !== true || cliProof.live !== false) {
		throw new Error('Tau Textual TUI cli proof must be ok mocked=true live=false')
	}

	const absoluteReceiptPath = resolve(receiptPath)
	const absoluteScreenshotSvg = resolve(screenshotSvg)
	const absoluteScreenshotPng = resolve(screenshotPng)
	for (const path of [absoluteReceiptPath, absoluteScreenshotSvg, absoluteScreenshotPng]) {
		if (!existsSync(path)) throw new Error(`Tau Textual TUI proof artifact missing: ${path}`)
	}
	const receipt = await readJson(absoluteReceiptPath)
	if (receipt.schema !== 'tau.textual_tui_render_proof.v1') {
		throw new Error('Tau Textual TUI render receipt schema mismatch')
	}
	if (receipt.ok !== true || receipt.mocked !== true || receipt.live !== false) {
		throw new Error('Tau Textual TUI render receipt must be ok mocked=true live=false')
	}
	if (asString(receipt.run_id) !== runId) {
		throw new Error('Tau Textual TUI render receipt run_id mismatch')
	}
	const assertions = asRecord(receipt.visible_assertions)
	if (assertions?.accessing_memory !== true) {
		throw new Error('Tau Textual TUI render receipt must assert accessing_memory=true')
	}
	if (assertions?.hidden_reasoning_absent !== true) {
		throw new Error('Tau Textual TUI render receipt must assert hidden_reasoning_absent=true')
	}
	const claims = asRecord(manifest.claims)
	return {
		schema: 'tau.textual_tui_proof_view.v1',
		ok: true,
		manifestPath: absoluteManifestPath,
		proofRoot: absoluteProofRoot,
		sourceSchema: manifest.schema,
		runId,
		prompt,
		mocked: true,
		live: false,
		status: asString(manifest.status),
		entrypoint: asString(implementationScope.entrypoint),
		sourceType: asString(implementationScope.source_type),
		receiptPath: absoluteReceiptPath,
		screenshotSvg: absoluteScreenshotSvg,
		screenshotPng: absoluteScreenshotPng,
		visibleAssertions: stringArray(cliProof.visible_assertions),
		textAssertions: stringArray(cliProof.text_assertions),
		doesNotProve: stringArray(receipt.does_not_prove),
		claims: {
			proves: stringArray(claims?.proves),
			does_not_prove: stringArray(claims?.does_not_prove),
		},
	}
}

export async function resolveTauTextualTuiProofScreenshot(
	manifestPath = TAU_TEXTUAL_TUI_PROOF_MANIFEST,
	proofRoot = TAU_TEXTUAL_TUI_PROOF_ROOT,
	repoRoot = TAU_REPO_ROOT,
): Promise<{ path: string; contentType: 'image/png' }> {
	const proof = await normalizeTauTextualTuiProof(manifestPath, proofRoot, repoRoot)
	const screenshotPng = asString(proof.screenshotPng)
	if (!screenshotPng) throw new Error('Tau Textual TUI proof view missing screenshotPng')
	if (!screenshotPng.toLowerCase().endsWith('.png')) {
		throw new Error('Tau Textual TUI proof screenshot must be a PNG artifact')
	}
	return { path: screenshotPng, contentType: 'image/png' }
}

export async function normalizeTauPersonaplexEmbryReceipt(
	receiptPath = TAU_PERSONAPLEX_EMBRY_RECEIPT_PATH,
	metadataReceiptPath = TAU_PERSONAPLEX_EMBRY_METADATA_RECEIPT_PATH,
	repoRoot = TAU_REPO_ROOT,
): Promise<JsonRecord> {
	const absoluteReceiptPath = resolve(receiptPath)
	const absoluteMetadataReceiptPath = resolve(metadataReceiptPath)
	const absoluteRepoRoot = resolve(repoRoot)
	if (!isPathInside(absoluteRepoRoot, absoluteReceiptPath)) {
		throw new Error('PersonaPlex Embry receipt path must be inside the Tau repository')
	}
	if (!isPathInside(absoluteRepoRoot, absoluteMetadataReceiptPath)) {
		throw new Error('PersonaPlex Embry metadata receipt path must be inside the Tau repository')
	}

	let metadataVoice: JsonRecord | null = null
	if (existsSync(absoluteMetadataReceiptPath)) {
		const metadataReceipt = asRecord(JSON.parse(await readFile(absoluteMetadataReceiptPath, 'utf8')))
		metadataVoice = asRecord(metadataReceipt?.persona_voice)
	}

	if (!existsSync(absoluteReceiptPath)) {
		return {
			schema: 'tau.personaplex_embry_receipt_gate.v1',
			ok: true,
			available: false,
			failClosed: true,
			persona: 'embry',
			voiceEngine: 'personaplex',
			requiredSchema: 'personaplex.publish_receipt.v1',
			requiredStatus: 'CACHE_REPLAY_PASS',
			receiptPath: absoluteReceiptPath,
			metadataReceiptPath: absoluteMetadataReceiptPath,
			metadataVoiceStatus: asString(metadataVoice?.voice_status) ?? 'UNKNOWN',
			reason: 'PersonaPlex Embry publish receipt is not present; audio activation remains disabled.',
			claims: {
				proves: [
					'Tau refuses to enable Embry PersonaPlex audio without a real publish receipt.',
				],
				does_not_prove: [
					'PersonaPlex audio synthesis',
					'published PersonaPlex voice identity',
					'live full-duplex PersonaPlex readiness',
				],
			},
		}
	}

	const receipt = asRecord(JSON.parse(await readFile(absoluteReceiptPath, 'utf8')))
	if (!receipt) throw new Error('PersonaPlex Embry receipt must be a JSON object')
	if (receipt.schema !== 'personaplex.publish_receipt.v1') {
		throw new Error('PersonaPlex Embry receipt schema mismatch')
	}
	if (asString(receipt.persona) !== 'embry') {
		throw new Error('PersonaPlex Embry receipt persona mismatch')
	}
	if (asString(receipt.status) !== 'CACHE_REPLAY_PASS') {
		throw new Error('PersonaPlex Embry receipt status must be CACHE_REPLAY_PASS')
	}
	const generatedVoicePrompts = Array.isArray(receipt.generated_voice_prompts) ? receipt.generated_voice_prompts : []
	if (!generatedVoicePrompts.length) throw new Error('PersonaPlex Embry receipt missing generated_voice_prompts')
	const prompts = generatedVoicePrompts.map(asRecord)
	for (const [index, prompt] of prompts.entries()) {
		if (!prompt) throw new Error(`PersonaPlex Embry voice prompt ${index + 1} must be a JSON object`)
		if (!asString(prompt.pt)) throw new Error(`PersonaPlex Embry voice prompt ${index + 1} missing pt`)
		if (!asRecord(prompt.pt_schema)) throw new Error(`PersonaPlex Embry voice prompt ${index + 1} missing pt_schema`)
		if (!asString(prompt.replay_output_wav)) {
			throw new Error(`PersonaPlex Embry voice prompt ${index + 1} missing replay_output_wav`)
		}
		if (!asString(prompt.replay_output_text)) {
			throw new Error(`PersonaPlex Embry voice prompt ${index + 1} missing replay_output_text`)
		}
	}

	return {
		schema: 'tau.personaplex_embry_receipt_gate.v1',
		ok: true,
		available: true,
		failClosed: false,
		persona: 'embry',
		voiceEngine: 'personaplex',
		requiredSchema: 'personaplex.publish_receipt.v1',
		requiredStatus: 'CACHE_REPLAY_PASS',
		receiptPath: absoluteReceiptPath,
		metadataReceiptPath: absoluteMetadataReceiptPath,
		status: asString(receipt.status),
		publicationStatus: asString(receipt.publication_status),
		humanReviewStatus: asString(receipt.human_review_status),
		promptCount: prompts.length,
		reviewHtml: asString(receipt.review_html),
		claims: {
			proves: [
				'Embry has a PersonaPlex native cache replay receipt with generated voice prompt artifacts.',
			],
			does_not_prove: [
				'Human approval of the voice identity',
				'live full-duplex PersonaPlex readiness',
			],
		},
	}
}

export async function persistTauWatchAnnotationReceipt(
	value: unknown,
	receiptRoot = TAU_ANNOTATION_RECEIPT_ROOT,
): Promise<JsonRecord> {
	const payload = asRecord(value)
	if (!payload) throw new Error('Tau annotation payload must be a JSON object')

	const segment = asRecord(payload.segment)
	const segmentId = asString(payload.segmentId) ?? asString(segment?.id)
	const segmentLabel = asString(payload.segmentLabel) ?? asString(segment?.label)
	const playheadSeconds = asNumber(payload.playheadSeconds)
	const boxes = Array.isArray(payload.boxes) ? payload.boxes : []
	if (!segmentId) throw new Error('segmentId is required')
	if (!segmentLabel) throw new Error('segmentLabel is required')
	if (playheadSeconds === null) throw new Error('playheadSeconds is required')
	if (boxes.length < 1) throw new Error('at least one annotation box is required')

	const normalizedBoxes = boxes.map((boxValue, index) => {
		const box = asRecord(boxValue)
		if (!box) throw new Error(`boxes[${index}] must be an object`)
		const characterName = asString(box.characterName)
		const actorName = asString(box.actorName) ?? ''
		if (!characterName) throw new Error(`boxes[${index}].characterName is required`)
		return {
			id: asString(box.id) ?? `box-${index + 1}`,
			characterName,
			actorName,
			bbox: normalizedBbox(box.bbox, `boxes[${index}]`),
			status: 'receipt_written',
		}
	})

	const runId = `tau-annotation-${new Date().toISOString().replace(/[-:.]/g, '').replace('T', 'T').replace('Z', 'Z')}-${randomUUID().slice(0, 8)}`
	const absoluteReceiptRoot = resolve(receiptRoot)
	const receiptPath = resolve(absoluteReceiptRoot, `${runId}.json`)
	if (!isPathInside(absoluteReceiptRoot, receiptPath)) throw new Error('resolved annotation receipt path escaped receipt root')

	const receipt = {
		schema: 'tau.watch_annotation_receipt.v1',
		ok: true,
		live: true,
		mocked: false,
		runId,
		receiptPath,
		createdUtc: new Date().toISOString(),
		source: {
			project: 'ux-lab',
			surface: 'tau-chat',
			route: '/api/tau/annotations',
		},
		segment: {
			id: segmentId,
			label: segmentLabel,
		},
		playheadSeconds,
		boxes: normalizedBoxes,
		boxCount: normalizedBoxes.length,
		claims: {
			proves: [
				'Tau annotation modal can submit a validated movie annotation payload to a Tau-owned receipt endpoint.',
				'Tau annotation endpoint writes a durable JSON receipt for the approved segment boxes.',
			],
			does_not_prove: [
				'Watch production annotation persistence',
				'movie-library identity correctness',
				'model/VLM character recognition correctness',
				'final Sparta Chat readiness',
			],
		},
	}
	await mkdir(absoluteReceiptRoot, { recursive: true })
	await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8')
	return receipt
}

async function readJson(path: string): Promise<JsonRecord> {
	const raw = await readFile(path, 'utf8')
	const parsed = JSON.parse(raw)
	const record = asRecord(parsed)
	if (!record) throw new Error('receipt root must be a JSON object')
	return record
}

export async function normalizeTauCommandLoopProjection(
	summaryPath: string,
	proofRoot = TAU_COMMAND_LOOP_PROOF_ROOT,
): Promise<JsonRecord> {
	const absoluteSummaryPath = resolve(summaryPath)
	const absoluteProofRoot = resolve(proofRoot)
	if (!isPathInside(absoluteProofRoot, absoluteSummaryPath)) {
		throw new Error('summary path escapes Tau command-loop proof root')
	}
	if (!existsSync(absoluteSummaryPath)) throw new Error('Tau command-loop summary receipt not found')

	const summaryStat = await stat(absoluteSummaryPath)
	if (!summaryStat.isFile()) throw new Error('Tau command-loop summary path is not a file')

	const summary = await readJson(absoluteSummaryPath)
	if (summary.schema !== 'tau.command_loop_explicit_ticket_source_summary.v1') {
		throw new Error('unexpected Tau command-loop summary schema')
	}

	const githubTransport = asRecord(summary.github_transport)
	const reconciliation = asRecord(summary.reconciliation)
	const counts = asRecord(reconciliation?.counts)
	const commands = Array.isArray(githubTransport?.commands)
		? githubTransport.commands.map(commandToText).filter((command): command is string => Boolean(command))
		: []

	const sourceLoopReceiptPath = asString(githubTransport?.source_loop_receipt_path)
	const reconciliationReceiptPath = asString(githubTransport?.reconciliation_receipt_path)
	const ticketSourcePath = asString(githubTransport?.ticket_source_path)
	const transportReceiptPath = resolve(absoluteProofRoot, 'command-loop-reconciliation-github-transport.json')

	for (const path of [sourceLoopReceiptPath, reconciliationReceiptPath, ticketSourcePath, transportReceiptPath]) {
		if (!path) throw new Error('Tau command-loop projection receipt is missing a required path')
		if (!isPathInside(absoluteProofRoot, resolve(path))) {
			throw new Error(`Tau command-loop projection path escapes proof root: ${path}`)
		}
	}

	return {
		schema: String(summary.schema),
		summaryPath: absoluteSummaryPath,
		sourceLoopReceiptPath,
		reconciliationReceiptPath,
		actualReconciliationStepReceiptPath: resolve(absoluteProofRoot, 'command-loop/command-loop-step-001.receipt.json'),
		ticketSourcePath,
		transportReceiptPath,
		dryRun: asBoolean(githubTransport?.dry_run),
		applied: asBoolean(githubTransport?.applied),
		mocked: asBoolean(summary.mocked),
		live: asBoolean(summary.live),
		commandCount: asNumber(githubTransport?.command_count) ?? commands.length,
		reconciliationCounts: {
			keep: asNumber(counts?.keep) ?? 0,
			close: asNumber(counts?.close) ?? 0,
			migrate: asNumber(counts?.migrate) ?? 0,
			regenerate: asNumber(counts?.regenerate) ?? 0,
		},
		commands,
	}
}

export async function normalizeTauMemoryRouteProof(
	manifestPath = TAU_MEMORY_ROUTE_PROOF_MANIFEST,
	proofRoot = TAU_MEMORY_ROUTE_PROOF_ROOT,
): Promise<JsonRecord> {
	const absoluteManifestPath = resolve(manifestPath)
	const absoluteProofRoot = resolve(proofRoot)
	if (!isPathInside(absoluteProofRoot, absoluteManifestPath)) {
		throw new Error('Tau Memory route proof manifest path escapes proof root')
	}
	if (!existsSync(absoluteManifestPath)) throw new Error('Tau Memory route proof manifest not found')

	const manifestStat = await stat(absoluteManifestPath)
	if (!manifestStat.isFile()) throw new Error('Tau Memory route proof manifest path is not a file')

	const manifest = await readJson(absoluteManifestPath)
	if (manifest.schema !== 'tau.live_memory_route_failclosed_proof.v1') {
		throw new Error('unexpected Tau Memory route proof manifest schema')
	}
	if (manifest.ok !== true) throw new Error('Tau Memory route proof manifest is not ok')
	if (manifest.mocked !== false) throw new Error('Tau Memory route proof manifest must be mocked=false')
	if (manifest.live !== true) throw new Error('Tau Memory route proof manifest must be live=true')

	const routes = Array.isArray(manifest.routes) ? manifest.routes.map(asRecord) : []
	const routeCount = asNumber(manifest.route_count)
	if (!Number.isInteger(routeCount) || routeCount !== routes.length || routeCount < 1) {
		throw new Error('Tau Memory route proof route_count does not match routes')
	}

	const normalizedRoutes = routes.map((route, index) => {
		if (!route) throw new Error(`Tau Memory route proof route ${index} is not an object`)
		const routeName = asString(route.route)
		const branchStatus = asString(route.branch_status)
		const receipt = asString(route.receipt)
		if (!routeName) throw new Error(`Tau Memory route proof route ${index} missing route`)
		if (!branchStatus) throw new Error(`Tau Memory route proof route ${routeName} missing branch_status`)
		if (route.live !== true || route.mocked !== false) {
			throw new Error(`Tau Memory route proof route ${routeName} must be live=true and mocked=false`)
		}
		if (typeof route.fail_closed !== 'boolean') {
			throw new Error(`Tau Memory route proof route ${routeName} missing fail_closed boolean`)
		}
		if (!receipt) throw new Error(`Tau Memory route proof route ${routeName} missing receipt`)
		const receiptPath = resolve(absoluteProofRoot, receipt)
		if (!isPathInside(absoluteProofRoot, receiptPath)) {
			throw new Error(`Tau Memory route proof receipt path escapes proof root: ${receipt}`)
		}
		const currentStage = asRecord(route.current_stage)
		return {
			route: routeName,
			query: asString(route.query) ?? '',
			selectedSkill: asString(route.selected_skill),
			intentAction: asString(route.intent_action),
			branchSchema: asString(route.branch_schema),
			branchStatus,
			failClosed: route.fail_closed,
			live: true,
			mocked: false,
			memoryProductSchema: asString(route.memory_product_schema),
			currentStage: currentStage
				? {
						stage: asString(currentStage.stage),
						label: asString(currentStage.label),
						status: asString(currentStage.status),
						source: asString(currentStage.source),
					}
				: null,
			receipt,
			receiptPath,
			selectionReasons: stringArray(route.selection_reasons),
			validationErrors: stringArray(route.validation_errors),
		}
	})

	const routeNames = normalizedRoutes.map((route) => route.route)
	for (const requiredRoute of ['CLARIFY', 'DEFLECT', 'ANSWER_SELECTOR_ATTEMPT', 'ANSWER_DIRECT_PRODUCT', 'RESEARCH_BRAVE_DISABLED']) {
		if (!routeNames.includes(requiredRoute)) throw new Error(`Tau Memory route proof missing route ${requiredRoute}`)
	}
	const researchRoute = normalizedRoutes.find((route) => route.route === 'RESEARCH_BRAVE_DISABLED')
	if (!researchRoute?.failClosed || researchRoute.branchStatus !== 'FAILED') {
		throw new Error('Tau Memory route proof must show RESEARCH_BRAVE_DISABLED failed closed')
	}
	const answerSelector = normalizedRoutes.find((route) => route.route === 'ANSWER_SELECTOR_ATTEMPT')
	if (answerSelector?.selectedSkill !== 'memory.clarify') {
		throw new Error('Tau Memory route proof must preserve ANSWER selector limitation')
	}
	const answerDirect = normalizedRoutes.find((route) => route.route === 'ANSWER_DIRECT_PRODUCT')
	if (answerDirect?.memoryProductSchema !== 'memory.answer.v1' || answerDirect.branchStatus !== 'PASS') {
		throw new Error('Tau Memory route proof must include a direct memory.answer.v1 product')
	}

	const claims = asRecord(manifest.claims)
	return {
		schema: 'tau.memory_route_failclosed_view.v1',
		ok: true,
		manifestPath: absoluteManifestPath,
		proofRoot: absoluteProofRoot,
		sourceSchema: manifest.schema,
		createdUtc: asString(manifest.created_utc),
		mocked: false,
		live: true,
		routeCount,
		proofScope: asString(manifest.proof_scope),
		routes: normalizedRoutes,
		claims: {
			proves: stringArray(claims?.proves),
			does_not_prove: stringArray(claims?.does_not_prove),
		},
	}
}

export async function normalizeTauWatchdogReceiptChain(
	manifestPath = TAU_WATCHDOG_RECEIPT_CHAIN_MANIFEST,
	proofRoot = TAU_WATCHDOG_RECEIPT_CHAIN_PROOF_ROOT,
): Promise<JsonRecord> {
	const absoluteManifestPath = resolve(manifestPath)
	const absoluteProofRoot = resolve(proofRoot)
	if (!isPathInside(absoluteProofRoot, absoluteManifestPath)) {
		throw new Error('Tau watchdog receipt-chain manifest path escapes proof root')
	}
	if (!existsSync(absoluteManifestPath)) throw new Error('Tau watchdog receipt-chain manifest not found')

	const manifestStat = await stat(absoluteManifestPath)
	if (!manifestStat.isFile()) throw new Error('Tau watchdog receipt-chain manifest path is not a file')

	const manifest = await readJson(absoluteManifestPath)
	if (manifest.schema !== 'tau.project_watchdog_fresh_compliance_ui_handoff_proof.v1') {
		throw new Error('unexpected Tau watchdog receipt-chain manifest schema')
	}
	if (manifest.ok !== true) throw new Error('Tau watchdog receipt-chain manifest is not ok')
	if (manifest.mocked !== false) throw new Error('Tau watchdog receipt-chain manifest must be mocked=false')
	if (manifest.live !== true) throw new Error('Tau watchdog receipt-chain manifest must be live=true')

	const githubIssue = asRecord(manifest.github_issue)
	const watchdog = asRecord(manifest.watchdog)
	const inputs = asRecord(manifest.watchdog_inputs)
	const commandLoop = asRecord(manifest.command_loop)
	const githubTransport = asRecord(manifest.github_transport)
	if (!githubIssue) throw new Error('Tau watchdog receipt-chain manifest missing github_issue')
	if (!watchdog) throw new Error('Tau watchdog receipt-chain manifest missing watchdog')
	if (!inputs) throw new Error('Tau watchdog receipt-chain manifest missing watchdog_inputs')
	if (!commandLoop) throw new Error('Tau watchdog receipt-chain manifest missing command_loop')
	if (!githubTransport) throw new Error('Tau watchdog receipt-chain manifest missing github_transport')

	const issueNumber = asNumber(githubIssue.number)
	const issueUrl = asString(githubIssue.url)
	const issueTitle = asString(githubIssue.title)
	const finalState = asString(githubIssue.final_state)
	const finalLabels = stringArray(githubIssue.final_labels)
	if (!Number.isInteger(issueNumber) || issueNumber < 1) throw new Error('Tau watchdog receipt-chain issue number is invalid')
	if (!issueUrl || !issueUrl.includes(`/issues/${issueNumber}`)) throw new Error('Tau watchdog receipt-chain issue URL is invalid')
	if (!issueTitle) throw new Error('Tau watchdog receipt-chain issue title is missing')
	if (finalState !== 'CLOSED') throw new Error('Tau watchdog receipt-chain issue must be closed after proof capture')
	if (!finalLabels.includes('agent-done')) throw new Error('Tau watchdog receipt-chain issue missing final agent-done label')

	const runId = asString(watchdog.run_id)
	const watchdogReceipt = asString(watchdog.receipt)
	if (!runId) throw new Error('Tau watchdog receipt-chain missing run_id')
	if (watchdog.schema !== 'agent_skills.project_watchdog.tick_receipt.v1') {
		throw new Error('Tau watchdog receipt-chain watchdog receipt schema mismatch')
	}
	if (watchdog.ok !== true || asString(watchdog.status) !== 'COMPLETED') {
		throw new Error('Tau watchdog receipt-chain watchdog receipt must be completed')
	}
	if (asNumber(watchdog.handled_count) !== 1) {
		throw new Error('Tau watchdog receipt-chain watchdog handled_count must equal 1')
	}

	const commandLoopReceipt = asString(commandLoop.receipt)
	const selectedAgent = asString(commandLoop.selected_agent)
	const commandLoopStatus = asString(commandLoop.status)
	if (commandLoop.schema !== 'tau.agent_handoff_command_loop_receipt.v1') {
		throw new Error('Tau watchdog receipt-chain command-loop schema mismatch')
	}
	if (commandLoop.ok !== true || commandLoop.mocked !== false || commandLoop.live !== true) {
		throw new Error('Tau watchdog receipt-chain command loop must be ok, mocked=false, live=true')
	}
	if (asNumber(commandLoop.step_count) !== 1) throw new Error('Tau watchdog receipt-chain command loop must have one step')
	if (selectedAgent !== 'reviewer') throw new Error('Tau watchdog receipt-chain must select reviewer')
	if (asNumber(commandLoop.selected_agent_command_exit_code) !== 0) {
		throw new Error('Tau watchdog receipt-chain reviewer command exit code must be 0')
	}
	if (commandLoopStatus !== 'WAITING' || asString(commandLoop.terminal_agent) !== 'human') {
		throw new Error('Tau watchdog receipt-chain command loop must stop at human')
	}

	const transportReceipt = asString(githubTransport.receipt)
	if (githubTransport.schema !== 'tau.github_command_loop_terminal_transport_receipt.v1') {
		throw new Error('Tau watchdog receipt-chain transport schema mismatch')
	}
	if (githubTransport.ok !== true || githubTransport.dry_run !== true || githubTransport.applied !== false) {
		throw new Error('Tau watchdog receipt-chain transport must be ok dry_run=true applied=false')
	}

	const localPaths = [watchdogReceipt, commandLoopReceipt, asString(commandLoop.step_receipt), transportReceipt].filter(
		(path): path is string => Boolean(path),
	)
	for (const path of localPaths) {
		const absolutePath = resolveTauProofArtifact(path, absoluteProofRoot)
		if (!isPathInside(absoluteProofRoot, absolutePath)) {
			throw new Error(`Tau watchdog receipt-chain path escapes proof root: ${path}`)
		}
		if (!existsSync(absolutePath)) throw new Error(`Tau watchdog receipt-chain artifact missing: ${path}`)
	}

	return {
		schema: 'tau.watchdog_receipt_chain_view.v1',
		ok: true,
		manifestPath: absoluteManifestPath,
		proofRoot: absoluteProofRoot,
		sourceSchema: manifest.schema,
		mocked: false,
		live: true,
		runId,
		scope: asString(manifest.scope),
		issue: {
			number: issueNumber,
			url: issueUrl,
			title: issueTitle,
			finalState,
			finalLabels,
			commentCount: asNumber(githubIssue.comment_count) ?? 0,
		},
		inputs: {
			action: asString(inputs.action),
			start: asString(inputs.start),
			maxSteps: asNumber(inputs.max_steps),
			activeGoalHash: asString(inputs.active_goal_hash),
			applyTransport: asBoolean(inputs.apply_transport),
			issue: asString(inputs.issue),
		},
		watchdog: {
			receipt: watchdogReceipt,
			status: asString(watchdog.status),
			handledCount: asNumber(watchdog.handled_count),
			leaseCommentSeen: asBoolean(watchdog.lease_comment_seen),
			evidenceCommentSeen: asBoolean(watchdog.evidence_comment_seen),
		},
		commandLoop: {
			receipt: commandLoopReceipt,
			stepReceipt: asString(commandLoop.step_receipt),
			status: commandLoopStatus,
			stepCount: asNumber(commandLoop.step_count),
			selectedAgent,
			selectedAgentCommandExitCode: asNumber(commandLoop.selected_agent_command_exit_code),
			stopReason: asString(commandLoop.stop_reason),
			terminalAgent: asString(commandLoop.terminal_agent),
		},
		githubTransport: {
			receipt: transportReceipt,
			dryRun: asBoolean(githubTransport.dry_run),
			applied: asBoolean(githubTransport.applied),
		},
		claims: {
			proves: [
				'Installed project-watchdog cron can consume a live Tau GitHub issue and route it into one bounded Tau handoff command-loop tick.',
				'The GitHub issue route selected the non-human reviewer command spec before stopping at human.',
				'The watchdog commented receipt evidence and closed the proof issue without leaving an active queue item.',
			],
			does_not_prove: stringArray(manifest.does_not_prove),
		},
	}
}

export function normalizeTauChatHandoffTransportReceipt(receipt: unknown): JsonRecord {
	const record = asRecord(receipt)
	if (!record) throw new Error('Tau handoff transport receipt must be a JSON object')
	if (record.schema !== 'tau.handoff_github_transport_receipt.v1') {
		throw new Error('unexpected Tau handoff transport receipt schema')
	}
	if (record.ok !== true) throw new Error('Tau handoff transport receipt is not ok')
	if (record.dryRun !== true) throw new Error('Tau handoff transport receipt must be dryRun=true')
	if (record.applied !== false) throw new Error('Tau handoff transport receipt must be applied=false')
	if (record.sourceProjectionContract !== 'tau.handoff_github_projection.rendered.v1') {
		throw new Error('Tau handoff transport receipt source projection contract mismatch')
	}

	const target = asRecord(record.target)
	const goal = normalizeGoal(record.goal, 'Tau handoff transport receipt')
	const labels = asRecord(record.labels)
	const repo = asString(target?.repo)
	const targetValue = asString(target?.target)
	if (!repo || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
		throw new Error('Tau handoff transport receipt target.repo is invalid')
	}
	if (!targetValue) throw new Error('Tau handoff transport receipt target.target is required')
	const parsedTarget = parseGithubTarget(targetValue)
	if (!parsedTarget) throw new Error('Tau handoff transport receipt target is unsupported')

	const addLabels = stringArray(labels?.add)
	const removeLabels = stringArray(labels?.remove)
	if (!addLabels.includes('agent-work')) throw new Error('Tau handoff transport receipt missing agent-work label')
	if (!addLabels.some((label) => /^next:[A-Za-z0-9_.-]+$/.test(label))) {
		throw new Error('Tau handoff transport receipt missing next:<agent> label')
	}
	if (!addLabels.some((label) => /^executor:[A-Za-z0-9_.-]+$/.test(label))) {
		throw new Error('Tau handoff transport receipt missing executor:<executor> label')
	}

	const commands = stringArray(record.commands)
	const commandCount = asNumber(record.commandCount)
	if (!Number.isInteger(commandCount) || commandCount !== commands.length || commandCount < 1) {
		throw new Error('Tau handoff transport receipt commandCount does not match commands')
	}
	if (commands.some((command) => !command.includes(`--repo ${repo}`))) {
		throw new Error('Tau handoff transport receipt command repo does not match target.repo')
	}
	if (parsedTarget.kind === 'new') {
		if (commands.length !== 1 || !commands[0].startsWith('gh issue create ')) {
			throw new Error('Tau handoff transport receipt new target must create one issue command')
		}
	} else {
		const prefix = `gh ${parsedTarget.kind}`
		if (commands.length !== 2 || !commands[0].startsWith(`${prefix} comment ${parsedTarget.number} `)) {
			throw new Error('Tau handoff transport receipt existing target must start with a matching comment command')
		}
		if (!commands[1].startsWith(`${prefix} edit ${parsedTarget.number} `)) {
			throw new Error('Tau handoff transport receipt existing target must include a matching label edit command')
		}
	}

	return {
		schema: 'tau.handoff_github_transport_validation.v1',
		ok: true,
		dryRun: true,
		applied: false,
		target: { repo, target: targetValue },
		goal,
		labels: { add: addLabels, remove: removeLabels },
		commandCount,
		commands,
		checks: [
			'schema',
			'dry_run_not_applied',
			'target',
			'labels',
			'command_count',
			'command_repo',
			'command_target',
		],
	}
}

export function normalizeTauChatHandoffOrchestratorIntake(validation: unknown): JsonRecord {
	const record = asRecord(validation)
	if (!record) throw new Error('Tau handoff orchestrator intake requires a JSON object')
	if (record.schema !== 'tau.handoff_github_transport_validation.v1') {
		throw new Error('unexpected Tau handoff transport validation schema')
	}
	if (record.ok !== true) throw new Error('Tau handoff transport validation is not ok')
	if (record.dryRun !== true) throw new Error('Tau handoff orchestrator intake requires dryRun=true')
	if (record.applied !== false) throw new Error('Tau handoff orchestrator intake requires applied=false')

	const target = asRecord(record.target)
	const goal = normalizeGoal(record.goal, 'Tau handoff orchestrator intake')
	const labels = asRecord(record.labels)
	const repo = asString(target?.repo)
	const targetValue = asString(target?.target)
	if (!repo || !targetValue || !parseGithubTarget(targetValue)) {
		throw new Error('Tau handoff orchestrator intake target is invalid')
	}

	const addLabels = stringArray(labels?.add)
	const nextLabel = addLabels.find((label) => /^next:[A-Za-z0-9_.-]+$/.test(label))
	const executorLabel = addLabels.find((label) => /^executor:[A-Za-z0-9_.-]+$/.test(label))
	if (!nextLabel) throw new Error('Tau handoff orchestrator intake missing next:<agent> label')
	if (!executorLabel) throw new Error('Tau handoff orchestrator intake missing executor:<executor> label')

	const commands = stringArray(record.commands)
	const commandCount = asNumber(record.commandCount)
	if (!Number.isInteger(commandCount) || commandCount !== commands.length || commandCount < 1) {
		throw new Error('Tau handoff orchestrator intake commandCount does not match commands')
	}

	const nextAgent = nextLabel.slice('next:'.length)
	const executor = executorLabel.slice('executor:'.length)
	return {
		schema: 'tau.handoff_orchestrator_intake.v1',
		ok: true,
		dryRun: true,
		applied: false,
		accepted: true,
		target: { repo, target: targetValue },
		goal,
		nextAgent,
		executor,
		labels: {
			add: addLabels,
			remove: stringArray(labels?.remove),
		},
		commandCount,
		commands,
		routing: {
			queue: 'github-ticket',
			next_agent: nextAgent,
			executor,
			stop_condition: `${nextAgent} posts a schema-valid Tau receipt before the next route.`,
		},
		claims: {
			proves: [
				'Tau chat handoff transport validation can be normalized into a non-mutating orchestrator intake receipt.',
				'Tau can derive next agent and executor from validated labels without inventing routing.',
			],
			does_not_prove: [
				'Live GitHub mutation.',
				'Live subagent execution.',
				'Final Sparta Chat readiness.',
			],
		},
	}
}

export function normalizeTauSubagentReceiptExpectation(intake: unknown): JsonRecord {
	const record = asRecord(intake)
	if (!record) throw new Error('Tau subagent receipt expectation requires a JSON object')
	if (record.schema !== 'tau.handoff_orchestrator_intake.v1') {
		throw new Error('unexpected Tau handoff orchestrator intake schema')
	}
	if (record.ok !== true || record.accepted !== true) {
		throw new Error('Tau handoff orchestrator intake is not accepted')
	}
	if (record.dryRun !== true) throw new Error('Tau subagent receipt expectation requires dryRun=true')
	if (record.applied !== false) throw new Error('Tau subagent receipt expectation requires applied=false')

	const target = asRecord(record.target)
	const goal = normalizeGoal(record.goal, 'Tau subagent receipt expectation')
	const repo = asString(target?.repo)
	const targetValue = asString(target?.target)
	if (!repo || !targetValue || !parseGithubTarget(targetValue)) {
		throw new Error('Tau subagent receipt expectation target is invalid')
	}

	const nextAgent = asString(record.nextAgent)
	const executor = asString(record.executor) ?? 'either'
	if (!nextAgent) throw new Error('Tau subagent receipt expectation missing nextAgent')

	const labels = asRecord(record.labels)
	const addLabels = stringArray(labels?.add)
	if (!addLabels.includes(`next:${nextAgent}`)) {
		throw new Error('Tau subagent receipt expectation next label does not match nextAgent')
	}
	if (!addLabels.includes(`executor:${executor}`)) {
		throw new Error('Tau subagent receipt expectation executor label does not match executor')
	}

	const routing = asRecord(record.routing)
	const stopCondition = asString(routing?.stop_condition)
	if (!stopCondition) throw new Error('Tau subagent receipt expectation missing routing.stop_condition')

	return {
		schema: 'tau.subagent_receipt_expectation.v1',
		ok: true,
		dryRun: true,
		applied: false,
		target: { repo, target: targetValue },
		goal,
		nextAgent,
		executor,
		requiredReceipt: {
			schema: 'tau.agent_handoff.v1',
			previous_subagent: nextAgent,
			fields: [
				'schema',
				'github.repo',
				'github.target',
				'goal.goal_id',
				'goal.goal_version',
				'goal.goal_hash',
				'previous_subagent',
				'context.summary',
				'context.artifacts',
				'result.status',
				'result.summary',
				'result.evidence',
				'rationale',
				'next_agent.name',
				'next_agent.reason',
				'required_evidence',
				'stop_condition',
			],
			next_agent_required: true,
			evidence_required: true,
			goal_preservation_required: true,
			stop_condition: stopCondition,
		},
		claims: {
			proves: [
				'Tau can derive the next subagent receipt expectation from accepted dry-run orchestrator intake.',
				'Tau requires the next subagent to return tau.agent_handoff.v1 with next_agent before the loop can continue.',
			],
			does_not_prove: [
				'The next subagent actually executed.',
				'The expected receipt was posted to GitHub.',
				'Live GitHub mutation.',
			],
		},
	}
}

export async function persistTauSubagentReceiptExpectation(
	intake: unknown,
	proofRoot = TAU_SUBAGENT_EXPECTATION_PROOF_ROOT,
	now = new Date(),
): Promise<JsonRecord> {
	const receipt = normalizeTauSubagentReceiptExpectation(intake)
	const root = resolve(proofRoot)
	const nextAgent = asString(receipt.nextAgent) ?? 'unknown'
	const safeAgent = nextAgent.replace(/[^A-Za-z0-9_.-]/g, '_')
	const timestamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
	const artifactDir = resolve(root, timestamp)
	const artifactPath = resolve(artifactDir, `${safeAgent}-subagent-receipt-expectation.json`)
	if (!isPathInside(root, artifactPath)) {
		throw new Error('Tau subagent receipt expectation artifact path escapes proof root')
	}

	const persisted = {
		...receipt,
		persisted: true,
		artifactPath,
		proofRoot: root,
	}
	await mkdir(artifactDir, { recursive: true })
	await writeFile(artifactPath, `${JSON.stringify(persisted, null, 2)}\n`, 'utf8')
	return persisted
}

export function normalizeTauSubagentHandoffValidation(payload: unknown): JsonRecord {
	const record = asRecord(payload)
	if (!record) throw new Error('Tau subagent handoff validation requires a JSON object')
	const expectation = asRecord(record.expectation)
	const handoff = asRecord(record.handoff)
	if (!expectation) throw new Error('Tau subagent handoff validation missing expectation')
	if (!handoff) throw new Error('Tau subagent handoff validation missing handoff')
	if (expectation.schema !== 'tau.subagent_receipt_expectation.v1') {
		throw new Error('unexpected Tau subagent receipt expectation schema')
	}
	if (expectation.ok !== true) throw new Error('Tau subagent receipt expectation is not ok')
	if (expectation.dryRun !== true || expectation.applied !== false) {
		throw new Error('Tau subagent receipt expectation must be dryRun=true and applied=false')
	}
	if (handoff.schema !== 'tau.agent_handoff.v1') throw new Error('unexpected Tau agent handoff schema')

	const expectedTarget = asRecord(expectation.target)
	const handoffGithub = asRecord(handoff.github)
	const expectedRepo = asString(expectedTarget?.repo)
	const expectedTargetValue = asString(expectedTarget?.target)
	if (!expectedRepo || !expectedTargetValue) throw new Error('Tau expectation target is missing')
	if (asString(handoffGithub?.repo) !== expectedRepo) {
		throw new Error('Tau subagent handoff repo does not match expectation')
	}
	if (asString(handoffGithub?.target) !== expectedTargetValue) {
		throw new Error('Tau subagent handoff target does not match expectation')
	}

	const requiredReceipt = asRecord(expectation.requiredReceipt)
	const expectedPrevious = asString(requiredReceipt?.previous_subagent)
	if (!expectedPrevious) throw new Error('Tau expectation missing required previous_subagent')
	if (asString(handoff.previous_subagent) !== expectedPrevious) {
		throw new Error('Tau subagent handoff previous_subagent does not match expectation')
	}

	const context = asRecord(handoff.context)
	const result = asRecord(handoff.result)
	const expectationGoal = normalizeGoal(expectation.goal, 'Tau subagent receipt expectation')
	const goal = normalizeGoal(handoff.goal, 'Tau subagent handoff')
	if (!goalsMatch(goal, expectationGoal)) {
		throw new Error('Tau subagent handoff goal does not match expectation')
	}
	const nextAgent = asRecord(handoff.next_agent)
	const requiredEvidence = stringArray(handoff.required_evidence)
	const resultEvidence = stringArray(result?.evidence)
	const fields = stringArray(requiredReceipt?.fields)
	const missingFields: string[] = []
	const requireField = (field: string, ok: boolean) => {
		if (fields.includes(field) && !ok) missingFields.push(field)
	}
	requireField('github.repo', Boolean(asString(handoffGithub?.repo)))
	requireField('github.target', Boolean(asString(handoffGithub?.target)))
	requireField('goal.goal_id', Boolean(asString(goal?.goal_id)))
	requireField('goal.goal_version', typeof goal?.goal_version === 'number' && Number.isInteger(goal.goal_version))
	requireField('goal.goal_hash', Boolean(asString(goal?.goal_hash)))
	requireField('context.summary', Boolean(asString(context?.summary)))
	requireField('context.artifacts', Array.isArray(context?.artifacts))
	requireField('result.status', Boolean(asString(result?.status)))
	requireField('result.summary', Boolean(asString(result?.summary)))
	requireField('result.evidence', Array.isArray(result?.evidence))
	requireField('rationale', Boolean(asString(handoff.rationale)))
	requireField('next_agent.name', Boolean(asString(nextAgent?.name)))
	requireField('next_agent.reason', Boolean(asString(nextAgent?.reason)))
	requireField('required_evidence', Array.isArray(handoff.required_evidence))
	requireField('stop_condition', Boolean(asString(handoff.stop_condition)))
	if (missingFields.length) {
		throw new Error(`Tau subagent handoff missing required fields: ${missingFields.join(', ')}`)
	}
	if (requiredReceipt?.next_agent_required === true && !asString(nextAgent?.name)) {
		throw new Error('Tau subagent handoff missing next_agent.name')
	}
	if (requiredReceipt?.evidence_required === true && resultEvidence.length < 1) {
		throw new Error('Tau subagent handoff missing result.evidence')
	}

	return {
		schema: 'tau.subagent_handoff_validation.v1',
		ok: true,
		dryRun: true,
		applied: false,
		executed: false,
		candidateOnly: true,
		target: {
			repo: expectedRepo,
			target: expectedTargetValue,
		},
		previousSubagent: expectedPrevious,
		nextAgent: asString(nextAgent?.name),
		resultStatus: asString(result?.status),
		goal,
		resultEvidenceCount: resultEvidence.length,
		requiredEvidenceCount: requiredEvidence.length,
		expectationArtifactPath: asString(expectation.artifactPath),
		checks: [
			'expectation_schema',
			'handoff_schema',
			'target_match',
			'previous_subagent_match',
			'goal_preserved',
			'required_fields',
			'next_agent_present',
			'evidence_present',
		],
		claims: {
			proves: [
				'Tau can validate a candidate next-subagent tau.agent_handoff.v1 against the persisted receipt expectation.',
				'Tau refuses to advance the loop unless the candidate receipt includes required routing and evidence fields.',
				'Tau refuses candidate subagent receipts that change the accepted goal metadata.',
			],
			does_not_prove: [
				'The next subagent actually executed.',
				'The candidate receipt was posted to GitHub.',
				'Live GitHub mutation.',
			],
		},
	}
}

export function normalizeTauExternalSubagentReceiptIntake(payload: unknown): JsonRecord {
	const record = asRecord(payload)
	if (!record) throw new Error('Tau external subagent receipt intake requires a JSON object')
	const validation = normalizeTauSubagentHandoffValidation({
		expectation: record.expectation,
		handoff: record.receipt,
	})
	const receipt = asRecord(record.receipt)
	if (!receipt) throw new Error('Tau external subagent receipt intake missing receipt')
	const result = asRecord(receipt.result)
	const nextAgent = asRecord(receipt.next_agent)
	const externalReceiptId = asString(record.externalReceiptId) ?? asString(record.receipt_id) ?? null
	return {
		schema: 'tau.external_subagent_receipt_intake.v1',
		ok: true,
		dryRun: true,
		applied: false,
		accepted: true,
		externalReceipt: true,
		executed: false,
		target: validation.target,
		goal: validation.goal,
		previousSubagent: validation.previousSubagent,
		nextAgent: validation.nextAgent,
		resultStatus: asString(result?.status),
		resultEvidenceCount: validation.resultEvidenceCount,
		requiredEvidenceCount: validation.requiredEvidenceCount,
		externalReceiptId,
		nextRoute: {
			subagent: asString(nextAgent?.name),
			executor: asString(nextAgent?.executor) ?? 'either',
			reason: asString(nextAgent?.reason),
		},
		sourceValidation: validation,
		checks: [
			'expectation_schema',
			'receipt_schema',
			'target_match',
			'previous_subagent_match',
			'goal_preserved',
			'required_fields',
			'next_agent_present',
			'evidence_present',
			'external_receipt_accepted',
		],
		claims: {
			proves: [
				'Tau can ingest an externally supplied tau.agent_handoff.v1 receipt against the persisted expectation.',
				'Tau preserves the accepted goal metadata while accepting the external receipt into the dry-run harness.',
				'Tau derives the next route from the accepted external receipt instead of inventing routing.',
			],
			does_not_prove: [
				'The external subagent actually executed in this browser proof.',
				'The external receipt was posted to GitHub.',
				'Live GitHub mutation.',
			],
		},
	}
}

export function normalizeTauExternalSubagentGithubProjection(payload: unknown): JsonRecord {
	const record = asRecord(payload)
	if (!record) throw new Error('Tau external subagent GitHub projection requires a JSON object')
	const intake = asRecord(record.intake)
	const receipt = asRecord(record.receipt)
	if (!intake) throw new Error('Tau external subagent GitHub projection missing intake')
	if (!receipt) throw new Error('Tau external subagent GitHub projection missing receipt')
	if (intake.schema !== 'tau.external_subagent_receipt_intake.v1') {
		throw new Error('unexpected Tau external subagent receipt intake schema')
	}
	if (intake.ok !== true || intake.accepted !== true) {
		throw new Error('Tau external subagent receipt intake is not accepted')
	}
	if (intake.dryRun !== true || intake.applied !== false) {
		throw new Error('Tau external subagent GitHub projection requires dryRun=true and applied=false')
	}
	if (intake.executed !== false || intake.externalReceipt !== true) {
		throw new Error('Tau external subagent GitHub projection requires external receipt intake without local execution')
	}
	if (receipt.schema !== 'tau.agent_handoff.v1') throw new Error('unexpected Tau agent handoff schema')

	const intakeTarget = asRecord(intake.target)
	const receiptGithub = asRecord(receipt.github)
	const repo = asString(intakeTarget?.repo)
	const targetValue = asString(intakeTarget?.target)
	if (!repo || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
		throw new Error('Tau external subagent GitHub projection target.repo is invalid')
	}
	if (!targetValue) throw new Error('Tau external subagent GitHub projection target.target is required')
	const parsedTarget = parseGithubTarget(targetValue)
	if (!parsedTarget) throw new Error('Tau external subagent GitHub projection target is unsupported')
	if (asString(receiptGithub?.repo) !== repo || asString(receiptGithub?.target) !== targetValue) {
		throw new Error('Tau external subagent GitHub projection receipt target does not match intake')
	}

	const intakeGoal = normalizeGoal(intake.goal, 'Tau external subagent receipt intake')
	const receiptGoal = normalizeGoal(receipt.goal, 'Tau external subagent receipt')
	if (!goalsMatch(receiptGoal, intakeGoal)) {
		throw new Error('Tau external subagent GitHub projection receipt goal does not match intake')
	}

	const previousSubagent = asString(receipt.previous_subagent)
	const intakePrevious = asString(intake.previousSubagent)
	if (!previousSubagent || previousSubagent !== intakePrevious) {
		throw new Error('Tau external subagent GitHub projection previous_subagent does not match intake')
	}
	const nextAgent = asRecord(receipt.next_agent)
	const nextName = asString(nextAgent?.name)
	const executor = asString(nextAgent?.executor) ?? 'either'
	const reason = asString(nextAgent?.reason)
	if (!nextName || !reason) {
		throw new Error('Tau external subagent GitHub projection receipt missing next_agent routing')
	}
	if (asString(intake.nextAgent) !== nextName) {
		throw new Error('Tau external subagent GitHub projection next_agent does not match intake')
	}
	for (const label of [`next:${nextName}`, `executor:${executor}`, `next:${previousSubagent}`]) {
		if (!isGithubLabel(label)) throw new Error(`Tau external subagent GitHub projection has unsafe label: ${label}`)
	}

	const addLabels = ['agent-work', `next:${nextName}`, `executor:${executor}`]
	const removeLabels = ['agent-active', 'agent-blocked', `next:${previousSubagent}`]
	const commentBody = renderExternalSubagentReceiptComment(receipt)
	const labelCsv = addLabels.join(',')
	const removeLabelCsv = removeLabels.join(',')
	const commands =
		parsedTarget.kind === 'new'
			? [
					`gh issue create --repo ${repo} --title "Tau external subagent receipt: ${previousSubagent} to ${nextName}" --body-file - --label ${labelCsv}`,
				]
			: [
					`gh ${parsedTarget.kind} comment ${parsedTarget.number} --repo ${repo} --body-file -`,
					`gh ${parsedTarget.kind} edit ${parsedTarget.number} --repo ${repo} --add-label ${labelCsv} --remove-label ${removeLabelCsv}`,
				]

	return {
		schema: 'tau.external_subagent_github_projection.v1',
		ok: true,
		dryRun: true,
		applied: false,
		mutation: 'not_applied',
		target: { repo, target: targetValue },
		goal: intakeGoal,
		previousSubagent,
		nextAgent: nextName,
		executor,
		resultStatus: asString(asRecord(receipt.result)?.status),
		labels: {
			add: addLabels,
			remove: removeLabels,
		},
		comment: {
			body: commentBody,
			body_format: 'github-markdown',
			body_marker: '<!-- tau-agent-handoff:v1 -->',
			body_embeds_handoff_json: commentBody.includes('"schema": "tau.agent_handoff.v1"'),
		},
		commandCount: commands.length,
		commands,
		sourceIntake: {
			schema: intake.schema,
			accepted: intake.accepted,
			externalReceipt: intake.externalReceipt,
			executed: intake.executed,
			externalReceiptId: intake.externalReceiptId ?? null,
		},
		checks: [
			'intake_schema',
			'intake_accepted',
			'receipt_schema',
			'target_match',
			'goal_preserved',
			'previous_subagent_match',
			'next_agent_present',
			'labels_derived',
			'comment_embeds_receipt_json',
			'dry_run_not_applied',
		],
		claims: {
			proves: [
				'Tau can project an accepted external tau.agent_handoff.v1 receipt into a deterministic GitHub comment and label plan.',
				'Tau derives next labels from the accepted external receipt instead of inventing routing.',
				'Tau preserves dryRun=true and applied=false while preparing the GitHub projection.',
			],
			does_not_prove: [
				'The external subagent actually executed in this browser proof.',
				'The external receipt was posted to GitHub.',
				'Live GitHub mutation.',
			],
		},
	}
}

export function registerTauRoutes(app: Express): void {
	app.get('/api/tau/chat/ux-contract', async (_req: Request, res: Response) => {
		try {
			const receipt = await normalizeTauChatUxContract()
			res.json({ ok: true, receipt })
		} catch (error) {
			res.status(404).json({
				ok: false,
				error: 'tau_chat_ux_contract_unavailable',
				detail: error instanceof Error ? error.message : String(error),
				contractPath: TAU_CHAT_UX_CONTRACT_PATH,
			})
		}
	})

	app.get('/api/tau/command-loop/github-projection', async (_req: Request, res: Response) => {
		try {
			const receipt = await normalizeTauCommandLoopProjection(TAU_COMMAND_LOOP_SUMMARY_PATH)
			res.json({ ok: true, receipt })
		} catch (error) {
			res.status(404).json({
				ok: false,
				error: 'tau_command_loop_projection_unavailable',
				detail: error instanceof Error ? error.message : String(error),
				summaryPath: TAU_COMMAND_LOOP_SUMMARY_PATH,
				proofRoot: TAU_COMMAND_LOOP_PROOF_ROOT,
			})
		}
	})

	app.get('/api/tau/memory/routes/failclosed-proof', async (_req: Request, res: Response) => {
		try {
			const receipt = await normalizeTauMemoryRouteProof(TAU_MEMORY_ROUTE_PROOF_MANIFEST)
			res.json({ ok: true, receipt })
		} catch (error) {
			res.status(404).json({
				ok: false,
				error: 'tau_memory_route_failclosed_proof_unavailable',
				detail: error instanceof Error ? error.message : String(error),
				manifestPath: TAU_MEMORY_ROUTE_PROOF_MANIFEST,
				proofRoot: TAU_MEMORY_ROUTE_PROOF_ROOT,
			})
		}
	})

	app.get('/api/tau/watchdog/receipt-chain', async (_req: Request, res: Response) => {
		try {
			const receipt = await normalizeTauWatchdogReceiptChain(TAU_WATCHDOG_RECEIPT_CHAIN_MANIFEST)
			res.json({ ok: true, receipt })
		} catch (error) {
			res.status(404).json({
				ok: false,
				error: 'tau_watchdog_receipt_chain_unavailable',
				detail: error instanceof Error ? error.message : String(error),
				manifestPath: TAU_WATCHDOG_RECEIPT_CHAIN_MANIFEST,
				proofRoot: TAU_WATCHDOG_RECEIPT_CHAIN_PROOF_ROOT,
			})
		}
	})

	app.get('/api/tau/tui/receipt-stream', async (_req: Request, res: Response) => {
		try {
			const receipt = await normalizeTauTuiReceiptStream(TAU_TUI_RECEIPT_STREAM_RUN_DIR)
			res.json({ ok: true, receipt })
		} catch (error) {
			res.status(404).json({
				ok: false,
				error: 'tau_tui_receipt_stream_unavailable',
				detail: error instanceof Error ? error.message : String(error),
				runDir: TAU_TUI_RECEIPT_STREAM_RUN_DIR,
			})
		}
	})

	app.get('/api/tau/tui/textual-proof', async (_req: Request, res: Response) => {
		try {
			const receipt = await normalizeTauTextualTuiProof(TAU_TEXTUAL_TUI_PROOF_MANIFEST)
			res.json({ ok: true, receipt })
		} catch (error) {
			res.status(404).json({
				ok: false,
				error: 'tau_textual_tui_proof_unavailable',
				detail: error instanceof Error ? error.message : String(error),
				manifestPath: TAU_TEXTUAL_TUI_PROOF_MANIFEST,
				proofRoot: TAU_TEXTUAL_TUI_PROOF_ROOT,
			})
		}
	})

	app.get('/api/tau/tui/textual-proof/screenshot', async (_req: Request, res: Response) => {
		try {
			const screenshot = await resolveTauTextualTuiProofScreenshot(TAU_TEXTUAL_TUI_PROOF_MANIFEST)
			res.type(screenshot.contentType).sendFile(screenshot.path)
		} catch (error) {
			res.status(404).json({
				ok: false,
				error: 'tau_textual_tui_proof_screenshot_unavailable',
				detail: error instanceof Error ? error.message : String(error),
				manifestPath: TAU_TEXTUAL_TUI_PROOF_MANIFEST,
				proofRoot: TAU_TEXTUAL_TUI_PROOF_ROOT,
			})
		}
	})

	app.get('/api/tau/personaplex/embry-receipt', async (_req: Request, res: Response) => {
		try {
			const receipt = await normalizeTauPersonaplexEmbryReceipt(
				TAU_PERSONAPLEX_EMBRY_RECEIPT_PATH,
				TAU_PERSONAPLEX_EMBRY_METADATA_RECEIPT_PATH,
			)
			res.json({ ok: receipt.available !== false, receipt })
		} catch (error) {
			res.status(400).json({
				ok: false,
				error: 'tau_personaplex_embry_receipt_invalid',
				detail: error instanceof Error ? error.message : String(error),
				receiptPath: TAU_PERSONAPLEX_EMBRY_RECEIPT_PATH,
				metadataReceiptPath: TAU_PERSONAPLEX_EMBRY_METADATA_RECEIPT_PATH,
			})
		}
	})

	app.post('/api/tau/annotations', async (req: Request, res: Response) => {
		try {
			const receipt = await persistTauWatchAnnotationReceipt(req.body)
			res.json({ ok: true, receipt })
		} catch (error) {
			res.status(400).json({
				ok: false,
				error: 'tau_annotation_receipt_invalid',
				detail: error instanceof Error ? error.message : String(error),
				receiptRoot: TAU_ANNOTATION_RECEIPT_ROOT,
			})
		}
	})

	app.post('/api/tau/handoff/transport/validate', (req: Request, res: Response) => {
		try {
			const receipt = normalizeTauChatHandoffTransportReceipt(req.body)
			res.json({ ok: true, receipt })
		} catch (error) {
			res.status(400).json({
				ok: false,
				error: 'tau_handoff_transport_receipt_invalid',
				detail: error instanceof Error ? error.message : String(error),
			})
		}
	})

	app.post('/api/tau/handoff/orchestrator/intake', (req: Request, res: Response) => {
		try {
			const receipt = normalizeTauChatHandoffOrchestratorIntake(req.body)
			res.json({ ok: true, receipt })
		} catch (error) {
			res.status(400).json({
				ok: false,
				error: 'tau_handoff_orchestrator_intake_invalid',
				detail: error instanceof Error ? error.message : String(error),
			})
		}
	})

	app.post('/api/tau/handoff/subagent-receipt/expectation', async (req: Request, res: Response) => {
		try {
			const receipt = await persistTauSubagentReceiptExpectation(req.body)
			res.json({ ok: true, receipt })
		} catch (error) {
			res.status(400).json({
				ok: false,
				error: 'tau_subagent_receipt_expectation_invalid',
				detail: error instanceof Error ? error.message : String(error),
			})
		}
	})

	app.post('/api/tau/handoff/subagent-receipt/validate', (req: Request, res: Response) => {
		try {
			const receipt = normalizeTauSubagentHandoffValidation(req.body)
			res.json({ ok: true, receipt })
		} catch (error) {
			res.status(400).json({
				ok: false,
				error: 'tau_subagent_handoff_validation_invalid',
				detail: error instanceof Error ? error.message : String(error),
			})
		}
	})

	app.post('/api/tau/handoff/subagent-receipt/intake', (req: Request, res: Response) => {
		try {
			const receipt = normalizeTauExternalSubagentReceiptIntake(req.body)
			res.json({ ok: true, receipt })
		} catch (error) {
			res.status(400).json({
				ok: false,
				error: 'tau_external_subagent_receipt_intake_invalid',
				detail: error instanceof Error ? error.message : String(error),
			})
		}
	})

	app.post('/api/tau/handoff/subagent-receipt/github-projection', (req: Request, res: Response) => {
		try {
			const receipt = normalizeTauExternalSubagentGithubProjection(req.body)
			res.json({ ok: true, receipt })
		} catch (error) {
			res.status(400).json({
				ok: false,
				error: 'tau_external_subagent_github_projection_invalid',
				detail: error instanceof Error ? error.message : String(error),
			})
		}
	})
}
