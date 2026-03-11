import type { GroupProps } from "fabric";
import { Group, Rect, Textbox } from "fabric";

export interface PaperNavbarOptions extends Partial<GroupProps> {
	navLinks?: string[];
	logoText?: string;
	navWidth?: number;
}

const NAV_HEIGHT = 56;
const NAV_PADDING = 16;
const LOGO_FONT_SIZE = 18;
const LINK_FONT_SIZE = 14;
const LINK_GAP = 24;

export class PaperNavbar extends Group {
	static type = "paper:navbar";

	declare navLinks: string[];
	declare logoText: string;

	constructor(options: PaperNavbarOptions = {}) {
		const navLinks = options.navLinks ?? ["Home", "About", "Contact"];
		const logoText = options.logoText ?? "Logo";
		const navWidth = options.navWidth ?? 800;

		const bg = new Rect({
			width: navWidth,
			height: NAV_HEIGHT,
			fill: "#ffffff",
			stroke: "#e2e8f0",
			strokeWidth: 1,
			originX: "center",
			originY: "center",
		});

		const logo = new Textbox(logoText, {
			fontSize: LOGO_FONT_SIZE,
			fontWeight: "700",
			fill: "#0f172a",
			fontFamily: "Inter, system-ui, sans-serif",
			width: 120,
			left: -(navWidth / 2) + NAV_PADDING,
			top: -(NAV_HEIGHT / 2) + (NAV_HEIGHT - LOGO_FONT_SIZE) / 2,
			originX: "left",
			originY: "top",
			splitByGrapheme: false,
		});

		const linkObjects = navLinks.map((link, i) => {
			return new Textbox(link, {
				fontSize: LINK_FONT_SIZE,
				fontWeight: "500",
				fill: "#475569",
				fontFamily: "Inter, system-ui, sans-serif",
				width: 80,
				left: navWidth / 2 - NAV_PADDING - (navLinks.length - i) * (80 + LINK_GAP) + LINK_GAP,
				top: -(NAV_HEIGHT / 2) + (NAV_HEIGHT - LINK_FONT_SIZE) / 2,
				originX: "left",
				originY: "top",
				splitByGrapheme: false,
			});
		});

		const { navLinks: _nl, logoText: _lt, navWidth: _nw, ...groupOpts } = options;
		super([bg, logo, ...linkObjects], { ...groupOpts });

		this.navLinks = navLinks;
		this.logoText = logoText;
	}

	toObject<T extends string[]>(propertiesToInclude: T = [] as unknown as T) {
		return super.toObject([...propertiesToInclude, "navLinks", "logoText"]);
	}

	static async fromObject(object: Record<string, unknown>): Promise<PaperNavbar> {
		const { objects: _objs, layoutManager: _lm, ...rest } = object;
		return new PaperNavbar(rest as PaperNavbarOptions);
	}
}
