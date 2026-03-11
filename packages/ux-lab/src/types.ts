export interface CanvasElement {
	id: string;
	type: string; // 'paper:button', 'paper:card', 'rect', 'circle', etc.
	x: number;
	y: number;
	width: number;
	height: number;
	props: Record<string, unknown>; // type-specific properties (text, fill, variant, etc.)
}

export interface AgentZone {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface AgentRegistration {
	id: string;
	name: string; // e.g. "navbar-agent"
	color: string; // hex color for cursor/zone
	zone?: AgentZone;
	status: "idle" | "working" | "done" | "error";
}

export interface CanvasOperation {
	agent: string; // agent id
	op: "create" | "update" | "delete" | "select";
	timestamp: number;
	element?: Partial<CanvasElement> & { type: string };
	id?: string; // target element id for update/delete
	props?: Record<string, unknown>;
	reason?: string; // why this op (shown in operation log)
}

export interface CourseCorrection {
	from: string; // "human" or agent id
	target: string; // "all" or specific agent id
	message: string;
	timestamp: number;
}

export interface OperationLog {
	ops: CanvasOperation[];
	agents: AgentRegistration[];
	corrections: CourseCorrection[];
}

// --- .ux.json design document format ---

export interface UxDesignPage {
	id: string;
	name: string;
	elements: Record<string, CanvasElement>;
	agents: AgentRegistration[];
	ops_log: CanvasOperation[]; // last 50 ops for this page
}

export interface UxDesignVariables {
	colors: Record<string, string>;
	spacing: Record<string, number>;
}

export interface UxDesignDocument {
	version: 1;
	name: string;
	created: string; // ISO timestamp
	modified: string; // ISO timestamp
	theme: string; // e.g. "nvis-dark"
	pages: UxDesignPage[];
	variables: UxDesignVariables;
	brief?: Record<string, unknown>; // parsed DESIGN_BOARD.md content
}
