import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { resolve } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { normalizeTauChatHandoffTransportReceipt, normalizeTauCommandLoopProjection } from './tauRoutes'

const roots: string[] = []

async function makeRoot(): Promise<string> {
	const root = await mkdtemp(resolve(tmpdir(), 'tau-route-test-'))
	roots.push(root)
	return root
}

async function writeJson(path: string, payload: unknown): Promise<void> {
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
