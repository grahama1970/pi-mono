/**
 * PTC Compiler — DAG-based parallel task execution planner
 *
 * Pure function library that analyzes task dependencies and groups
 * independent tasks into execution levels for parallel execution.
 *
 * Phase 1: Subprocess-parallel execution via Promise.allSettled()
 *
 * Phase 2: Anthropic PTC API Integration (future, after Pi core adds support)
 *
 * When Pi core adds support, switch from subprocess to in-context execution:
 *
 * 1. Add to ToolDefinition interface:
 *    allowed_callers?: string[]  // ["code_execution_20260120"]
 *
 * 2. Add code_execution tool type:
 *    { type: "code_execution_20260120", name: "code_execution" }
 *
 * 3. Wire container IDs:
 *    - Response: container: { id, expires_at }
 *    - Request: container: "container_xyz" for reuse
 *
 * 4. Handle programmatic tool calls:
 *    - caller: { type: "code_execution_20260120", tool_id }
 *    - Tool results don't enter model context
 *
 * 5. Generate async Python instead of subprocess spawning:
 *    async def run_tasks():
 *      t1, t3 = await asyncio.gather(
 *        run_skill("/ingest-code"),
 *        run_skill("/treesitter"),
 *      )
 *      t2 = await run_skill("/dogpile", context=t1)
 *      return summarize(t1, t2, t3)
 */

export interface ParsedTaskMinimal {
	id: number;
	title: string;
	dependencies: number[];
	parallel?: number; // Parallel group number (same number = run together)
}

export interface ExecutionLevel<T extends ParsedTaskMinimal = ParsedTaskMinimal> {
	level: number;
	tasks: T[];
	parallel: boolean; // true if >1 task in this level
}

export interface ExecutionPlan<T extends ParsedTaskMinimal = ParsedTaskMinimal> {
	levels: ExecutionLevel<T>[];
	totalTasks: number;
	maxParallelism: number;
	estimatedRoundTrips: number;
	serialRoundTrips: number;
}

/**
 * Compile tasks into an execution plan using Kahn's algorithm with level grouping.
 *
 * Algorithm:
 * 1. Build adjacency list from task.dependencies[]
 * 2. Filter out completed tasks
 * 3. Find all tasks with in-degree 0 (no unmet deps) → Level 0
 * 4. Remove Level 0, find new in-degree 0 → Level 1
 * 5. Repeat until all placed
 * 6. Respect `parallel` field — tasks with same parallel number are grouped together
 * 7. Detect cycles (error if any tasks remain unplaced)
 */
export function compileTasks<T extends ParsedTaskMinimal>(
	tasks: T[],
	completedIds: Set<number>,
): ExecutionPlan<T> {
	// Filter to only pending tasks
	const pending = tasks.filter((t) => !completedIds.has(t.id));

	if (pending.length === 0) {
		return {
			levels: [],
			totalTasks: 0,
			maxParallelism: 0,
			estimatedRoundTrips: 0,
			serialRoundTrips: 0,
		};
	}

	// Validate task IDs and dependencies before processing
	const pendingIds = new Set(pending.map((t) => t.id));
	const seenIds = new Set<number>();

	for (const t of pending) {
		if (seenIds.has(t.id)) {
			throw new Error(`Duplicate task ID ${t.id} — each task must have a unique ID`);
		}
		seenIds.add(t.id);

		if (t.dependencies.includes(t.id)) {
			throw new Error(`Task ${t.id} (${t.title}) references itself in dependencies`);
		}

		for (const depId of t.dependencies) {
			if (!completedIds.has(depId) && !pendingIds.has(depId)) {
				throw new Error(
					`Task ${t.id} (${t.title}) depends on non-existent task ${depId}`,
				);
			}
		}
	}

	const taskMap = new Map<number, T>();
	for (const t of pending) {
		taskMap.set(t.id, t);
	}

	// Build in-degree map (only count deps that are themselves pending)
	const inDegree = new Map<number, number>();
	for (const t of pending) {
		const pendingDeps = t.dependencies.filter(
			(depId) => !completedIds.has(depId) && taskMap.has(depId),
		);
		inDegree.set(t.id, pendingDeps.length);
	}

	// Build forward adjacency: dep → tasks that depend on it
	const dependents = new Map<number, number[]>();
	for (const t of pending) {
		for (const depId of t.dependencies) {
			if (taskMap.has(depId)) {
				const list = dependents.get(depId) ?? [];
				list.push(t.id);
				dependents.set(depId, list);
			}
		}
	}

	const levels: ExecutionLevel<T>[] = [];
	const placed = new Set<number>();
	let levelNum = 0;

	while (placed.size < pending.length) {
		// Find all tasks with in-degree 0 that haven't been placed
		const ready: T[] = [];
		for (const t of pending) {
			if (!placed.has(t.id) && (inDegree.get(t.id) ?? 0) === 0) {
				ready.push(t);
			}
		}

		if (ready.length === 0) {
			// Cycle detected — remaining tasks have circular deps
			const remaining = pending
				.filter((t) => !placed.has(t.id))
				.map((t) => `Task ${t.id}: ${t.title}`);
			throw new Error(
				`Cycle detected in task dependencies. Stuck tasks:\n  ${remaining.join("\n  ")}`,
			);
		}

		// Group by parallel number if set, otherwise all go in one level
		const parallelGroups = new Map<number | undefined, T[]>();
		for (const t of ready) {
			const key = t.parallel;
			const group = parallelGroups.get(key) ?? [];
			group.push(t);
			parallelGroups.set(key, group);
		}

		// If all tasks share the same parallel group (or none), emit as one level
		// If different parallel groups, emit separate levels for each group
		if (parallelGroups.size === 1) {
			levels.push({
				level: levelNum++,
				tasks: ready,
				parallel: ready.length > 1,
			});
		} else {
			// Tasks with explicit parallel grouping: same number = same level
			// Tasks without parallel number: group together
			const groupKeys = Array.from(parallelGroups.keys());
			for (const key of groupKeys) {
				const group = parallelGroups.get(key)!;
				levels.push({
					level: levelNum++,
					tasks: group,
					parallel: group.length > 1,
				});
			}
		}

		// Mark ready tasks as placed and decrement in-degree of dependents
		for (const t of ready) {
			placed.add(t.id);
			for (const depId of dependents.get(t.id) ?? []) {
				inDegree.set(depId, (inDegree.get(depId) ?? 1) - 1);
			}
		}
	}

	const maxParallelism = Math.max(...levels.map((l) => l.tasks.length), 0);

	return {
		levels,
		totalTasks: pending.length,
		maxParallelism,
		estimatedRoundTrips: levels.length,
		serialRoundTrips: pending.length,
	};
}

/**
 * Format an execution plan as a human-readable string for dry-run output.
 */
export function formatExecutionPlan(plan: ExecutionPlan): string {
	if (plan.totalTasks === 0) {
		return "No pending tasks.";
	}

	const lines: string[] = ["=== PTC Execution Plan ==="];

	for (const level of plan.levels) {
		const mode = level.parallel ? "parallel" : "serial";
		const taskCount = level.tasks.length;
		lines.push(`Level ${level.level} (${mode}, ${taskCount} task${taskCount > 1 ? "s" : ""}):`);

		for (const task of level.tasks) {
			const deps =
				task.dependencies.length > 0
					? `[depends on: ${task.dependencies.join(", ")}]`
					: "[no dependencies]";
			lines.push(`  Task ${task.id}: ${task.title.padEnd(40)} ${deps}`);
		}
	}

	const reduction =
		plan.serialRoundTrips > 0
			? Math.round(
					((plan.serialRoundTrips - plan.estimatedRoundTrips) / plan.serialRoundTrips) * 100,
				)
			: 0;

	lines.push("");
	lines.push(
		`Estimated: ${plan.estimatedRoundTrips} round-trips (vs ${plan.serialRoundTrips} serial) — ${reduction}% reduction`,
	);
	lines.push(`Max parallelism: ${plan.maxParallelism}`);

	return lines.join("\n");
}
