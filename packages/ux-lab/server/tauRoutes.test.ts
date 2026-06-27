import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { resolve } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import {
	normalizeTauChatHandoffOrchestratorIntake,
	normalizeTauChatHandoffTransportReceipt,
	normalizeTauCommandLoopProjection,
	normalizeTauExternalSubagentReceiptIntake,
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
