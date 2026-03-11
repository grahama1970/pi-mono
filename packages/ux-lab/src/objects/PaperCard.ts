import type { GroupProps } from "fabric";
import { Group, Rect, Textbox } from "fabric";

export interface PaperCardOptions extends Partial<GroupProps> {
	cardTitle?: string;
	cardBody?: string;
	cornerRadius?: number;
}

const CARD_WIDTH = 280;
const CARD_PADDING = 16;
const TITLE_FONT_SIZE = 18;
const BODY_FONT_SIZE = 14;
const TITLE_HEIGHT = 28;

export class PaperCard extends Group {
	static type = "paper:card";

	declare cardTitle: string;
	declare cardBody: string;
	declare cornerRadius: number;

	constructor(options: PaperCardOptions = {}) {
		const cardTitle = options.cardTitle ?? "Card Title";
		const cardBody = options.cardBody ?? "Card body text goes here.";
		const cornerRadius = options.cornerRadius ?? 8;

		const cardHeight = 160;

		const bg = new Rect({
			width: CARD_WIDTH,
			height: cardHeight,
			fill: "#ffffff",
			stroke: "#e2e8f0",
			strokeWidth: 1,
			rx: cornerRadius,
			ry: cornerRadius,
			originX: "center",
			originY: "center",
			shadow: "0 1 3 rgba(0,0,0,0.1)",
		});

		const titleText = new Textbox(cardTitle, {
			fontSize: TITLE_FONT_SIZE,
			fontWeight: "700",
			fill: "#0f172a",
			fontFamily: "Inter, system-ui, sans-serif",
			width: CARD_WIDTH - CARD_PADDING * 2,
			left: -(CARD_WIDTH / 2) + CARD_PADDING,
			top: -(cardHeight / 2) + CARD_PADDING,
			originX: "left",
			originY: "top",
			splitByGrapheme: false,
		});

		const bodyText = new Textbox(cardBody, {
			fontSize: BODY_FONT_SIZE,
			fontWeight: "400",
			fill: "#475569",
			fontFamily: "Inter, system-ui, sans-serif",
			width: CARD_WIDTH - CARD_PADDING * 2,
			left: -(CARD_WIDTH / 2) + CARD_PADDING,
			top: -(cardHeight / 2) + CARD_PADDING + TITLE_HEIGHT + 8,
			originX: "left",
			originY: "top",
			splitByGrapheme: false,
		});

		const { cardTitle: _ct, cardBody: _cb, cornerRadius: _cr, ...groupOpts } = options;
		super([bg, titleText, bodyText], { ...groupOpts });

		this.cardTitle = cardTitle;
		this.cardBody = cardBody;
		this.cornerRadius = cornerRadius;
	}

	toObject<T extends string[]>(propertiesToInclude: T = [] as unknown as T) {
		return super.toObject([...propertiesToInclude, "cardTitle", "cardBody", "cornerRadius"]);
	}

	static async fromObject(object: Record<string, unknown>): Promise<PaperCard> {
		const { objects: _objs, layoutManager: _lm, ...rest } = object;
		return new PaperCard(rest as PaperCardOptions);
	}
}
