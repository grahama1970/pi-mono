import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { resolve } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import {
	normalizeTauChatHandoffOrchestratorIntake,
	normalizeTauChatHandoffTransportReceipt,
	normalizeTauChatUxContract,
	normalizeTauCommandLoopProjection,
	normalizeTauExternalSubagentGithubProjection,
	normalizeTauExternalSubagentReceiptIntake,
	normalizeTauMemoryRouteProof,
	normalizeTauWatchdogReceiptChain,
	normalizeTauSubagentHandoffValidation,
	normalizeTauSubagentReceiptExpectation,
	persistTauSubagentReceiptExpectation,
} from './tauRoutes'

const roots: string[] = []
const ACTIVE_GOAL = {
	goal_id: 'goal-tau-chat-hardening',
	goal_version: 1,
	goal_hash: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
}

async function makeRoot(): Promise<string> {
	const root = await mkdtemp(resolve(tmpdir(), 'tau-route-test-'))
	roots.push(root)
	return root
}

async function writeJson(path: string, payload: unknown): Promise<void> {
	await mkdir(resolve(path, '..'), { recursive: true })
	await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
}

function validSummary(root: string) {
	return {
		schema: 'tau.command_loop_explicit_ticket_source_summary.v1',
		mocked: false,
		live: true,
		reconciliation: {
			source: resolve(root, 'ticket-source.json'),
			status: 'classified',
			counts: { close: 0, keep: 1, migrate: 3, regenerate: 0 },
		},
		github_transport: {
			ok: true,
			dry_run: true,
			applied: false,
			source_loop_receipt_path: resolve(root, 'command-loop/command-loop-receipt.json'),
			reconciliation_receipt_path: resolve(
				root,
				'command-loop/command-artifacts/command-loop-step-001/goal-guardian-reconciliation-receipt.json',
			),
			ticket_source_path: resolve(root, 'ticket-source.json'),
			command_count: 2,
			commands: [
				['gh', 'issue', 'comment', '123', '--repo', 'grahama1970/chatgpt-lab', '--body-file', '-'],
				[
					'gh',
					'issue',
					'edit',
					'123',
					'--repo',
					'grahama1970/chatgpt-lab',
					'--add-label',
					'agent-work,next:human,executor:human,goal-change',
					'--remove-label',
					'next:goal-guardian,agent-active',
				],
			],
		},
	}
}

function validMemoryRouteManifest(root: string) {
	const receipt = (name: string) => `proof/${name}.json`
	return {
		schema: 'tau.live_memory_route_failclosed_proof.v1',
		ok: true,
		mocked: false,
		live: true,
		created_utc: '2026-06-28T14:00:48Z',
		proof_scope: 'Fresh live Memory service route products plus fail-closed RESEARCH-disabled branch after adapter hardening.',
		route_count: 5,
		claims: {
			proves: ['CLARIFY and DEFLECT live route products still pass through Memory-first harness receipts.'],
			does_not_prove: ['Selector-selected ANSWER route for the natural-language answer probes.'],
		},
		routes: [
			{
				route: 'CLARIFY',
				query: 'What does it mean?',
				selected_skill: 'memory.clarify',
				intent_action: 'QUERY',
				branch_schema: 'tau.loop2_memory_clarify_branch.v1',
				branch_status: 'PASS',
				fail_closed: false,
				live: true,
				mocked: false,
				memory_product_schema: 'memory.clarify.v1',
				current_stage: { stage: 'clarify', label: 'Clarifying...', status: 'PASS', source: 'memory.clarify' },
				receipt: receipt('clarify-harness-receipt'),
				selection_reasons: ['unresolved_or_missing_entities'],
				validation_errors: [],
			},
			{
				route: 'DEFLECT',
				query: "tell me today's weather in Tokyo",
				selected_skill: 'memory.deflect',
				intent_action: 'NO_MATCH',
				branch_schema: 'tau.loop2_memory_deflect_branch.v1',
				branch_status: 'PASS',
				fail_closed: false,
				live: true,
				mocked: false,
				memory_product_schema: 'memory.deflect.v1',
				current_stage: {
					stage: 'personaplex',
					label: 'Preparing Persona Voice...',
					status: 'REQUESTED_NO_PERSONAPLEX_RECEIPT',
					source: 'personaplex',
				},
				receipt: receipt('deflect-harness-receipt'),
				selection_reasons: ['memory_intent_no_match'],
				validation_errors: [],
			},
			{
				route: 'ANSWER_SELECTOR_ATTEMPT',
				query: 'What is Tau project knowledge?',
				selected_skill: 'memory.clarify',
				intent_action: 'QUERY',
				branch_schema: 'tau.loop2_memory_clarify_branch.v1',
				branch_status: 'PASS',
				fail_closed: false,
				live: true,
				mocked: false,
				memory_product_schema: 'memory.clarify.v1',
				current_stage: { stage: 'clarify', label: 'Clarifying...', status: 'PASS', source: 'memory.clarify' },
				receipt: receipt('answer-harness-receipt'),
				selection_reasons: ['unresolved_or_missing_entities'],
				validation_errors: [],
			},
			{
				route: 'ANSWER_DIRECT_PRODUCT',
				query: 'What does memory know about Tau project watchdog apply transport proof?',
				selected_skill: null,
				intent_action: null,
				branch_schema: 'tau.loop2_memory_answer_branch.v1',
				branch_status: 'PASS',
				fail_closed: false,
				live: true,
				mocked: false,
				memory_product_schema: 'memory.answer.v1',
				current_stage: null,
				receipt: receipt('answer-direct-memory-product'),
				selection_reasons: null,
				validation_errors: [],
			},
			{
				route: 'RESEARCH_BRAVE_DISABLED',
				query: 'Find current Tau harness research sources',
				selected_skill: 'brave-search',
				intent_action: 'RESEARCH',
				branch_schema: 'tau.loop2_brave_search.v1',
				branch_status: 'FAILED',
				fail_closed: true,
				live: true,
				mocked: false,
				memory_product_schema: null,
				current_stage: { stage: 'brave_search', label: 'Searching Web...', status: 'FAILED', source: 'brave-search' },
				receipt: receipt('research-disabled-harness-receipt'),
				selection_reasons: ['memory_intent_research'],
				validation_errors: null,
			},
		],
		_test_root: root,
	}
}

async function writeValidWatchdogProof(root: string) {
	const proofRoot = resolve(root, 'watchdog-proof')
	await mkdir(proofRoot, { recursive: true })
	const paths = {
		manifest: resolve(proofRoot, 'manifest.json'),
		watchdogReceipt: resolve(proofRoot, 'watchdog-receipt.json'),
		commandLoopReceipt: resolve(proofRoot, 'command-loop-receipt.json'),
		commandLoopStepReceipt: resolve(proofRoot, 'command-loop-step-001.receipt.json'),
		githubTransport: resolve(proofRoot, 'github-transport.json'),
		issueFinal: resolve(proofRoot, 'github-issue-15-final.json'),
		issueBody: resolve(proofRoot, 'issue-body.md'),
		issueCreateStdout: resolve(proofRoot, 'github-issue-create.stdout.txt'),
	}
	await writeJson(paths.watchdogReceipt, {
		schema: 'agent_skills.project_watchdog.tick_receipt.v1',
		ok: true,
		status: 'COMPLETED',
		run_id: 'project-watchdog-20260628T143801Z',
		handled_count: 1,
		errors: [],
	})
	await writeJson(paths.commandLoopReceipt, {
		schema: 'tau.agent_handoff_command_loop_receipt.v1',
		ok: true,
		mocked: false,
		live: true,
		status: 'WAITING',
		step_count: 1,
		stop_reason: 'next_agent_is_human',
		terminal_agent: 'human',
		dispatches: [],
		errors: [],
	})
	await writeJson(paths.commandLoopStepReceipt, {
		schema: 'tau.agent_handoff_dispatch_receipt.v1',
		ok: true,
		mocked: false,
		live: true,
		selected_agent: 'reviewer',
		status: 'COMPLETED',
	})
	await writeJson(paths.githubTransport, {
		schema: 'tau.github_command_loop_terminal_transport_receipt.v1',
		ok: true,
		dry_run: true,
		applied: false,
		target: { repo: 'grahama1970/tau', target: 'new' },
	})
	await writeFile(paths.issueBody, 'project-watchdog-action:tau-handoff-dispatch start=proof/start.json\n', 'utf8')
	await writeFile(paths.issueCreateStdout, 'https://github.com/grahama1970/tau/issues/15\n', 'utf8')
	await writeJson(paths.issueFinal, {
		number: 15,
		title: 'Tau watchdog proof: fresh compliance UI handoff',
		state: 'CLOSED',
		url: 'https://github.com/grahama1970/tau/issues/15',
		labels: [{ name: 'agent-work' }, { name: 'agent-done' }],
		comments: [{ body: 'lease' }, { body: 'evidence' }],
	})
	const manifest = {
		schema: 'tau.project_watchdog_fresh_compliance_ui_handoff_proof.v1',
		ok: true,
		mocked: false,
		live: true,
		scope: 'Installed project-watchdog cron consumed a live Tau GitHub issue.',
		does_not_prove: ['Final Sparta Chat readiness.'],
		github_issue: {
			created_body: 'issue-body.md',
			created_stdout: 'github-issue-create.stdout.txt',
			final: 'github-issue-15-final.json',
			number: 15,
			url: 'https://github.com/grahama1970/tau/issues/15',
			title: 'Tau watchdog proof: fresh compliance UI handoff',
			created_labels: ['agent-work', 'executor:local', 'next:reviewer'],
			final_labels: ['agent-work', 'agent-done'],
			final_state: 'CLOSED',
			closed_at: '2026-06-28T14:38:07Z',
			comment_count: 2,
		},
		watchdog: {
			run_id: 'project-watchdog-20260628T143801Z',
			receipt: 'watchdog-receipt.json',
			schema: 'agent_skills.project_watchdog.tick_receipt.v1',
			ok: true,
			status: 'COMPLETED',
			handled_count: 1,
			lease_comment_seen: true,
			evidence_comment_seen: true,
		},
		watchdog_inputs: {
			action: 'tau_handoff_dispatch',
			start: 'experiments/goal-locked-subagents/proofs/fresh-compliance-ui-handoff-command-loop-20260628T142600Z/start-handoff.json',
			max_steps: 1,
			active_goal_hash: ACTIVE_GOAL.goal_hash,
			apply_transport: false,
			issue: 'issue#15',
		},
		command_loop: {
			receipt: 'command-loop-receipt.json',
			step_receipt: 'command-loop-step-001.receipt.json',
			schema: 'tau.agent_handoff_command_loop_receipt.v1',
			ok: true,
			mocked: false,
			live: true,
			step_count: 1,
			selected_agent: 'reviewer',
			selected_agent_command_exit_code: 0,
			selected_agent_timed_out: false,
			status: 'WAITING',
			stop_reason: 'next_agent_is_human',
			terminal_agent: 'human',
		},
		github_transport: {
			receipt: 'github-transport.json',
			schema: 'tau.github_command_loop_terminal_transport_receipt.v1',
			ok: true,
			dry_run: true,
			applied: false,
			target: { repo: 'grahama1970/tau', target: 'new' },
		},
	}
	await writeJson(paths.manifest, manifest)
	return { proofRoot, manifestPath: paths.manifest, manifest }
}

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('normalizeTauCommandLoopProjection', () => {
	it('normalizes a Tau command-loop summary into UI receipt fields', async () => {
		const root = await makeRoot()
		const summaryPath = resolve(root, 'summary.json')
		await writeJson(summaryPath, validSummary(root))

		const receipt = await normalizeTauCommandLoopProjection(summaryPath, root)

		expect(receipt).toMatchObject({
			schema: 'tau.command_loop_explicit_ticket_source_summary.v1',
			summaryPath,
			sourceLoopReceiptPath: resolve(root, 'command-loop/command-loop-receipt.json'),
			ticketSourcePath: resolve(root, 'ticket-source.json'),
			transportReceiptPath: resolve(root, 'command-loop-reconciliation-github-transport.json'),
			dryRun: true,
			applied: false,
			mocked: false,
			live: true,
			commandCount: 2,
			reconciliationCounts: { keep: 1, close: 0, migrate: 3, regenerate: 0 },
			commands: [
				'gh issue comment 123 --repo grahama1970/chatgpt-lab --body-file -',
				'gh issue edit 123 --repo grahama1970/chatgpt-lab --add-label agent-work,next:human,executor:human,goal-change --remove-label next:goal-guardian,agent-active',
			],
		})
	})

	it('fails closed when the summary path is outside the configured proof root', async () => {
		const root = await makeRoot()
		const outside = resolve(root, '..', 'outside-summary.json')
		await expect(normalizeTauCommandLoopProjection(outside, root)).rejects.toThrow(
			'summary path escapes Tau command-loop proof root',
		)
	})

	it('fails closed on unexpected schema', async () => {
		const root = await makeRoot()
		const summaryPath = resolve(root, 'summary.json')
		await writeJson(summaryPath, { ...validSummary(root), schema: 'wrong.schema' })

		await expect(normalizeTauCommandLoopProjection(summaryPath, root)).rejects.toThrow(
			'unexpected Tau command-loop summary schema',
		)
	})

	it('fails closed when a projected receipt path escapes the proof root', async () => {
		const root = await makeRoot()
		const summaryPath = resolve(root, 'summary.json')
		const payload = validSummary(root)
		payload.github_transport.ticket_source_path = resolve(root, '..', 'ticket-source.json')
		await writeJson(summaryPath, payload)

		await expect(normalizeTauCommandLoopProjection(summaryPath, root)).rejects.toThrow(
			'Tau command-loop projection path escapes proof root',
		)
	})
})

describe('normalizeTauMemoryRouteProof', () => {
	it('normalizes a live Tau Memory route fail-closed proof for the chat view', async () => {
		const root = await makeRoot()
		const manifestPath = resolve(root, 'manifest.json')
		await writeJson(manifestPath, validMemoryRouteManifest(root))

		const receipt = await normalizeTauMemoryRouteProof(manifestPath, root)

		expect(receipt).toMatchObject({
			schema: 'tau.memory_route_failclosed_view.v1',
			ok: true,
			manifestPath,
			proofRoot: root,
			sourceSchema: 'tau.live_memory_route_failclosed_proof.v1',
			mocked: false,
			live: true,
			routeCount: 5,
			proofScope: 'Fresh live Memory service route products plus fail-closed RESEARCH-disabled branch after adapter hardening.',
			routes: [
				{
					route: 'CLARIFY',
					branchStatus: 'PASS',
					failClosed: false,
					selectedSkill: 'memory.clarify',
					memoryProductSchema: 'memory.clarify.v1',
					currentStage: { stage: 'clarify', label: 'Clarifying...', status: 'PASS' },
					receiptPath: resolve(root, 'proof/clarify-harness-receipt.json'),
				},
				{
					route: 'DEFLECT',
					branchStatus: 'PASS',
					failClosed: false,
					selectedSkill: 'memory.deflect',
					memoryProductSchema: 'memory.deflect.v1',
				},
				{
					route: 'ANSWER_SELECTOR_ATTEMPT',
					branchStatus: 'PASS',
					failClosed: false,
					selectedSkill: 'memory.clarify',
					memoryProductSchema: 'memory.clarify.v1',
				},
				{
					route: 'ANSWER_DIRECT_PRODUCT',
					branchStatus: 'PASS',
					failClosed: false,
					memoryProductSchema: 'memory.answer.v1',
				},
				{
					route: 'RESEARCH_BRAVE_DISABLED',
					branchStatus: 'FAILED',
					failClosed: true,
					selectedSkill: 'brave-search',
					currentStage: { stage: 'brave_search', status: 'FAILED' },
				},
			],
			claims: {
				does_not_prove: ['Selector-selected ANSWER route for the natural-language answer probes.'],
			},
		})
	})

	it('fails closed when the route proof is mocked', async () => {
		const root = await makeRoot()
		const manifestPath = resolve(root, 'manifest.json')
		const payload = validMemoryRouteManifest(root)
		payload.mocked = true
		await writeJson(manifestPath, payload)

		await expect(normalizeTauMemoryRouteProof(manifestPath, root)).rejects.toThrow(
			'Tau Memory route proof manifest must be mocked=false',
		)
	})

	it('fails closed when a required route is absent', async () => {
		const root = await makeRoot()
		const manifestPath = resolve(root, 'manifest.json')
		const payload = validMemoryRouteManifest(root)
		payload.routes = payload.routes.filter((route) => route.route !== 'DEFLECT')
		payload.route_count = payload.routes.length
		await writeJson(manifestPath, payload)

		await expect(normalizeTauMemoryRouteProof(manifestPath, root)).rejects.toThrow(
			'Tau Memory route proof missing route DEFLECT',
		)
	})

	it('fails closed when RESEARCH does not preserve the Brave-disabled failure boundary', async () => {
		const root = await makeRoot()
		const manifestPath = resolve(root, 'manifest.json')
		const payload = validMemoryRouteManifest(root)
		const route = payload.routes.find((item) => item.route === 'RESEARCH_BRAVE_DISABLED')
		if (route) route.branch_status = 'PASS'
		await writeJson(manifestPath, payload)

		await expect(normalizeTauMemoryRouteProof(manifestPath, root)).rejects.toThrow(
			'Tau Memory route proof must show RESEARCH_BRAVE_DISABLED failed closed',
		)
	})

	it('fails closed when the ANSWER selector limitation is erased', async () => {
		const root = await makeRoot()
		const manifestPath = resolve(root, 'manifest.json')
		const payload = validMemoryRouteManifest(root)
		const route = payload.routes.find((item) => item.route === 'ANSWER_SELECTOR_ATTEMPT')
		if (route) route.selected_skill = 'memory.answer'
		await writeJson(manifestPath, payload)

		await expect(normalizeTauMemoryRouteProof(manifestPath, root)).rejects.toThrow(
			'Tau Memory route proof must preserve ANSWER selector limitation',
		)
	})
})

describe('normalizeTauWatchdogReceiptChain', () => {
	it('normalizes a live watchdog receipt chain for the Tau chat view', async () => {
		const root = await makeRoot()
		const { proofRoot, manifestPath } = await writeValidWatchdogProof(root)

		const receipt = await normalizeTauWatchdogReceiptChain(manifestPath, proofRoot)

		expect(receipt).toMatchObject({
			schema: 'tau.watchdog_receipt_chain_view.v1',
			ok: true,
			manifestPath,
			proofRoot,
			mocked: false,
			live: true,
			runId: 'project-watchdog-20260628T143801Z',
			issue: {
				number: 15,
				finalState: 'CLOSED',
				finalLabels: ['agent-work', 'agent-done'],
				commentCount: 2,
			},
			inputs: {
				action: 'tau_handoff_dispatch',
				maxSteps: 1,
				applyTransport: false,
				issue: 'issue#15',
			},
			watchdog: {
				status: 'COMPLETED',
				handledCount: 1,
				leaseCommentSeen: true,
				evidenceCommentSeen: true,
			},
			commandLoop: {
				status: 'WAITING',
				stepCount: 1,
				selectedAgent: 'reviewer',
				selectedAgentCommandExitCode: 0,
				terminalAgent: 'human',
			},
			githubTransport: {
				dryRun: true,
				applied: false,
			},
		})
	})

	it('fails closed when the watchdog proof is mocked', async () => {
		const root = await makeRoot()
		const { proofRoot, manifestPath, manifest } = await writeValidWatchdogProof(root)
		manifest.mocked = true
		await writeJson(manifestPath, manifest)

		await expect(normalizeTauWatchdogReceiptChain(manifestPath, proofRoot)).rejects.toThrow(
			'Tau watchdog receipt-chain manifest must be mocked=false',
		)
	})

	it('fails closed when cron did not select the expected non-human reviewer route', async () => {
		const root = await makeRoot()
		const { proofRoot, manifestPath, manifest } = await writeValidWatchdogProof(root)
		manifest.command_loop.selected_agent = 'human'
		await writeJson(manifestPath, manifest)

		await expect(normalizeTauWatchdogReceiptChain(manifestPath, proofRoot)).rejects.toThrow(
			'Tau watchdog receipt-chain must select reviewer',
		)
	})
})

describe('normalizeTauChatUxContract', () => {
	function validContract() {
		return {
			schema: 'tau.chat_ux_contract.v1',
			project_name: 'T’au',
			source_of_truth: {
				repository: 'grahama1970/tau',
				path: 'ui/tau-chat-contract.json',
				owns: ['Memory-first chat route contract'],
			},
			integration_surfaces: [
				{
					host: 'ux-lab',
					route: 'http://127.0.0.1:3002/#tau',
					role: 'integration_viewer',
					must_not_own: ['canonical T’au chat contract'],
				},
			],
			memory_pipeline: {
				entrypoint: 'memory.intent',
				stages: ['Getting Intent...', 'Extracting Entities...', 'Accessing Memory...'],
				supported_routes: ['CLARIFY', 'DEFLECT', 'ANSWER', 'RESEARCH', 'COMPLIANCE'],
				fail_closed_rules: ['Do not fabricate a Memory product when a route endpoint fails.'],
			},
			handoff_contracts: [
				'tau.agent_handoff.v1',
				'tau.external_subagent_github_projection.v1',
			],
			orchestration_mode: {
				name: 'parameter_driven_orchestrated_loop',
				activation: 'Provide a tau.agent_handoff.v1 start handoff through --start or TAU_ORCHESTRATOR_START.',
				runner: 'handoff-command-loop',
				scheduler: 'docker/tau-cron.sh',
				loop_rule: 'Each tick validates one handoff, runs one selected bounded subagent command, validates the emitted tau.agent_handoff.v1, writes receipts, and stops at human or an explicit failure condition.',
				agent_source: '/home/graham/workspace/experiments/agent-skills/agents plus Tau command-spec overlays',
				github_transport: 'Dry-run comment and label projections are rendered by default; live mutation requires explicit --apply and preflight checks.',
				non_claims: [
					'The browser chat does not execute real subagents.',
					'Dry-run projections do not mutate GitHub.',
					'Cron scheduling is not proof that a task succeeded.',
				],
			},
			proof_boundaries: {
				proves: ['UX Lab can render and exercise the T’au chat contract as an integration viewer.'],
				does_not_prove: ['Final Sparta Chat readiness.'],
			},
		}
	}

	it('normalizes the T’au-owned chat UX contract for UX Lab integration', async () => {
		const root = await makeRoot()
		const contractPath = resolve(root, 'ui/tau-chat-contract.json')
		await writeJson(contractPath, validContract())

		const receipt = await normalizeTauChatUxContract(contractPath)

		expect(receipt).toMatchObject({
			schema: 'tau.chat_ux_contract_view.v1',
			ok: true,
			sourcePath: contractPath,
			sourceOfTruth: {
				repository: 'grahama1970/tau',
				path: 'ui/tau-chat-contract.json',
			},
			integrationSurface: {
				host: 'ux-lab',
				role: 'integration_viewer',
				route: 'http://127.0.0.1:3002/#tau',
			},
			supportedRoutes: ['CLARIFY', 'DEFLECT', 'ANSWER', 'RESEARCH', 'COMPLIANCE'],
			handoffContracts: [
				'tau.agent_handoff.v1',
				'tau.external_subagent_github_projection.v1',
			],
			orchestrationMode: {
				name: 'parameter_driven_orchestrated_loop',
				activation: 'Provide a tau.agent_handoff.v1 start handoff through --start or TAU_ORCHESTRATOR_START.',
				runner: 'handoff-command-loop',
				scheduler: 'docker/tau-cron.sh',
			},
		})
		expect(receipt.claims).toMatchObject({
			does_not_prove: [
				'The full T’au UX source has moved out of UX Lab.',
				'Final Sparta Chat readiness.',
				'Live GitHub mutation.',
				'Actual external subagent execution from the browser chat.',
			],
		})
	})

	it('fails closed when the T’au-owned contract is malformed', async () => {
		const root = await makeRoot()
		const contractPath = resolve(root, 'ui/tau-chat-contract.json')
		await writeJson(contractPath, {
			...validContract(),
			memory_pipeline: {
				...validContract().memory_pipeline,
				supported_routes: ['CLARIFY'],
			},
		})

		await expect(normalizeTauChatUxContract(contractPath)).rejects.toThrow(
			'missing supported route DEFLECT',
		)
	})

	it('fails closed when the T’au-owned contract omits the special orchestration mode', async () => {
		const root = await makeRoot()
		const contractPath = resolve(root, 'ui/tau-chat-contract.json')
		const payload = validContract()
		delete (payload as Record<string, unknown>).orchestration_mode
		await writeJson(contractPath, payload)

		await expect(normalizeTauChatUxContract(contractPath)).rejects.toThrow(
			'missing parameter-driven orchestration mode',
		)
	})

	it('fails closed when the special orchestration activation omits --start', async () => {
		const root = await makeRoot()
		const contractPath = resolve(root, 'ui/tau-chat-contract.json')
		const payload = validContract()
		payload.orchestration_mode.activation = 'Provide a tau.agent_handoff.v1 start handoff through TAU_ORCHESTRATOR_START.'
		await writeJson(contractPath, payload)

		await expect(normalizeTauChatUxContract(contractPath)).rejects.toThrow(
			'must document --start and TAU_ORCHESTRATOR_START activation',
		)
	})

	it('fails closed when the special orchestration activation omits TAU_ORCHESTRATOR_START', async () => {
		const root = await makeRoot()
		const contractPath = resolve(root, 'ui/tau-chat-contract.json')
		const payload = validContract()
		payload.orchestration_mode.activation = 'Provide a tau.agent_handoff.v1 start handoff through --start.'
		await writeJson(contractPath, payload)

		await expect(normalizeTauChatUxContract(contractPath)).rejects.toThrow(
			'must document --start and TAU_ORCHESTRATOR_START activation',
		)
	})

	it('fails closed when the special orchestration runner is not the Tau command loop', async () => {
		const root = await makeRoot()
		const contractPath = resolve(root, 'ui/tau-chat-contract.json')
		const payload = validContract()
		payload.orchestration_mode.runner = 'ordinary-chat-turn'
		await writeJson(contractPath, payload)

		await expect(normalizeTauChatUxContract(contractPath)).rejects.toThrow(
			'runner must be handoff-command-loop',
		)
	})

	it('fails closed when the special orchestration scheduler is not the Tau cron entrypoint', async () => {
		const root = await makeRoot()
		const contractPath = resolve(root, 'ui/tau-chat-contract.json')
		const payload = validContract()
		payload.orchestration_mode.scheduler = 'ux-lab-chat-shell'
		await writeJson(contractPath, payload)

		await expect(normalizeTauChatUxContract(contractPath)).rejects.toThrow(
			'scheduler must be docker/tau-cron.sh',
		)
	})

	it('fails closed when the special orchestration loop rule does not require bounded subagent ticks', async () => {
		const root = await makeRoot()
		const contractPath = resolve(root, 'ui/tau-chat-contract.json')
		const payload = validContract()
		payload.orchestration_mode.loop_rule = 'The chat responds to normal user turns.'
		await writeJson(contractPath, payload)

		await expect(normalizeTauChatUxContract(contractPath)).rejects.toThrow(
			'must document bounded subagent command ticks',
		)
	})

	it('fails closed when the special orchestration mode omits browser/subagent non-claims', async () => {
		const root = await makeRoot()
		const contractPath = resolve(root, 'ui/tau-chat-contract.json')
		const payload = validContract()
		payload.orchestration_mode.non_claims = [
			'Dry-run projections do not mutate GitHub.',
			'Cron scheduling is not proof that a task succeeded.',
		]
		await writeJson(contractPath, payload)

		await expect(normalizeTauChatUxContract(contractPath)).rejects.toThrow(
			'missing non-claim: The browser chat does not execute real subagents.',
		)
	})

	it('fails closed when the special orchestration mode omits dry-run mutation non-claims', async () => {
		const root = await makeRoot()
		const contractPath = resolve(root, 'ui/tau-chat-contract.json')
		const payload = validContract()
		payload.orchestration_mode.non_claims = [
			'The browser chat does not execute real subagents.',
			'Cron scheduling is not proof that a task succeeded.',
		]
		await writeJson(contractPath, payload)

		await expect(normalizeTauChatUxContract(contractPath)).rejects.toThrow(
			'missing non-claim: Dry-run projections do not mutate GitHub.',
		)
	})

	it('fails closed when the special orchestration mode omits cron proof-boundary non-claims', async () => {
		const root = await makeRoot()
		const contractPath = resolve(root, 'ui/tau-chat-contract.json')
		const payload = validContract()
		payload.orchestration_mode.non_claims = [
			'The browser chat does not execute real subagents.',
			'Dry-run projections do not mutate GitHub.',
		]
		await writeJson(contractPath, payload)

		await expect(normalizeTauChatUxContract(contractPath)).rejects.toThrow(
			'missing non-claim: Cron scheduling is not proof that a task succeeded.',
		)
	})
})

describe('normalizeTauChatHandoffTransportReceipt', () => {
	function validTransportReceipt(target = 'new') {
		return {
			schema: 'tau.handoff_github_transport_receipt.v1',
			ok: true,
			dryRun: true,
			applied: false,
			target: {
				repo: 'grahama1970/tau',
				target,
			},
			goal: ACTIVE_GOAL,
			labels: {
				add: ['agent-work', 'next:reviewer', 'executor:either'],
				remove: ['agent-active', 'agent-blocked'],
			},
			commandCount: target === 'new' ? 1 : 2,
			commands:
				target === 'new'
					? [
							'gh issue create --repo grahama1970/tau --title "Tau agent handoff: reviewer" --body-file - --label agent-work,next:reviewer,executor:either',
						]
					: [
							'gh issue comment 123 --repo grahama1970/tau --body-file -',
							'gh issue edit 123 --repo grahama1970/tau --add-label agent-work,next:reviewer,executor:either --remove-label agent-active,agent-blocked',
						],
			errors: [],
			sourceProjectionContract: 'tau.handoff_github_projection.rendered.v1',
		}
	}

	it('normalizes the rendered Tau chat dry-run transport receipt', () => {
		const receipt = normalizeTauChatHandoffTransportReceipt(validTransportReceipt())

		expect(receipt).toMatchObject({
			schema: 'tau.handoff_github_transport_validation.v1',
			ok: true,
			dryRun: true,
			applied: false,
			target: { repo: 'grahama1970/tau', target: 'new' },
			goal: ACTIVE_GOAL,
			commandCount: 1,
			commands: [
				'gh issue create --repo grahama1970/tau --title "Tau agent handoff: reviewer" --body-file - --label agent-work,next:reviewer,executor:either',
			],
		})
		expect(receipt.checks).toContain('command_target')
	})

	it('normalizes existing issue transport commands', () => {
		const receipt = normalizeTauChatHandoffTransportReceipt(validTransportReceipt('issue#123'))

		expect(receipt).toMatchObject({
			ok: true,
			target: { repo: 'grahama1970/tau', target: 'issue#123' },
			goal: ACTIVE_GOAL,
			commandCount: 2,
		})
		expect(receipt.commands).toEqual([
			'gh issue comment 123 --repo grahama1970/tau --body-file -',
			'gh issue edit 123 --repo grahama1970/tau --add-label agent-work,next:reviewer,executor:either --remove-label agent-active,agent-blocked',
		])
	})

	it('fails closed when commands do not match the target repo or target kind', () => {
		expect(() =>
			normalizeTauChatHandoffTransportReceipt({
				...validTransportReceipt(),
				commands: ['gh issue create --repo grahama1970/other --body-file -'],
			}),
		).toThrow('command repo does not match target.repo')

		expect(() =>
			normalizeTauChatHandoffTransportReceipt({
				...validTransportReceipt('pr#123'),
				commands: [
					'gh issue comment 123 --repo grahama1970/tau --body-file -',
					'gh issue edit 123 --repo grahama1970/tau --add-label agent-work,next:reviewer,executor:either --remove-label agent-active,agent-blocked',
				],
			}),
		).toThrow('existing target must start with a matching comment command')
	})

	it('fails closed when labels or dry-run boundaries are missing', () => {
		expect(() =>
			normalizeTauChatHandoffTransportReceipt({
				...validTransportReceipt(),
				applied: true,
			}),
		).toThrow('applied=false')

		expect(() =>
			normalizeTauChatHandoffTransportReceipt({
				...validTransportReceipt(),
				labels: { add: ['agent-work', 'executor:either'], remove: [] },
			}),
		).toThrow('missing next:<agent> label')
	})
})

describe('normalizeTauChatHandoffOrchestratorIntake', () => {
	function validValidationReceipt() {
		return normalizeTauChatHandoffTransportReceipt({
			schema: 'tau.handoff_github_transport_receipt.v1',
			ok: true,
			dryRun: true,
			applied: false,
			target: {
				repo: 'grahama1970/tau',
				target: 'new',
			},
			goal: ACTIVE_GOAL,
			labels: {
				add: ['agent-work', 'next:reviewer', 'executor:either'],
				remove: ['agent-active', 'agent-blocked'],
			},
			commandCount: 1,
			commands: [
				'gh issue create --repo grahama1970/tau --title "Tau agent handoff: reviewer" --body-file - --label agent-work,next:reviewer,executor:either',
			],
			errors: [],
			sourceProjectionContract: 'tau.handoff_github_projection.rendered.v1',
		})
	}

	it('normalizes a server-validated handoff transport receipt into orchestrator intake', () => {
		const receipt = normalizeTauChatHandoffOrchestratorIntake(validValidationReceipt())

		expect(receipt).toMatchObject({
			schema: 'tau.handoff_orchestrator_intake.v1',
			ok: true,
			dryRun: true,
			applied: false,
			accepted: true,
			target: { repo: 'grahama1970/tau', target: 'new' },
			goal: ACTIVE_GOAL,
			nextAgent: 'reviewer',
			executor: 'either',
			commandCount: 1,
			routing: {
				queue: 'github-ticket',
				next_agent: 'reviewer',
				executor: 'either',
			},
		})
		expect(receipt.claims).toMatchObject({
			does_not_prove: ['Live GitHub mutation.', 'Live subagent execution.', 'Final Sparta Chat readiness.'],
		})
	})

	it('fails closed for unvalidated or unroutable intake payloads', () => {
		expect(() =>
			normalizeTauChatHandoffOrchestratorIntake({
				...validValidationReceipt(),
				schema: 'tau.handoff_github_transport_receipt.v1',
			}),
		).toThrow('unexpected Tau handoff transport validation schema')

		expect(() =>
			normalizeTauChatHandoffOrchestratorIntake({
				...validValidationReceipt(),
				labels: { add: ['agent-work', 'executor:either'], remove: [] },
			}),
		).toThrow('missing next:<agent> label')
	})
})

describe('normalizeTauSubagentReceiptExpectation', () => {
	function validIntake() {
		return normalizeTauChatHandoffOrchestratorIntake(
			normalizeTauChatHandoffTransportReceipt({
				schema: 'tau.handoff_github_transport_receipt.v1',
				ok: true,
				dryRun: true,
				applied: false,
				target: {
					repo: 'grahama1970/tau',
					target: 'issue#123',
				},
				goal: ACTIVE_GOAL,
				labels: {
					add: ['agent-work', 'next:reviewer', 'executor:either'],
					remove: ['agent-active', 'agent-blocked'],
				},
				commandCount: 2,
				commands: [
					'gh issue comment 123 --repo grahama1970/tau --body-file -',
					'gh issue edit 123 --repo grahama1970/tau --add-label agent-work,next:reviewer,executor:either --remove-label agent-active,agent-blocked',
				],
				errors: [],
				sourceProjectionContract: 'tau.handoff_github_projection.rendered.v1',
			}),
		)
	}

	it('derives the next subagent receipt expectation from accepted intake', () => {
		const receipt = normalizeTauSubagentReceiptExpectation(validIntake())

		expect(receipt).toMatchObject({
			schema: 'tau.subagent_receipt_expectation.v1',
			ok: true,
			dryRun: true,
			applied: false,
			target: { repo: 'grahama1970/tau', target: 'issue#123' },
			goal: ACTIVE_GOAL,
			nextAgent: 'reviewer',
			executor: 'either',
			requiredReceipt: {
				schema: 'tau.agent_handoff.v1',
				previous_subagent: 'reviewer',
				goal_preservation_required: true,
				next_agent_required: true,
				evidence_required: true,
			},
		})
		expect(receipt.requiredReceipt.fields).toContain('goal.goal_hash')
		expect(receipt.requiredReceipt.fields).toContain('next_agent.name')
		expect(receipt.claims).toMatchObject({
			does_not_prove: [
				'The next subagent actually executed.',
				'The expected receipt was posted to GitHub.',
				'Live GitHub mutation.',
			],
		})
	})

	it('fails closed when accepted intake routing and labels disagree', () => {
		expect(() =>
			normalizeTauSubagentReceiptExpectation({
				...validIntake(),
				nextAgent: 'coder',
			}),
		).toThrow('next label does not match nextAgent')

		expect(() =>
			normalizeTauSubagentReceiptExpectation({
				...validIntake(),
				accepted: false,
			}),
		).toThrow('orchestrator intake is not accepted')
	})

	it('persists the expectation receipt as a non-mutating proof artifact', async () => {
		const root = await makeRoot()
		const receipt = await persistTauSubagentReceiptExpectation(
			validIntake(),
			root,
			new Date('2026-06-27T22:30:00Z'),
		)

		expect(receipt).toMatchObject({
			schema: 'tau.subagent_receipt_expectation.v1',
			persisted: true,
			proofRoot: root,
			artifactPath: resolve(root, '20260627T223000Z/reviewer-subagent-receipt-expectation.json'),
			dryRun: true,
			applied: false,
			nextAgent: 'reviewer',
		})

		const persisted = JSON.parse(String(await readFile(String(receipt.artifactPath), 'utf8')))
		expect(persisted).toMatchObject({
			schema: 'tau.subagent_receipt_expectation.v1',
			persisted: true,
			artifactPath: receipt.artifactPath,
			requiredReceipt: {
				schema: 'tau.agent_handoff.v1',
				previous_subagent: 'reviewer',
			},
		})
	})
})

describe('normalizeTauSubagentHandoffValidation', () => {
	function expectation() {
		return normalizeTauSubagentReceiptExpectation(
			normalizeTauChatHandoffOrchestratorIntake(
				normalizeTauChatHandoffTransportReceipt({
					schema: 'tau.handoff_github_transport_receipt.v1',
					ok: true,
					dryRun: true,
					applied: false,
					target: {
						repo: 'grahama1970/tau',
						target: 'issue#123',
					},
					goal: ACTIVE_GOAL,
					labels: {
						add: ['agent-work', 'next:reviewer', 'executor:either'],
						remove: ['agent-active', 'agent-blocked'],
					},
					commandCount: 2,
					commands: [
						'gh issue comment 123 --repo grahama1970/tau --body-file -',
						'gh issue edit 123 --repo grahama1970/tau --add-label agent-work,next:reviewer,executor:either --remove-label agent-active,agent-blocked',
					],
					errors: [],
					sourceProjectionContract: 'tau.handoff_github_projection.rendered.v1',
				}),
			),
		)
	}

	function candidateHandoff() {
		return {
			schema: 'tau.agent_handoff.v1',
			github: { repo: 'grahama1970/tau', target: 'issue#123' },
			goal: { ...ACTIVE_GOAL },
			previous_subagent: 'reviewer',
			context: {
				summary: 'Candidate reviewer receipt for Tau dry-run validation.',
				artifacts: ['/tmp/tau-subagent-receipt-expectations/example.json'],
			},
			result: {
				status: 'NOOP',
				summary: 'Candidate receipt shape was produced for validation only.',
				evidence: ['/tmp/tau-subagent-receipt-expectations/example.json'],
			},
			rationale: 'This candidate proves receipt shape only, not reviewer execution.',
			next_agent: {
				name: 'human',
				executor: 'human',
				reason: 'Stop after dry-run candidate validation.',
			},
			required_evidence: ['Human decides whether to run a real reviewer subagent.'],
			stop_condition: 'Human approves a real subagent execution step.',
		}
	}

	it('validates a candidate next-subagent handoff against the expectation', () => {
		const receipt = normalizeTauSubagentHandoffValidation({
			expectation: expectation(),
			handoff: candidateHandoff(),
		})

		expect(receipt).toMatchObject({
			schema: 'tau.subagent_handoff_validation.v1',
			ok: true,
			dryRun: true,
			applied: false,
			executed: false,
			candidateOnly: true,
			target: { repo: 'grahama1970/tau', target: 'issue#123' },
			previousSubagent: 'reviewer',
			nextAgent: 'human',
			resultStatus: 'NOOP',
			goal: ACTIVE_GOAL,
			resultEvidenceCount: 1,
		})
		expect(receipt.checks).toContain('previous_subagent_match')
		expect(receipt.checks).toContain('goal_preserved')
		expect(receipt.claims).toMatchObject({
			does_not_prove: [
				'The next subagent actually executed.',
				'The candidate receipt was posted to GitHub.',
				'Live GitHub mutation.',
			],
		})
	})

	it('fails closed when candidate handoff does not match the expectation', () => {
		expect(() =>
			normalizeTauSubagentHandoffValidation({
				expectation: expectation(),
				handoff: {
					...candidateHandoff(),
					previous_subagent: 'coder',
				},
			}),
		).toThrow('previous_subagent does not match expectation')

		expect(() =>
			normalizeTauSubagentHandoffValidation({
				expectation: expectation(),
				handoff: {
					...candidateHandoff(),
					result: { status: 'NOOP', summary: 'No evidence.', evidence: [] },
				},
			}),
		).toThrow('missing result.evidence')

		expect(() =>
			normalizeTauSubagentHandoffValidation({
				expectation: expectation(),
				handoff: {
					...candidateHandoff(),
					goal: { ...ACTIVE_GOAL, goal_hash: 'sha256:drifted' },
				},
			}),
		).toThrow('goal does not match expectation')
	})
})

describe('normalizeTauExternalSubagentReceiptIntake', () => {
	function expectation() {
		return normalizeTauSubagentReceiptExpectation(
			normalizeTauChatHandoffOrchestratorIntake(
				normalizeTauChatHandoffTransportReceipt({
					schema: 'tau.handoff_github_transport_receipt.v1',
					ok: true,
					dryRun: true,
					applied: false,
					target: {
						repo: 'grahama1970/tau',
						target: 'issue#123',
					},
					goal: ACTIVE_GOAL,
					labels: {
						add: ['agent-work', 'next:reviewer', 'executor:either'],
						remove: ['agent-active', 'agent-blocked'],
					},
					commandCount: 2,
					commands: [
						'gh issue comment 123 --repo grahama1970/tau --body-file -',
						'gh issue edit 123 --repo grahama1970/tau --add-label agent-work,next:reviewer,executor:either --remove-label agent-active,agent-blocked',
					],
					errors: [],
					sourceProjectionContract: 'tau.handoff_github_projection.rendered.v1',
				}),
			),
		)
	}

	function externalReceipt() {
		return {
			schema: 'tau.agent_handoff.v1',
			github: { repo: 'grahama1970/tau', target: 'issue#123' },
			goal: { ...ACTIVE_GOAL },
			previous_subagent: 'reviewer',
			context: {
				summary: 'Reviewer inspected the dry-run Tau receipt contract.',
				artifacts: ['/tmp/tau-subagent-receipt-expectations/example.json'],
			},
			result: {
				status: 'COMPLETED',
				summary: 'External reviewer receipt was supplied for harness intake validation.',
				evidence: ['/tmp/tau-subagent-receipts/reviewer.receipt.json'],
			},
			rationale: 'The next route should return to the human after an accepted external receipt fixture.',
			next_agent: {
				name: 'human',
				executor: 'human',
				reason: 'Human decides whether to dispatch a real subagent execution rung.',
			},
			required_evidence: ['Human-approved live subagent execution receipt.'],
			stop_condition: 'Human approves the next live execution step.',
		}
	}

	it('accepts an external subagent receipt without claiming execution', () => {
		const receipt = normalizeTauExternalSubagentReceiptIntake({
			expectation: expectation(),
			receipt: externalReceipt(),
			externalReceiptId: 'reviewer-fixture-001',
		})

		expect(receipt).toMatchObject({
			schema: 'tau.external_subagent_receipt_intake.v1',
			ok: true,
			dryRun: true,
			applied: false,
			accepted: true,
			externalReceipt: true,
			executed: false,
			target: { repo: 'grahama1970/tau', target: 'issue#123' },
			goal: ACTIVE_GOAL,
			previousSubagent: 'reviewer',
			nextAgent: 'human',
			resultStatus: 'COMPLETED',
			resultEvidenceCount: 1,
			externalReceiptId: 'reviewer-fixture-001',
			nextRoute: {
				subagent: 'human',
				executor: 'human',
			},
		})
		expect(receipt.checks).toContain('external_receipt_accepted')
		expect(receipt.sourceValidation).toMatchObject({
			schema: 'tau.subagent_handoff_validation.v1',
			ok: true,
			goal: ACTIVE_GOAL,
		})
		expect(receipt.claims).toMatchObject({
			does_not_prove: [
				'The external subagent actually executed in this browser proof.',
				'The external receipt was posted to GitHub.',
				'Live GitHub mutation.',
			],
		})
	})

	it('fails closed when the external receipt drifts from the expectation', () => {
		expect(() =>
			normalizeTauExternalSubagentReceiptIntake({
				expectation: expectation(),
				receipt: {
					...externalReceipt(),
					goal: { ...ACTIVE_GOAL, goal_hash: 'sha256:drifted' },
				},
			}),
		).toThrow('goal does not match expectation')

		expect(() =>
			normalizeTauExternalSubagentReceiptIntake({
				expectation: expectation(),
				receipt: {
					...externalReceipt(),
					next_agent: { name: '', executor: 'human', reason: '' },
				},
			}),
		).toThrow('missing required fields')
	})
})

describe('normalizeTauExternalSubagentGithubProjection', () => {
	function expectation() {
		return normalizeTauSubagentReceiptExpectation(
			normalizeTauChatHandoffOrchestratorIntake(
				normalizeTauChatHandoffTransportReceipt({
					schema: 'tau.handoff_github_transport_receipt.v1',
					ok: true,
					dryRun: true,
					applied: false,
					target: {
						repo: 'grahama1970/tau',
						target: 'issue#123',
					},
					goal: ACTIVE_GOAL,
					labels: {
						add: ['agent-work', 'next:reviewer', 'executor:either'],
						remove: ['agent-active', 'agent-blocked'],
					},
					commandCount: 2,
					commands: [
						'gh issue comment 123 --repo grahama1970/tau --body-file -',
						'gh issue edit 123 --repo grahama1970/tau --add-label agent-work,next:reviewer,executor:either --remove-label agent-active,agent-blocked',
					],
					errors: [],
					sourceProjectionContract: 'tau.handoff_github_projection.rendered.v1',
				}),
			),
		)
	}

	function externalReceipt() {
		return {
			schema: 'tau.agent_handoff.v1',
			github: { repo: 'grahama1970/tau', target: 'issue#123' },
			goal: { ...ACTIVE_GOAL },
			previous_subagent: 'reviewer',
			context: {
				summary: 'Reviewer inspected the dry-run Tau receipt contract.',
				artifacts: ['/tmp/tau-subagent-receipt-expectations/example.json'],
			},
			result: {
				status: 'COMPLETED',
				summary: 'External reviewer receipt was supplied for harness intake validation.',
				evidence: ['/tmp/tau-subagent-receipts/reviewer.receipt.json'],
			},
			rationale: 'The next route should return to the human after an accepted external receipt fixture.',
			next_agent: {
				name: 'human',
				executor: 'human',
				reason: 'Human decides whether to dispatch a real subagent execution rung.',
			},
			required_evidence: ['Human-approved live subagent execution receipt.'],
			stop_condition: 'Human approves the next live execution step.',
		}
	}

	it('projects an accepted external receipt into dry-run GitHub comment and label commands', () => {
		const receipt = externalReceipt()
		const intake = normalizeTauExternalSubagentReceiptIntake({
			expectation: expectation(),
			receipt,
			externalReceiptId: 'reviewer-fixture-001',
		})
		const projection = normalizeTauExternalSubagentGithubProjection({ intake, receipt })

		expect(projection).toMatchObject({
			schema: 'tau.external_subagent_github_projection.v1',
			ok: true,
			dryRun: true,
			applied: false,
			mutation: 'not_applied',
			target: { repo: 'grahama1970/tau', target: 'issue#123' },
			goal: ACTIVE_GOAL,
			previousSubagent: 'reviewer',
			nextAgent: 'human',
			executor: 'human',
			resultStatus: 'COMPLETED',
			labels: {
				add: ['agent-work', 'next:human', 'executor:human'],
				remove: ['agent-active', 'agent-blocked', 'next:reviewer'],
			},
			commandCount: 2,
			commands: [
				'gh issue comment 123 --repo grahama1970/tau --body-file -',
				'gh issue edit 123 --repo grahama1970/tau --add-label agent-work,next:human,executor:human --remove-label agent-active,agent-blocked,next:reviewer',
			],
			sourceIntake: {
				schema: 'tau.external_subagent_receipt_intake.v1',
				accepted: true,
				externalReceipt: true,
				executed: false,
				externalReceiptId: 'reviewer-fixture-001',
			},
		})
		expect(projection.comment).toMatchObject({
			body_format: 'github-markdown',
			body_marker: '<!-- tau-agent-handoff:v1 -->',
			body_embeds_handoff_json: true,
		})
		expect(String(projection.comment.body)).toContain('## Tau External Subagent Receipt')
		expect(String(projection.comment.body)).toContain('"schema": "tau.agent_handoff.v1"')
		expect(projection.checks).toContain('comment_embeds_receipt_json')
		expect(projection.claims).toMatchObject({
			does_not_prove: [
				'The external subagent actually executed in this browser proof.',
				'The external receipt was posted to GitHub.',
				'Live GitHub mutation.',
			],
		})
	})

	it('fails closed when the projection receipt no longer matches intake', () => {
		const receipt = externalReceipt()
		const intake = normalizeTauExternalSubagentReceiptIntake({
			expectation: expectation(),
			receipt,
		})

		expect(() =>
			normalizeTauExternalSubagentGithubProjection({
				intake,
				receipt: {
					...receipt,
					next_agent: { name: 'releaser', executor: 'either', reason: 'drifted' },
				},
			}),
		).toThrow('next_agent does not match intake')
	})
})
