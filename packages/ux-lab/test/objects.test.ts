import { classRegistry } from "fabric";
import { beforeAll, describe, expect, it } from "vitest";
import {
	PaperButton,
	PaperCard,
	PaperContainer,
	PaperNavbar,
	PaperText,
	registerAllObjects,
} from "../src/objects/registry.js";

beforeAll(() => {
	registerAllObjects();
});

describe("PaperButton", () => {
	it("creates with default properties", () => {
		const btn = new PaperButton();
		expect(btn.buttonText).toBe("Button");
		expect(btn.variant).toBe("primary");
		expect(btn.size).toBe("md");
	});

	it("creates with custom properties", () => {
		const btn = new PaperButton({
			buttonText: "Submit",
			variant: "outline",
			size: "lg",
		});
		expect(btn.buttonText).toBe("Submit");
		expect(btn.variant).toBe("outline");
		expect(btn.size).toBe("lg");
	});

	it("serializes custom properties via toObject", () => {
		const btn = new PaperButton({ buttonText: "Save", variant: "secondary", size: "sm" });
		const obj = btn.toObject();
		expect(obj.buttonText).toBe("Save");
		expect(obj.variant).toBe("secondary");
		expect(obj.size).toBe("sm");
	});

	it("round-trips through serialization", async () => {
		const original = new PaperButton({ buttonText: "Click Me", variant: "outline", size: "lg" });
		const serialized = original.toObject();
		const restored = await PaperButton.fromObject(serialized);
		expect(restored.buttonText).toBe("Click Me");
		expect(restored.variant).toBe("outline");
		expect(restored.size).toBe("lg");
	});

	it("has correct static type", () => {
		expect(PaperButton.type).toBe("paper:button");
	});
});

describe("PaperCard", () => {
	it("creates with default properties", () => {
		const card = new PaperCard();
		expect(card.cardTitle).toBe("Card Title");
		expect(card.cardBody).toBe("Card body text goes here.");
		expect(card.cornerRadius).toBe(8);
	});

	it("serializes custom properties via toObject", () => {
		const card = new PaperCard({
			cardTitle: "My Card",
			cardBody: "Some content here",
			cornerRadius: 12,
		});
		const obj = card.toObject();
		expect(obj.cardTitle).toBe("My Card");
		expect(obj.cardBody).toBe("Some content here");
		expect(obj.cornerRadius).toBe(12);
	});

	it("round-trips through serialization", async () => {
		const original = new PaperCard({
			cardTitle: "Test Card",
			cardBody: "Body text",
			cornerRadius: 16,
		});
		const serialized = original.toObject();
		const restored = await PaperCard.fromObject(serialized);
		expect(restored.cardTitle).toBe("Test Card");
		expect(restored.cardBody).toBe("Body text");
		expect(restored.cornerRadius).toBe(16);
	});
});

describe("PaperText", () => {
	it("creates with default body style", () => {
		const t = new PaperText();
		expect(t.textStyle).toBe("body");
		expect(t.fontSize).toBe(16);
	});

	it("applies h1 style settings", () => {
		const t = new PaperText("Heading", { textStyle: "h1" });
		expect(t.textStyle).toBe("h1");
		expect(t.fontSize).toBe(36);
		expect(t.fontWeight).toBe("800");
	});

	it("applies caption style settings", () => {
		const t = new PaperText("Small text", { textStyle: "caption" });
		expect(t.textStyle).toBe("caption");
		expect(t.fontSize).toBe(12);
	});

	it("textStyle property survives round-trip", async () => {
		const original = new PaperText("Hello", { textStyle: "h2" });
		const serialized = original.toObject();
		expect(serialized.textStyle).toBe("h2");

		const restored = await PaperText.fromObject(serialized);
		expect(restored.textStyle).toBe("h2");
		expect(restored.fontSize).toBe(28);
	});
});

describe("PaperContainer", () => {
	it("creates with default layout properties", () => {
		const c = new PaperContainer();
		expect(c.layout).toBe("flex-col");
		expect(c.gap).toBe(8);
		expect(c.containerPadding).toBe(16);
	});

	it("serializes layout properties", () => {
		const c = new PaperContainer([], { layout: "flex-row", gap: 12, containerPadding: 24 });
		const obj = c.toObject();
		expect(obj.layout).toBe("flex-row");
		expect(obj.gap).toBe(12);
		expect(obj.containerPadding).toBe(24);
	});

	it("round-trips through serialization", async () => {
		const original = new PaperContainer([], { layout: "grid", gap: 16, containerPadding: 20 });
		const serialized = original.toObject();
		const restored = await PaperContainer.fromObject(serialized);
		expect(restored.layout).toBe("grid");
		expect(restored.gap).toBe(16);
		expect(restored.containerPadding).toBe(20);
	});
});

describe("PaperNavbar", () => {
	it("creates with default properties", () => {
		const nav = new PaperNavbar();
		expect(nav.logoText).toBe("Logo");
		expect(nav.navLinks).toEqual(["Home", "About", "Contact"]);
	});

	it("serializes custom properties", () => {
		const nav = new PaperNavbar({
			logoText: "MyApp",
			navLinks: ["Dashboard", "Settings"],
		});
		const obj = nav.toObject();
		expect(obj.logoText).toBe("MyApp");
		expect(obj.navLinks).toEqual(["Dashboard", "Settings"]);
	});

	it("round-trips through serialization", async () => {
		const original = new PaperNavbar({
			logoText: "Brand",
			navLinks: ["A", "B", "C", "D"],
		});
		const serialized = original.toObject();
		const restored = await PaperNavbar.fromObject(serialized);
		expect(restored.logoText).toBe("Brand");
		expect(restored.navLinks).toEqual(["A", "B", "C", "D"]);
	});
});

describe("Registry", () => {
	it("registers all custom types in classRegistry", () => {
		const types = ["paper:button", "paper:card", "paper:text", "paper:container", "paper:navbar"];
		for (const type of types) {
			const cls = classRegistry.getClass(type);
			expect(cls).toBeDefined();
		}
	});

	it("maps paper:button to PaperButton class", () => {
		expect(classRegistry.getClass("paper:button")).toBe(PaperButton);
	});

	it("maps paper:card to PaperCard class", () => {
		expect(classRegistry.getClass("paper:card")).toBe(PaperCard);
	});

	it("maps paper:text to PaperText class", () => {
		expect(classRegistry.getClass("paper:text")).toBe(PaperText);
	});

	it("maps paper:container to PaperContainer class", () => {
		expect(classRegistry.getClass("paper:container")).toBe(PaperContainer);
	});

	it("maps paper:navbar to PaperNavbar class", () => {
		expect(classRegistry.getClass("paper:navbar")).toBe(PaperNavbar);
	});
});
