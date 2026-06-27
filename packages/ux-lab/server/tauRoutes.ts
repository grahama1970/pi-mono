import type { Express, Request, Response } from 'express'
import { existsSync } from 'fs'
import { mkdir, readFile, stat, writeFile } from 'fs/promises'
import { resolve } from 'path'

type JsonRecord = Record<string, unknown>

const TAU_COMMAND_LOOP_PROOF_ROOT = resolve(
	process.env.TAU_COMMAND_LOOP_PROOF_ROOT ?? '/tmp/tau-command-loop-explicit-ticket-source-proof',
)
const TAU_COMMAND_LOOP_SUMMARY_PATH = resolve(
	process.env.TAU_COMMAND_LOOP_SUMMARY_PATH ?? resolve(TAU_COMMAND_LOOP_PROOF_ROOT, 'summary.json'),
)
const TAU_SUBAGENT_EXPECTATION_PROOF_ROOT = resolve(
	process.env.TAU_SUBAGENT_EXPECTATION_PROOF_ROOT ?? '/tmp/tau-subagent-receipt-expectations',
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

function parseGithubTarget(target: string): { kind: 'new' } | { kind: 'issue' | 'pr'; number: string } | null {
	if (target === 'new') return { kind: 'new' }
	const match = /^(issue|pr)#([1-9]\d*)$/.exec(target)
	if (!match) return null
	return { kind: match[1] as 'issue' | 'pr', number: match[2] }
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

export function registerTauRoutes(app: Express): void {
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
}
