import type { CanvasElement } from "../types";

const VALID_COLOR_RE = /^(#[0-9a-fA-F]{3,8}|[a-zA-Z]+|none|transparent|rgba?\([^)]*\))$/;

function sanitizeColor(value: string): string {
	return VALID_COLOR_RE.test(value) ? value : "none";
}

function escapeXml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

/** Escape and validate a color attribute value */
function attr(value: string | number): string {
	return escapeXml(String(value));
}

function colorAttr(value: string): string {
	return escapeXml(sanitizeColor(value));
}

function elementToSvg(el: CanvasElement): string {
	const fill = sanitizeColor((el.props.fill as string) ?? "none");
	const stroke = sanitizeColor((el.props.stroke as string) ?? "none");

	switch (el.type) {
		case "circle":
			return `  <circle cx="${attr(el.x + el.width / 2)}" cy="${attr(el.y + el.height / 2)}" r="${attr(Math.min(el.width, el.height) / 2)}" fill="${colorAttr(fill)}" stroke="${colorAttr(stroke)}" />`;

		case "paper:text":
		case "textbox": {
			const text = (el.props.text as string) ?? "";
			const fontSize = (el.props.fontSize as number) ?? 16;
			const textFill = fill !== "none" ? fill : "#000000";
			return `  <text x="${attr(el.x)}" y="${attr(el.y + fontSize)}" font-size="${attr(fontSize)}" fill="${colorAttr(textFill)}">${escapeXml(text)}</text>`;
		}

		case "paper:button": {
			const btnText = (el.props.buttonText as string) ?? "Button";
			const variant = (el.props.variant as string) ?? "primary";
			const btnFill = variant === "outline" ? "none" : variant === "secondary" ? "#64748b" : "#2563eb";
			const btnStroke = variant === "outline" ? "#2563eb" : "none";
			const textFill = variant === "outline" ? "#2563eb" : "#ffffff";
			return [
				`  <g>`,
				`    <rect x="${attr(el.x)}" y="${attr(el.y)}" width="${attr(el.width)}" height="${attr(el.height)}" rx="6" fill="${colorAttr(btnFill)}" stroke="${colorAttr(btnStroke)}" stroke-width="${attr(variant === "outline" ? 2 : 0)}" />`,
				`    <text x="${attr(el.x + el.width / 2)}" y="${attr(el.y + el.height / 2 + 5)}" text-anchor="middle" fill="${colorAttr(textFill)}" font-size="14" font-weight="600">${escapeXml(btnText)}</text>`,
				`  </g>`,
			].join("\n");
		}

		case "paper:card": {
			const title = (el.props.cardTitle as string) ?? "Card Title";
			const body = (el.props.cardBody as string) ?? "";
			return [
				`  <g>`,
				`    <rect x="${attr(el.x)}" y="${attr(el.y)}" width="${attr(el.width)}" height="${attr(el.height)}" rx="8" fill="#ffffff" stroke="#e2e8f0" />`,
				`    <text x="${attr(el.x + 16)}" y="${attr(el.y + 28)}" font-size="18" font-weight="700" fill="#0f172a">${escapeXml(title)}</text>`,
				body
					? `    <text x="${attr(el.x + 16)}" y="${attr(el.y + 52)}" font-size="14" fill="#475569">${escapeXml(body)}</text>`
					: "",
				`  </g>`,
			]
				.filter(Boolean)
				.join("\n");
		}

		case "paper:navbar": {
			const logo = (el.props.logoText as string) ?? "Logo";
			const links = (el.props.navLinks as string[]) ?? [];
			const linksSvg = links
				.map(
					(link, i) =>
						`    <text x="${attr(el.x + el.width - 100 - i * 100)}" y="${attr(el.y + 35)}" font-size="14" fill="#475569">${escapeXml(link)}</text>`,
				)
				.reverse()
				.join("\n");
			return [
				`  <g>`,
				`    <rect x="${attr(el.x)}" y="${attr(el.y)}" width="${attr(el.width)}" height="${attr(el.height)}" fill="#ffffff" stroke="#e2e8f0" />`,
				`    <text x="${attr(el.x + 16)}" y="${attr(el.y + 35)}" font-size="18" font-weight="700" fill="#0f172a">${escapeXml(logo)}</text>`,
				linksSvg,
				`  </g>`,
			].join("\n");
		}

		case "paper:container": {
			return `  <rect x="${attr(el.x)}" y="${attr(el.y)}" width="${attr(el.width)}" height="${attr(el.height)}" rx="4" fill="#f8fafc" stroke="#cbd5e1" stroke-dasharray="4 4" />`;
		}

		case "line":
			return `  <line x1="${attr(el.x)}" y1="${attr(el.y)}" x2="${attr(el.x + el.width)}" y2="${attr(el.y + el.height)}" stroke="${colorAttr(stroke !== "none" ? stroke : "#000000")}" />`;

		default:
			// rect and fallback
			return `  <rect x="${attr(el.x)}" y="${attr(el.y)}" width="${attr(el.width)}" height="${attr(el.height)}" fill="${colorAttr(fill)}" stroke="${colorAttr(stroke)}" />`;
	}
}

export function exportAsSvg(elements: CanvasElement[]): string {
	if (elements.length === 0) {
		return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600">\n  <!-- Empty canvas -->\n</svg>';
	}

	// Calculate viewBox from element bounds
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;

	for (const el of elements) {
		minX = Math.min(minX, el.x);
		minY = Math.min(minY, el.y);
		maxX = Math.max(maxX, el.x + el.width);
		maxY = Math.max(maxY, el.y + el.height);
	}

	const viewBox = `${minX} ${minY} ${maxX - minX} ${maxY - minY}`;
	const svgElements = elements.map(elementToSvg).join("\n");

	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">\n${svgElements}\n</svg>`;
}
