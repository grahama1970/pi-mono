import type { CSSProperties, ReactNode } from "react";
import { EMBRY, body, card, heading, label } from "../common/EmbryStyle";

type ExploitStatus = "running" | "passed" | "failed" | "blocked";
type ActionState = "enabled" | "disabled" | "recommended";

type SourceKind =
	| "artifact_file"
	| "attempts_jsonl"
	| "anomalies_jsonl"
	| "computed_adapter_field"
	| "available_actions";

interface SourceValue<T> {
	value: T;
	source: SourceKind;
	sourceDetail: string;
}

interface HackExploit {
	id: string;
	name: string;
	status: ExploitStatus;
	route: string;
	target: string;
	currentAttempt: string;
	successSignal: string;
	latestResult: string;
	evidence: string;
	nextAction: string;
	artifactDir: string;
}

interface HackEvent {
	time: string;
	message: string;
	sourceDetail: string;
}

interface HackAction {
	id: string;
	label: string;
	state: ActionState;
	reason?: string;
}

interface PreviousExploit {
	id: string;
	status: Exclude<ExploitStatus, "running"> | "current";
	name: string;
	description: string;
	tried: string;
	result: string;
	evidence: string;
	source: string;
}

interface HackExploitMonitorFixture {
	activeArtifact: SourceValue<string>;
	exploitSource: SourceValue<string>;
	currentExploit: SourceValue<HackExploit>;
	latestEvents: SourceValue<HackEvent[]>;
	availableActions: SourceValue<HackAction[]>;
	previousExploits: SourceValue<PreviousExploit[]>;
}

const fixture: HackExploitMonitorFixture = {
	activeArtifact: {
		value: "/mnt/storage12tb/artifacts/agent-skills/hack/evolve-campaign-2026-04-02T134800Z-shack/",
		source: "computed_adapter_field",
		sourceDetail: "matched latest evolve-campaign-* artifact directory",
	},
	exploitSource: {
		value: "attempts.jsonl -> current exploit + previous exploits",
		source: "artifact_file",
		sourceDetail: "attempt records from active artifact directory",
	},
	currentExploit: {
		source: "attempts_jsonl",
		sourceDetail: "currentExploit.source = attempts.jsonl",
		value: {
			id: "009",
			name: "Auth-header boundary probe",
			status: "blocked",
			route: "POST /api/session on Shack",
			target: "Shack",
			currentAttempt: "Send duplicated and malformed auth-boundary headers, then check whether the session endpoint accepts, rejects, or leaks inconsistent behavior.",
			successSignal: "Unexpected session acceptance, inconsistent auth error, or promoted anomaly record.",
			latestResult: "Anomaly was promoted, but promotion-tasks/ was not emitted for handoff.",
			evidence: "attempts.jsonl attempt_id=009; anomalies.jsonl attempt_id=009",
			nextAction: "Create patch plan for missing promotion-task emission.",
			artifactDir: "/mnt/storage12tb/artifacts/agent-skills/hack/evolve-campaign-2026-04-02T134800Z-shack/",
		},
	},
	latestEvents: {
		source: "anomalies_jsonl",
		sourceDetail: "recent log/event lines associated with attempt_id=009",
		value: [
			{ time: "13:50:02", message: "selected promoted anomaly", sourceDetail: "attempts.jsonl attempt_id=009" },
			{ time: "13:50:58", message: "wrote summary.json", sourceDetail: "summary.json mtime" },
			{ time: "13:51:10", message: "wrote anomalies.jsonl", sourceDetail: "anomalies.jsonl attempt_id=009" },
			{ time: "13:51:29", message: "promotion-tasks/ missing after anomaly promotion", sourceDetail: "computed_adapter_field" },
		],
	},
	availableActions: {
		source: "available_actions",
		sourceDetail: "rendered only from availableActions[]",
		value: [
			{ id: "open_logs", label: "Open logs", state: "enabled" },
			{ id: "open_artifact_dir", label: "Open artifact directory", state: "enabled" },
			{ id: "create_proof_task", label: "Create proof task", state: "disabled", reason: "not enabled by availableActions[]" },
			{ id: "create_patch_plan", label: "Create patch plan", state: "recommended" },
			{ id: "mark_blocked", label: "Mark blocked", state: "disabled", reason: "status is sourced from adapter; manual override unavailable" },
		],
	},
	previousExploits: {
		source: "attempts_jsonl",
		sourceDetail: "attempts.jsonl prior entries from the same run",
		value: [
			{
				id: "001",
				status: "passed",
				name: "GET /health unauthenticated baseline",
				description: "Baseline reachability probe",
				tried: "Verify the target is reachable before session mutations.",
				result: "Returned expected 200 baseline response.",
				evidence: "attempts.jsonl attempt_id=001",
				source: "artifact file",
			},
			{
				id: "004",
				status: "passed",
				name: "POST /api/session malformed-token mutation",
				description: "Auth token mutation probe",
				tried: "Send malformed bearer token and verify rejection path.",
				result: "Rejected with expected auth validation error.",
				evidence: "attempts.jsonl attempt_id=004",
				source: "artifact file",
			},
			{
				id: "007",
				status: "failed",
				name: "POST /api/session replay mutation",
				description: "Replay boundary check",
				tried: "Replay prior mutation to confirm whether boundary behavior reproduces.",
				result: "Assertion failed; suspected anomaly did not reproduce.",
				evidence: "attempts.jsonl attempt_id=007",
				source: "artifact file",
			},
			{
				id: "009",
				status: "current",
				name: "Auth-header boundary probe",
				description: "Latest active/promoted exploit",
				tried: "Send duplicated and malformed Authorization boundary headers.",
				result: "Promoted anomaly; blocked because promotion-tasks/ is missing.",
				evidence: "attempts.jsonl attempt_id=009; anomalies.jsonl attempt_id=009",
				source: "computed",
			},
		],
	},
};

function SourcePill({ children }: { children: ReactNode }) {
	return <span style={sourcePillStyle}>{children}</span>;
}

function StatusPill({ status }: { status: ExploitStatus | "current" }) {
	const color = status === "passed" ? EMBRY.green : status === "failed" ? EMBRY.red : status === "blocked" ? EMBRY.amber : EMBRY.blue;
	return (
		<span style={{
			...label,
			display: "inline-flex",
			alignItems: "center",
			gap: 7,
			color,
			border: `1px solid ${color}55`,
			backgroundColor: `${color}18`,
			borderRadius: 999,
			padding: "5px 9px",
			whiteSpace: "nowrap",
		}}>
			<span style={{ width: 6, height: 6, borderRadius: 999, backgroundColor: color }} />
			{status}
		</span>
	);
}

function Field({ labelText, value, source }: { labelText: string; value: ReactNode; source: ReactNode }) {
	return (
		<div style={fieldStyle}>
			<div style={{ ...label, color: EMBRY.dim }}>{labelText}</div>
			<div style={{ ...body, color: EMBRY.white, overflowWrap: "anywhere" }}>{value}</div>
			<SourcePill>{source}</SourcePill>
		</div>
	);
}

function CurrentExploitPanel() {
	const exploit = fixture.currentExploit.value;
	return (
		<section style={panelStyle} aria-labelledby="current-exploit">
			<div style={panelHeaderStyle}>
				<div style={{ display: "flex", alignItems: "center", gap: 10 }}>
					<span style={headerDotStyle} />
					<div style={{ ...label, color: EMBRY.white }} id="current-exploit">Current exploit</div>
				</div>
				<SourcePill>{fixture.currentExploit.sourceDetail}</SourcePill>
			</div>
			<div style={currentGridStyle}>
				<div>
					<div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
						<div style={{ ...heading, fontSize: 28, lineHeight: 1.05, letterSpacing: "-0.04em" }}>{exploit.name}</div>
						<StatusPill status={exploit.status} />
					</div>
					<div style={{ ...body, color: EMBRY.dim, marginTop: 12, maxWidth: 820 }}>
						This exploit attempts to trigger or bypass session authorization boundary handling by sending malformed authorization header variants to <code>POST /api/session</code>.
					</div>
					<div style={{ display: "grid", gap: 10, marginTop: 18 }}>
						<Field labelText="Route / target" value={<><code>{exploit.route}</code></>} source="attempts.jsonl" />
						<Field labelText="Current attempt" value={exploit.currentAttempt} source="attempts.jsonl gene + mutation" />
						<Field labelText="Success signal" value={exploit.successSignal} source="attempts.jsonl assertion" />
						<Field labelText="Latest result" value={<>{exploit.latestResult.replace("promotion-tasks/", "")}<code>promotion-tasks/</code> was not emitted for handoff.</>} source="anomalies.jsonl + computed" />
						<Field labelText="Evidence" value={<code>{exploit.evidence}</code>} source="artifact file selectors" />
						<Field labelText="Next action" value={exploit.nextAction} source="availableActions[]" />
					</div>
				</div>
				<aside style={rightStackStyle} aria-label="current exploit events and actions">
					<RecentEvents />
					<AvailableActions />
				</aside>
			</div>
		</section>
	);
}

function RecentEvents() {
	return (
		<section style={boxStyle}>
			<div style={boxHeaderStyle}>
				<div style={{ ...label, color: EMBRY.white }}>Latest event</div>
				<SourcePill>{fixture.latestEvents.sourceDetail}</SourcePill>
			</div>
			<div style={{ display: "grid", gap: 8 }}>
				{fixture.latestEvents.value.map((event) => (
					<div key={`${event.time}-${event.message}`} style={eventRowStyle}>
						<code style={{ color: EMBRY.dim }}>{event.time}</code>
						<div style={{ ...body, color: EMBRY.white }}>{event.message}</div>
						<SourcePill>{event.sourceDetail}</SourcePill>
					</div>
				))}
			</div>
		</section>
	);
}

function AvailableActions() {
	return (
		<section style={boxStyle}>
			<div style={boxHeaderStyle}>
				<div style={{ ...label, color: EMBRY.white }}>Available actions</div>
				<SourcePill>{fixture.availableActions.sourceDetail}</SourcePill>
			</div>
			<div style={{ display: "grid", gap: 8 }}>
				{fixture.availableActions.value.map((action) => {
					const color = action.state === "recommended" ? EMBRY.green : action.state === "disabled" ? EMBRY.dim : EMBRY.blue;
					return (
						<div key={action.id} style={{
							...actionStyle,
							borderColor: action.state === "recommended" ? `${EMBRY.green}55` : EMBRY.border,
							backgroundColor: action.state === "recommended" ? `${EMBRY.green}12` : action.state === "disabled" ? EMBRY.bgPanel : EMBRY.bgDeep,
							opacity: action.state === "disabled" ? 0.7 : 1,
						}}>
							<div>
								<div style={{ ...heading, color: EMBRY.white, fontSize: 13 }}>{action.label}</div>
								{action.reason ? <div style={{ ...body, color: EMBRY.dim, marginTop: 3 }}>{action.reason}</div> : null}
							</div>
							<SourcePill>{action.state === "recommended" ? "enabled" : action.state}</SourcePill>
							<span style={{ width: 6, height: 6, borderRadius: 999, backgroundColor: color }} />
						</div>
					);
				})}
			</div>
		</section>
	);
}

function PreviousExploits() {
	return (
		<section style={panelStyle} aria-labelledby="previous-exploits">
			<div style={panelHeaderStyle}>
				<div style={{ display: "flex", alignItems: "center", gap: 10 }}>
					<span style={headerDotStyle} />
					<div>
						<div style={{ ...label, color: EMBRY.white }} id="previous-exploits">Previous exploits in this run</div>
						<div style={{ ...body, color: EMBRY.dim, marginTop: 4 }}>Only exploit attempts from the active run are shown.</div>
					</div>
				</div>
				<SourcePill>{fixture.previousExploits.sourceDetail}</SourcePill>
			</div>
			<div style={{ overflowX: "auto" }}>
				<div style={tableStyle}>
					<div style={tableHeaderStyle}>Status</div>
					<div style={tableHeaderStyle}>Exploit attempted</div>
					<div style={tableHeaderStyle}>What it tried</div>
					<div style={tableHeaderStyle}>Result</div>
					<div style={tableHeaderStyle}>Evidence</div>
					<div style={tableHeaderStyle}>Source</div>
					{fixture.previousExploits.value.map((attempt) => (
						<ExploitRow key={attempt.id} attempt={attempt} />
					))}
				</div>
			</div>
		</section>
	);
}

function ExploitRow({ attempt }: { attempt: PreviousExploit }) {
	return (
		<>
			<div style={{ ...tableCellStyle, backgroundColor: attempt.status === "current" ? `${EMBRY.amber}0f` : undefined }}><StatusPill status={attempt.status} /></div>
			<div style={{ ...tableCellStyle, backgroundColor: attempt.status === "current" ? `${EMBRY.amber}0f` : undefined }}>
				<div style={{ ...heading, color: EMBRY.white, fontSize: 13 }}>{attempt.name}</div>
				<div style={{ ...body, color: EMBRY.dim, marginTop: 4 }}>{attempt.description}</div>
			</div>
			<div style={{ ...tableCellStyle, ...body, color: EMBRY.white, backgroundColor: attempt.status === "current" ? `${EMBRY.amber}0f` : undefined }}>{attempt.tried}</div>
			<div style={{ ...tableCellStyle, ...body, color: EMBRY.white, backgroundColor: attempt.status === "current" ? `${EMBRY.amber}0f` : undefined }}>{attempt.result}</div>
			<div style={{ ...tableCellStyle, backgroundColor: attempt.status === "current" ? `${EMBRY.amber}0f` : undefined }}><code style={{ ...body, color: EMBRY.dim }}>{attempt.evidence}</code></div>
			<div style={{ ...tableCellStyle, backgroundColor: attempt.status === "current" ? `${EMBRY.amber}0f` : undefined }}><SourcePill>{attempt.source}</SourcePill></div>
		</>
	);
}

export function HackEvolveMonitor() {
	return (
		<div style={shellStyle} data-qid="hack-current-exploit-monitor">
			<header style={topBarStyle}>
				<div>
					<div style={{ ...heading, fontSize: 30, lineHeight: 1, letterSpacing: "-0.03em" }}>HACK CURRENT EXPLOIT MONITOR</div>
					<div style={{ ...body, color: EMBRY.dim, marginTop: 8 }}>
						Current exploit in progress + previous exploit attempts from <code>attempts.jsonl</code>
					</div>
				</div>
				<div style={{ display: "grid", gap: 8 }}>
					<TruthRow labelText="Active artifact" value={fixture.activeArtifact.value} source={fixture.activeArtifact.sourceDetail} />
					<TruthRow labelText="Exploit source" value={fixture.exploitSource.value} source={fixture.exploitSource.sourceDetail} />
				</div>
			</header>
			<CurrentExploitPanel />
			<PreviousExploits />
		</div>
	);
}

function TruthRow({ labelText, value, source }: { labelText: string; value: string; source: string }) {
	return (
		<div style={truthRowStyle}>
			<div style={{ ...label, color: EMBRY.dim }}>{labelText}</div>
			<code style={{ ...body, color: EMBRY.white, overflowWrap: "anywhere" }}>{value}</code>
			<div style={{ gridColumn: "2", minWidth: 0 }}>
				<SourcePill>{source}</SourcePill>
			</div>
		</div>
	);
}

const shellStyle: CSSProperties = {
	width: "100%",
	maxWidth: 1500,
	display: "grid",
	gap: 18,
};

const topBarStyle: CSSProperties = {
	display: "grid",
	gridTemplateColumns: "1fr",
	gap: 14,
	alignItems: "start",
	paddingBottom: 18,
	borderBottom: `1px solid ${EMBRY.border}`,
};

const truthRowStyle: CSSProperties = {
	display: "grid",
	gridTemplateColumns: "112px minmax(0, 1fr)",
	gap: 10,
	alignItems: "start",
};

const panelStyle: CSSProperties = {
	border: `1px solid ${EMBRY.border}`,
	background: `linear-gradient(180deg, ${EMBRY.bgCard}, ${EMBRY.bgPanel})`,
	overflow: "hidden",
};

const panelHeaderStyle: CSSProperties = {
	display: "flex",
	justifyContent: "space-between",
	alignItems: "center",
	gap: 16,
	padding: "16px 20px",
	borderBottom: `1px solid ${EMBRY.border}`,
};

const headerDotStyle: CSSProperties = {
	width: 9,
	height: 9,
	borderRadius: 999,
	backgroundColor: EMBRY.amber,
	boxShadow: `0 0 0 4px ${EMBRY.amber}22`,
};

const currentGridStyle: CSSProperties = {
	display: "grid",
	gridTemplateColumns: "minmax(0, 1.1fr) minmax(420px, 0.9fr)",
	gap: 22,
	padding: 20,
	alignItems: "start",
};

const rightStackStyle: CSSProperties = {
	display: "grid",
	gap: 14,
};

const boxStyle: CSSProperties = {
	border: `1px solid ${EMBRY.border}`,
	backgroundColor: EMBRY.bgDeep,
	padding: 15,
};

const boxHeaderStyle: CSSProperties = {
	display: "flex",
	justifyContent: "space-between",
	alignItems: "baseline",
	gap: 12,
	marginBottom: 13,
};

const fieldStyle: CSSProperties = {
	display: "grid",
	gridTemplateColumns: "150px minmax(0, 1fr) max-content",
	gap: 12,
	alignItems: "start",
	padding: "11px 12px",
	border: `1px solid ${EMBRY.border}`,
	backgroundColor: EMBRY.bgDeep,
};

const eventRowStyle: CSSProperties = {
	display: "grid",
	gridTemplateColumns: "72px minmax(0, 1fr)",
	gap: 10,
	alignItems: "start",
	padding: 10,
	border: `1px solid ${EMBRY.border}`,
	backgroundColor: EMBRY.bgPanel,
};

const actionStyle: CSSProperties = {
	display: "grid",
	gridTemplateColumns: "minmax(0, 1fr) max-content 6px",
	gap: 10,
	alignItems: "center",
	padding: "10px 11px",
	border: `1px solid ${EMBRY.border}`,
};

const tableStyle: CSSProperties = {
	display: "grid",
	gridTemplateColumns: "110px minmax(180px, 0.9fr) minmax(180px, 1fr) minmax(180px, 1fr) minmax(165px, 0.8fr) 156px",
	minWidth: "100%",
};

const tableHeaderStyle: CSSProperties = {
	...label,
	color: EMBRY.dim,
	padding: 12,
	backgroundColor: EMBRY.bgDeep,
	borderBottom: `1px solid ${EMBRY.border}`,
};

const tableCellStyle: CSSProperties = {
	padding: 12,
	borderBottom: `1px solid ${EMBRY.border}`,
};

const sourcePillStyle: CSSProperties = {
	...label,
	display: "inline-flex",
	alignItems: "center",
	width: "fit-content",
	color: EMBRY.blue,
	border: `1px solid ${EMBRY.blue}55`,
	backgroundColor: `${EMBRY.blue}12`,
	borderRadius: 999,
	padding: "3px 8px",
	whiteSpace: "nowrap",
};
