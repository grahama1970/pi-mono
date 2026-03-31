import { useEffect, useRef } from "react";

const API = "";

interface ActionDef {
	app: string;
	action: string;
	label: string;
	description: string;
	params?: Record<string, unknown>;
	tags?: string[];
}

const pendingRegistrations: Array<{ elementId: string; def: ActionDef }> = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function flushRegistrations() {
	if (pendingRegistrations.length === 0) return;
	const batch = pendingRegistrations.splice(0);
	const docs = batch.map(({ elementId, def }) => ({
		_key: elementId,
		app: def.app,
		action: def.action,
		doc_type: "action_registration",
		element_id: elementId,
		problem: `${def.label}: ${def.description}`,
		solution: JSON.stringify({ ui_action: def.action, params: def.params ?? {} }),
		label: def.label,
		description: def.description,
		tags: ["queryspec-action", def.app, `action:${def.action}`, ...(def.tags ?? [])],
		scope: def.app,
		registered_at: new Date().toISOString(),
	}));
	fetch(`${API}/api/memory/upsert`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ collection: "app_actions", documents: docs }),
	}).catch(() => {});
}

export function useRegisterAction(elementId: string, def: ActionDef) {
	const registeredRef = useRef(false);
	useEffect(() => {
		if (registeredRef.current) return;
		registeredRef.current = true;
		pendingRegistrations.push({ elementId, def });
		if (flushTimer) clearTimeout(flushTimer);
		flushTimer = setTimeout(flushRegistrations, 500);
		return () => {
			registeredRef.current = false;
		};
	}, [elementId, def]);
}
