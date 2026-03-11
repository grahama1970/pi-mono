import type { TextboxProps } from "fabric";
import { Textbox } from "fabric";

export type TextStyle = "h1" | "h2" | "h3" | "body" | "caption";

const TEXT_STYLE_CONFIG: Record<TextStyle, { fontSize: number; fontWeight: string; lineHeight: number }> = {
	h1: { fontSize: 36, fontWeight: "800", lineHeight: 1.2 },
	h2: { fontSize: 28, fontWeight: "700", lineHeight: 1.3 },
	h3: { fontSize: 22, fontWeight: "600", lineHeight: 1.4 },
	body: { fontSize: 16, fontWeight: "400", lineHeight: 1.6 },
	caption: { fontSize: 12, fontWeight: "400", lineHeight: 1.4 },
};

export interface PaperTextOptions extends Partial<TextboxProps> {
	textStyle?: TextStyle;
	text?: string;
}

export class PaperText extends Textbox {
	static type = "paper:text";

	declare textStyle: TextStyle;

	constructor(text?: string, options: PaperTextOptions = {}) {
		const textStyle = options.textStyle ?? "body";
		const config = TEXT_STYLE_CONFIG[textStyle];

		const { textStyle: _ts, ...textboxOpts } = options;

		super(text ?? "Text", {
			fontFamily: "Inter, system-ui, sans-serif",
			fill: "#0f172a",
			width: 300,
			...textboxOpts,
			fontSize: options.fontSize ?? config.fontSize,
			fontWeight: options.fontWeight ?? config.fontWeight,
			lineHeight: options.lineHeight ?? config.lineHeight,
		});

		this.textStyle = textStyle;
	}

	toObject<T extends string[]>(propertiesToInclude: T = [] as unknown as T) {
		return super.toObject([...propertiesToInclude, "textStyle"]);
	}

	static async fromObject(object: Record<string, unknown>): Promise<PaperText> {
		const { text, type: _type, ...rest } = object;
		return new PaperText(text as string, rest as PaperTextOptions);
	}
}
