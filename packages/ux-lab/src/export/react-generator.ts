import type { CanvasElement } from "../types";

// Tailwind color map: hex → Tailwind class
const TAILWIND_COLORS: Record<string, string> = {
	"#ffffff": "white",
	"#000000": "black",
	"#f8fafc": "slate-50",
	"#f1f5f9": "slate-100",
	"#e2e8f0": "slate-200",
	"#cbd5e1": "slate-300",
	"#94a3b8": "slate-400",
	"#64748b": "slate-500",
	"#475569": "slate-600",
	"#334155": "slate-700",
	"#1e293b": "slate-800",
	"#0f172a": "slate-900",
	"#ef4444": "red-500",
	"#f97316": "orange-500",
	"#eab308": "yellow-500",
	"#22c55e": "green-500",
	"#3b82f6": "blue-500",
	"#2563eb": "blue-600",
	"#6366f1": "indigo-500",
	"#8b5cf6": "violet-500",
	"#a855f7": "purple-500",
	"#ec4899": "pink-500",
	"#f3f4f6": "gray-100",
	"#e5e7eb": "gray-200",
	"#d1d5db": "gray-300",
	"#9ca3af": "gray-400",
	"#6b7280": "gray-500",
	"#4b5563": "gray-600",
	"#374151": "gray-700",
	"#1f2937": "gray-800",
	"#111827": "gray-900",
	transparent: "",
};

function colorToTailwindBg(hex: string | undefined): string {
	if (!hex) return "";
	const lower = hex.toLowerCase();
	const tw = TAILWIND_COLORS[lower];
	if (tw === "") return ""; // transparent
	if (tw) return `bg-${tw}`;
	return ""; // fallback handled by inline style
}

function colorToTailwindText(hex: string | undefined): string {
	if (!hex) return "";
	const lower = hex.toLowerCase();
	const tw = TAILWIND_COLORS[lower];
	if (tw === "") return "";
	if (tw) return `text-${tw}`;
	return "";
}

function needsInlineBg(hex: string | undefined): boolean {
	if (!hex || hex.toLowerCase() === "transparent") return false;
	return !TAILWIND_COLORS[hex.toLowerCase()];
}

const VALID_COLOR_RE = /^(#[0-9a-fA-F]{3,8}|[a-zA-Z]+|none|transparent|rgba?\([^)]*\))$/;

function sanitizeColor(value: string): string {
	return VALID_COLOR_RE.test(value) ? value : "none";
}

function escapeJsx(text: string): string {
	return text.replace(/[&<>"'{}]/g, (ch) => {
		switch (ch) {
			case "&":
				return "&amp;";
			case "<":
				return "&lt;";
			case ">":
				return "&gt;";
			case '"':
				return "&quot;";
			case "'":
				return "&#39;";
			case "{":
				return "&#123;";
			case "}":
				return "&#125;";
			default:
				return ch;
		}
	});
}

function indent(str: string, level: number): string {
	const pad = "  ".repeat(level);
	return str
		.split("\n")
		.map((line) => (line.trim() ? pad + line : line))
		.join("\n");
}

// Determine if an element is contained within a container by bounding box
function isContainedIn(child: CanvasElement, container: CanvasElement): boolean {
	return (
		child.x >= container.x &&
		child.y >= container.y &&
		child.x + child.width <= container.x + container.width &&
		child.y + child.height <= container.y + container.height
	);
}

function generateButton(el: CanvasElement): string {
	const text = (el.props.buttonText as string) ?? "Button";
	const variant = (el.props.variant as string) ?? "primary";

	let classes = "px-4 py-2 rounded font-semibold";

	if (variant === "primary") {
		classes += " bg-blue-600 text-white";
	} else if (variant === "secondary") {
		classes += " bg-slate-500 text-white";
	} else if (variant === "outline") {
		classes += " border border-blue-600 text-blue-600 bg-transparent";
	}

	return `<button className="${classes}">${escapeJsx(text)}</button>`;
}

function generateCard(el: CanvasElement): string {
	const title = (el.props.cardTitle as string) ?? "Card Title";
	const body = (el.props.cardBody as string) ?? "";
	const lines = [
		`<div className="rounded-lg shadow-md p-4 bg-white border border-slate-200">`,
		`  <h3 className="font-bold text-lg text-slate-900">${escapeJsx(title)}</h3>`,
	];
	if (body) {
		lines.push(`  <p className="text-slate-600 mt-2">${escapeJsx(body)}</p>`);
	}
	lines.push(`</div>`);
	return lines.join("\n");
}

function generateText(el: CanvasElement): string {
	const textStyle = (el.props.textStyle as string) ?? "body";
	const text = (el.props.text as string) ?? "";
	const fill = el.props.fill as string | undefined;
	const textClass = colorToTailwindText(fill);

	switch (textStyle) {
		case "h1":
			return `<h1 className="text-4xl font-extrabold${textClass ? ` ${textClass}` : ""}">${escapeJsx(text)}</h1>`;
		case "h2":
			return `<h2 className="text-2xl font-bold${textClass ? ` ${textClass}` : ""}">${escapeJsx(text)}</h2>`;
		case "h3":
			return `<h3 className="text-xl font-semibold${textClass ? ` ${textClass}` : ""}">${escapeJsx(text)}</h3>`;
		case "caption":
			return `<span className="text-xs${textClass ? ` ${textClass}` : ""}">${escapeJsx(text)}</span>`;
		default:
			return `<p className="text-base${textClass ? ` ${textClass}` : ""}">${escapeJsx(text)}</p>`;
	}
}

function generateNavbar(el: CanvasElement): string {
	const logo = (el.props.logoText as string) ?? "Logo";
	const links = (el.props.navLinks as string[]) ?? ["Home", "About", "Contact"];
	const linkElements = links
		.map((link) => `    <a href="#" className="text-slate-600 hover:text-slate-900">${escapeJsx(link)}</a>`)
		.join("\n");
	return [
		`<nav className="flex items-center justify-between p-4 bg-white border-b border-slate-200">`,
		`  <span className="font-bold text-lg text-slate-900">${escapeJsx(logo)}</span>`,
		`  <div className="flex gap-6">`,
		linkElements,
		`  </div>`,
		`</nav>`,
	].join("\n");
}

function generateContainer(el: CanvasElement, children: CanvasElement[]): string {
	const layout = (el.props.layout as string) ?? "flex-col";
	const gap = (el.props.gap as number) ?? 8;

	let layoutClasses: string;
	if (layout === "flex-row") {
		layoutClasses = "flex flex-row";
	} else if (layout === "grid") {
		layoutClasses = "grid grid-cols-2";
	} else {
		layoutClasses = "flex flex-col";
	}

	// Sort children based on layout direction
	const sorted = [...children];
	if (layout === "flex-row") {
		sorted.sort((a, b) => a.x - b.x);
	} else {
		sorted.sort((a, b) => a.y - b.y);
	}

	const gapClass = `gap-${Math.round(gap / 4)}`; // approximate Tailwind gap
	const bgClass = colorToTailwindBg((el.props.fill as string) ?? "#f8fafc");

	const childrenJsx = sorted.map((child) => generateElement(child, [])).join("\n");

	return [
		`<div className="${layoutClasses} ${gapClass} p-4${bgClass ? ` ${bgClass}` : ""}">`,
		childrenJsx,
		`</div>`,
	].join("\n");
}

function generateRect(el: CanvasElement): string {
	const fill = el.props.fill as string | undefined;
	const safeFill = fill ? sanitizeColor(fill) : undefined;
	const bgClass = colorToTailwindBg(safeFill);

	const hasInline = needsInlineBg(safeFill) || true; // always have width/height
	const styleAttr = `style={{ width: ${el.width}, height: ${el.height}${needsInlineBg(safeFill) ? `, backgroundColor: '${escapeJsx(safeFill!)}'` : ""} }}`;

	return `<div className="${bgClass}"${hasInline ? ` ${styleAttr}` : ""} />`;
}

function generateCircle(el: CanvasElement): string {
	const fill = el.props.fill as string | undefined;
	const safeFill = fill ? sanitizeColor(fill) : undefined;
	const bgClass = colorToTailwindBg(safeFill);
	const size = Math.max(el.width, el.height);

	return `<div className="rounded-full${bgClass ? ` ${bgClass}` : ""}" style={{ width: ${size}, height: ${size}${needsInlineBg(safeFill) ? `, backgroundColor: '${escapeJsx(safeFill!)}'` : ""} }} />`;
}

function generateTextbox(el: CanvasElement): string {
	const text = (el.props.text as string) ?? "";
	const fill = el.props.fill as string | undefined;
	const safeFill = fill ? sanitizeColor(fill) : undefined;
	const fontSize = el.props.fontSize as number | undefined;

	const styleProps: string[] = [];
	if (safeFill && needsInlineBg(safeFill)) {
		// fill on a textbox is text color, not background
		styleProps.push(`color: '${escapeJsx(safeFill)}'`);
	}
	if (fontSize) {
		styleProps.push(`fontSize: ${fontSize}`);
	}

	const textClass = colorToTailwindText(safeFill);
	const styleAttr = styleProps.length > 0 ? ` style={{ ${styleProps.join(", ")} }}` : "";

	return `<p className="${textClass}"${styleAttr}>${escapeJsx(text)}</p>`;
}

function generateElement(el: CanvasElement, allElements: CanvasElement[]): string {
	switch (el.type) {
		case "paper:button":
			return generateButton(el);
		case "paper:card":
			return generateCard(el);
		case "paper:text":
			return generateText(el);
		case "paper:navbar":
			return generateNavbar(el);
		case "paper:container": {
			const children = allElements.filter((child) => child.id !== el.id && isContainedIn(child, el));
			return generateContainer(el, children);
		}
		case "rect":
			return generateRect(el);
		case "circle":
			return generateCircle(el);
		case "textbox":
			return generateTextbox(el);
		case "line":
			return '<hr className="border-gray-300" />';
		default:
			return `<div data-type="${escapeJsx(el.type)}" style={{ width: ${el.width}, height: ${el.height} }} />`;
	}
}

export function exportAsReact(elements: CanvasElement[]): string {
	if (elements.length === 0) {
		return `export default function CanvasExport() {\n  return (\n    <div className="relative w-full min-h-screen" />\n  )\n}`;
	}

	// Identify containers and their children
	const containers = elements.filter((el) => el.type === "paper:container");
	const containedIds = new Set<string>();

	for (const container of containers) {
		for (const el of elements) {
			if (el.id !== container.id && isContainedIn(el, container)) {
				containedIds.add(el.id);
			}
		}
	}

	// Top-level elements are those not contained in any container
	const topLevel = elements.filter((el) => !containedIds.has(el.id));

	// Determine if we need absolute positioning (no container wrapping everything)
	const hasContainers = containers.length > 0;
	const useAbsolute = !hasContainers || topLevel.length > containers.length;

	const componentLines = topLevel.map((el) => {
		const jsx = generateElement(el, elements);
		if (useAbsolute && el.type !== "paper:navbar") {
			// Wrap in absolute positioned div
			return `      <div className="absolute" style={{ left: ${el.x}, top: ${el.y} }}>\n${indent(jsx, 4)}\n      </div>`;
		}
		return indent(jsx, 3);
	});

	return [
		`export default function CanvasExport() {`,
		`  return (`,
		`    <div className="relative w-full min-h-screen">`,
		componentLines.join("\n"),
		`    </div>`,
		`  )`,
		`}`,
	].join("\n");
}
