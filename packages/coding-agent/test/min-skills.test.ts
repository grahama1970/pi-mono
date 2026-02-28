import { existsSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { loadSkillsFromDir } from "../src/core/skills.js";

/**
 * Minimum viable skill set tests.
 *
 * Verifies that the CORE_SKILLS referenced by skill-selector.ts
 * actually exist and load correctly from .pi/skills/.
 */

const PI_SKILLS_DIR = join(__dirname, "../../../.pi/skills");

const CORE_SKILLS = ["memory", "assess", "plan", "orchestrate", "handoff"];

describe("min-skills: CORE_SKILLS loadability", () => {
	it("should have a .pi/skills directory", () => {
		expect(existsSync(PI_SKILLS_DIR)).toBe(true);
	});

	for (const skillName of CORE_SKILLS) {
		const skillDir = join(PI_SKILLS_DIR, skillName);

		it(`${skillName}: directory exists`, () => {
			expect(existsSync(skillDir)).toBe(true);
		});

		it(`${skillName}: has SKILL.md`, () => {
			expect(existsSync(join(skillDir, "SKILL.md"))).toBe(true);
		});

		it(`${skillName}: loads without errors and has description + triggers`, () => {
			const { skills, diagnostics } = loadSkillsFromDir({
				dir: skillDir,
				source: "test",
			});
			const errors = diagnostics.filter((d) => d.type === "error");
			expect(errors).toHaveLength(0);
			// loadSkillsFromDir recurses — find our skill by name
			const skill = skills.find((s) => s.name === skillName);
			expect(skill, `${skillName} not found in loaded skills`).toBeDefined();
			expect(skill!.description.length).toBeGreaterThan(0);
			expect(skill!.triggers).toBeDefined();
			expect(skill!.triggers!.length).toBeGreaterThan(0);
		});
	}
});
