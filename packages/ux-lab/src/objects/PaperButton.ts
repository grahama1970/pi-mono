import type { GroupProps } from "fabric";
import { Group, Rect, Textbox } from "fabric";

export type ButtonVariant = "primary" | "secondary" | "outline";
export type ButtonSize = "sm" | "md" | "lg";

const VARIANT_COLORS: Record<ButtonVariant, { bg: string; text: string; stroke: string }> = {
	primary: { bg: "#2563eb", text: "#ffffff", stroke: "#2563eb" },
	secondary: { bg: "#64748b", text: "#ffffff", stroke: "#64748b" },
	outline: { bg: "transparent", text: "#2563eb", stroke: "#2563eb" },
};

const SIZE_DIMS: Record<ButtonSize, { width: number; height: number; fontSize: number; px: number }> = {
	sm: { width: 80, height: 32, fontSize: 12, px: 12 },
	md: { width: 120, height: 40, fontSize: 14, px: 16 },
	lg: { width: 160, height: 48, fontSize: 16, px: 24 },
};

export interface PaperButtonOptions extends Partial<GroupProps> {
	buttonText?: string;
	variant?: ButtonVariant;
	size?: ButtonSize;
}

export class PaperButton extends Group {
	static type = "paper:button";

	declare buttonText: string;
	declare variant: ButtonVariant;
	declare size: ButtonSize;

	constructor(options: PaperButtonOptions = {}) {
		const buttonText = options.buttonText ?? "Button";
		const variant = options.variant ?? "primary";
		const size = options.size ?? "md";

		const colors = VARIANT_COLORS[variant];
		const dims = SIZE_DIMS[size];

		const bg = new Rect({
			width: dims.width,
			height: dims.height,
			fill: colors.bg,
			stroke: colors.stroke,
			strokeWidth: variant === "outline" ? 2 : 0,
			rx: 6,
			ry: 6,
			originX: "center",
			originY: "center",
		});

		const label = new Textbox(buttonText, {
			fontSize: dims.fontSize,
			fill: colors.text,
			fontFamily: "Inter, system-ui, sans-serif",
			fontWeight: "600",
			textAlign: "center",
			width: dims.width - dims.px * 2,
			originX: "center",
			originY: "center",
			splitByGrapheme: false,
		});

		const { buttonText: _bt, variant: _v, size: _s, ...groupOpts } = options;
		super([bg, label], { ...groupOpts });

		this.buttonText = buttonText;
		this.variant = variant;
		this.size = size;
	}

	toObject<T extends string[]>(propertiesToInclude: T = [] as unknown as T) {
		return super.toObject([...propertiesToInclude, "buttonText", "variant", "size"]);
	}

	static async fromObject(object: Record<string, unknown>): Promise<PaperButton> {
		const { objects: _objs, layoutManager: _lm, ...rest } = object;
		return new PaperButton(rest as PaperButtonOptions);
	}
}
