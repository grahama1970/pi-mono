import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * Skill Browser Extension — `/skills` command for discovery.
 *
 * Provides human-friendly skill listing grouped by domain/verb prefix,
 * with optional search by keyword against names + descriptions.
 *
 * Usage:
 *   /skills              — List all skills grouped by domain
 *   /skills pdf           — Search skills matching "pdf"
 *   /skills --domain ops  — List only ops-* skills
 *   /skills --count       — Just show counts per domain
 */

// -- Types -------------------------------------------------------------------

interface SkillManifestEntry {
	name: string;
	description: string;
	has_skill_md: boolean;
	has_run_sh: boolean;
	has_sanity_sh: boolean;
}

interface SkillManifest {
	generated: string;
	skill_count: number;
	total_dirs: number;
	skills: SkillManifestEntry[];
}

// -- Domain grouping ---------------------------------------------------------

/** Map verb prefix → human-readable domain name */
const DOMAIN_MAP: Record<string, string> = {
	"create": "Creation & Generation",
	"monitor": "Monitoring & Health",
	"ops": "Operations & DevOps",
	"ingest": "Ingestion & Import",
	"review": "Review & Assessment",
	"discover": "Discovery & Search",
	"consume": "Consumption & Retrieval",
	"best-practices": "Best Practices",
	"train": "Training & ML",
	"learn": "Learning & Memory",
	"extract": "Extraction & Parsing",
	"debug": "Debugging",
	"batch": "Batch Processing",
	"sparta": "SPARTA Knowledge Graph",
};

/** Skills that don't match a verb prefix go here */
const MISC_DOMAIN = "Core & Utilities";

function getDomain(skillName: string): string {
	// Check longest prefix first (best-practices before best)
	const sorted = Object.keys(DOMAIN_MAP).sort((a, b) => b.length - a.length);
	for (const prefix of sorted) {
		if (skillName.startsWith(prefix + "-") || skillName === prefix) {
			return DOMAIN_MAP[prefix];
		}
	}
	return MISC_DOMAIN;
}

// -- Manifest loading --------------------------------------------------------

function loadManifest(): SkillManifest | null {
	const paths = [
		join(process.cwd(), ".pi", "skills-manifest.json"),
		join(process.env.HOME || "", "workspace/experiments/pi-mono/.pi/skills-manifest.json"),
	];
	for (const p of paths) {
		try {
			return JSON.parse(readFileSync(p, "utf8"));
		} catch {
			continue;
		}
	}
	return null;
}

// -- Search ------------------------------------------------------------------

function searchSkills(skills: SkillManifestEntry[], query: string): SkillManifestEntry[] {
	const q = query.toLowerCase();
	const tokens = q.split(/\s+/).filter(Boolean);

	return skills
		.map((s) => {
			const text = `${s.name} ${s.description}`.toLowerCase();
			let score = 0;
			for (const t of tokens) {
				if (s.name.includes(t)) score += 3;        // Name match: strongest
				if (s.name === t) score += 5;               // Exact name match
				if (s.description.toLowerCase().includes(t)) score += 1; // Description match
			}
			return { skill: s, score };
		})
		.filter((r) => r.score > 0)
		.sort((a, b) => b.score - a.score)
		.map((r) => r.skill);
}

// -- Formatters --------------------------------------------------------------

function formatGrouped(skills: SkillManifestEntry[]): string {
	const groups = new Map<string, SkillManifestEntry[]>();
	for (const s of skills) {
		const domain = getDomain(s.name);
		if (!groups.has(domain)) groups.set(domain, []);
		groups.get(domain)!.push(s);
	}

	const lines: string[] = [`## Available Skills (${skills.length} total)\n`];

	// Sort domains alphabetically, but put Core & Utilities last
	const sortedDomains = Array.from(groups.keys()).sort((a, b) => {
		if (a === MISC_DOMAIN) return 1;
		if (b === MISC_DOMAIN) return -1;
		return a.localeCompare(b);
	});

	for (const domain of sortedDomains) {
		const domainSkills = groups.get(domain)!.sort((a, b) => a.name.localeCompare(b.name));
		lines.push(`### ${domain} (${domainSkills.length})`);
		for (const s of domainSkills) {
			const status = s.has_run_sh ? "" : " [no run.sh]";
			// Truncate description to fit terminal width
			const desc = s.description.length > 80 ? s.description.substring(0, 77) + "..." : s.description;
			lines.push(`  /${s.name}${status} — ${desc}`);
		}
		lines.push("");
	}

	return lines.join("\n");
}

function formatCounts(skills: SkillManifestEntry[]): string {
	const groups = new Map<string, number>();
	for (const s of skills) {
		const domain = getDomain(s.name);
		groups.set(domain, (groups.get(domain) || 0) + 1);
	}

	const lines: string[] = [`## Skill Counts (${skills.length} total)\n`];
	const sorted = Array.from(groups.entries()).sort((a, b) => b[1] - a[1]);
	for (const [domain, count] of sorted) {
		lines.push(`  ${count.toString().padStart(4)}  ${domain}`);
	}
	return lines.join("\n");
}

function formatSearch(results: SkillManifestEntry[], query: string): string {
	if (results.length === 0) {
		return `No skills matching "${query}". Try a broader term or /skills to see all.`;
	}

	const lines: string[] = [`## Skills matching "${query}" (${results.length} results)\n`];
	for (const s of results.slice(0, 30)) {
		const desc = s.description.length > 80 ? s.description.substring(0, 77) + "..." : s.description;
		lines.push(`  /${s.name} — ${desc}`);
	}
	if (results.length > 30) {
		lines.push(`\n  ... and ${results.length - 30} more. Narrow your search.`);
	}
	return lines.join("\n");
}

// -- Extension ---------------------------------------------------------------

export default function skillBrowser(pi: ExtensionAPI) {
	pi.registerCommand("skills", {
		description: "Browse and search available skills. Usage: /skills [query] [--domain X] [--count]",
		handler: async (args, ctx) => {
			const manifest = loadManifest();
			if (!manifest) {
				ctx.ui.notify("Could not load skills-manifest.json. Run skills-ci scan to generate it.", "error");
				return;
			}

			const skills = manifest.skills;
			const argStr = (args || "").trim();

			// Parse flags
			const countOnly = argStr.includes("--count");
			const domainMatch = argStr.match(/--domain\s+(\S+)/);
			const query = argStr
				.replace(/--count/g, "")
				.replace(/--domain\s+\S+/g, "")
				.trim();

			let filtered = skills;

			// Domain filter
			if (domainMatch) {
				const prefix = domainMatch[1].toLowerCase();
				filtered = skills.filter((s) => s.name.startsWith(prefix + "-") || s.name === prefix);
			}

			// Search or list
			let output: string;
			if (query) {
				const results = searchSkills(filtered, query);
				output = formatSearch(results, query);
			} else if (countOnly) {
				output = formatCounts(filtered);
			} else {
				output = formatGrouped(filtered);
			}

			ctx.ui.notify(output, "info");
		},
	});
}
