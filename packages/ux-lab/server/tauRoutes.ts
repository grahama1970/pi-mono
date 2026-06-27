import type { Express, Request, Response } from 'express'
import { existsSync } from 'fs'
import { readFile, stat } from 'fs/promises'
import { resolve } from 'path'

type JsonRecord = Record<string, unknown>

const TAU_COMMAND_LOOP_PROOF_ROOT = resolve(
	process.env.TAU_COMMAND_LOOP_PROOF_ROOT ?? '/tmp/tau-command-loop-explicit-ticket-source-proof',
)
const TAU_COMMAND_LOOP_SUMMARY_PATH = resolve(
	process.env.TAU_COMMAND_LOOP_SUMMARY_PATH ?? resolve(TAU_COMMAND_LOOP_PROOF_ROOT, 'summary.json'),
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

async function readJson(path: string): Promise<JsonRecord> {
	const raw = await readFile(path, 'utf8')
	const parsed = JSON.parse(raw)
	const record = asRecord(parsed)
	if (!record) throw new Error('receipt root must be a JSON object')
	return record
}

async function normalizeTauCommandLoopProjection(summaryPath: string): Promise<JsonRecord> {
	const absoluteSummaryPath = resolve(summaryPath)
	if (!isPathInside(TAU_COMMAND_LOOP_PROOF_ROOT, absoluteSummaryPath)) {
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
	const transportReceiptPath = resolve(TAU_COMMAND_LOOP_PROOF_ROOT, 'command-loop-reconciliation-github-transport.json')

	for (const path of [sourceLoopReceiptPath, reconciliationReceiptPath, ticketSourcePath, transportReceiptPath]) {
		if (!path) throw new Error('Tau command-loop projection receipt is missing a required path')
		if (!isPathInside(TAU_COMMAND_LOOP_PROOF_ROOT, resolve(path))) {
			throw new Error(`Tau command-loop projection path escapes proof root: ${path}`)
		}
	}

	return {
		schema: String(summary.schema),
		summaryPath: absoluteSummaryPath,
		sourceLoopReceiptPath,
		reconciliationReceiptPath,
		actualReconciliationStepReceiptPath: resolve(TAU_COMMAND_LOOP_PROOF_ROOT, 'command-loop/command-loop-step-001.receipt.json'),
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
}
