import type { FabricObject, GroupProps } from "fabric";
import { Group, Rect } from "fabric";

export type ContainerLayout = "flex-row" | "flex-col" | "grid";

export interface PaperContainerOptions extends Partial<GroupProps> {
	layout?: ContainerLayout;
	gap?: number;
	containerPadding?: number;
	containerWidth?: number;
	containerHeight?: number;
}

export class PaperContainer extends Group {
	static type = "paper:container";

	declare layout: ContainerLayout;
	declare gap: number;
	declare containerPadding: number;

	constructor(children: FabricObject[] = [], options: PaperContainerOptions = {}) {
		const layout = options.layout ?? "flex-col";
		const gap = options.gap ?? 8;
		const containerPadding = options.containerPadding ?? 16;
		const containerWidth = options.containerWidth ?? 320;
		const containerHeight = options.containerHeight ?? 240;

		const bg = new Rect({
			width: containerWidth,
			height: containerHeight,
			fill: "#f8fafc",
			stroke: "#cbd5e1",
			strokeWidth: 1,
			strokeDashArray: [4, 4],
			rx: 4,
			ry: 4,
			originX: "center",
			originY: "center",
		});

		// Position children according to layout
		const startX = -(containerWidth / 2) + containerPadding;
		const startY = -(containerHeight / 2) + containerPadding;
		let offsetX = 0;
		let offsetY = 0;

		for (const child of children) {
			child.set({
				left: startX + offsetX,
				top: startY + offsetY,
				originX: "left",
				originY: "top",
			});

			const childW = (child.width ?? 0) * (child.scaleX ?? 1);
			const childH = (child.height ?? 0) * (child.scaleY ?? 1);

			if (layout === "flex-row") {
				offsetX += childW + gap;
			} else if (layout === "flex-col") {
				offsetY += childH + gap;
			} else {
				// grid: simple 2-column layout
				offsetX += childW + gap;
				if (offsetX + childW > containerWidth - containerPadding * 2) {
					offsetX = 0;
					offsetY += childH + gap;
				}
			}
		}

		const {
			layout: _l,
			gap: _g,
			containerPadding: _cp,
			containerWidth: _cw,
			containerHeight: _ch,
			...groupOpts
		} = options;
		super([bg, ...children], { ...groupOpts });

		this.layout = layout;
		this.gap = gap;
		this.containerPadding = containerPadding;
	}

	toObject<T extends string[]>(propertiesToInclude: T = [] as unknown as T) {
		return super.toObject([...propertiesToInclude, "layout", "gap", "containerPadding"]);
	}

	static async fromObject(object: Record<string, unknown>): Promise<PaperContainer> {
		// Strip serialized sub-objects and layoutManager — we reconstruct the visual children fresh
		const { objects: _objs, layoutManager: _lm, ...rest } = object;
		return new PaperContainer([], rest as PaperContainerOptions);
	}
}
