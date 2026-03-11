import { classRegistry } from "fabric";

import { PaperButton } from "./PaperButton.js";
import { PaperCard } from "./PaperCard.js";
import { PaperContainer } from "./PaperContainer.js";
import { PaperNavbar } from "./PaperNavbar.js";
import { PaperText } from "./PaperText.js";

export function registerAllObjects(): void {
	classRegistry.setClass(PaperButton, "paper:button");
	classRegistry.setClass(PaperCard, "paper:card");
	classRegistry.setClass(PaperText, "paper:text");
	classRegistry.setClass(PaperContainer, "paper:container");
	classRegistry.setClass(PaperNavbar, "paper:navbar");
}

// Auto-register on import
registerAllObjects();

export { PaperButton } from "./PaperButton.js";
export { PaperCard } from "./PaperCard.js";
export { PaperContainer } from "./PaperContainer.js";
export { PaperNavbar } from "./PaperNavbar.js";
export { PaperText } from "./PaperText.js";
