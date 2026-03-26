import { access } from "node:fs/promises";
import path from "node:path";

async function findUp(fileName: string, options: { cwd: string }): Promise<string | null> {
	let currentDir = options.cwd;
	while (true) {
		const candidate = path.join(currentDir, fileName);
		try {
			await access(candidate);
			return candidate;
		} catch {
			// keep walking
		}
		const parent = path.dirname(currentDir);
		if (parent === currentDir) return null;
		currentDir = parent;
	}
}

export async function resolveRepoRoot(): Promise<string> {
	const env = process.env.PI_MONO_ROOT?.trim();
	if (env) return env;

	const pkg = await findUp("package.json", { cwd: process.cwd() });
	if (pkg) return path.dirname(pkg);

	return process.cwd();
}
