/**
 * @embry/pi-chat-adapter — D-Bus client bridge for embry-agent → SSE → ChatWell.
 *
 * Server-side:
 *   import { createPiChatRouter } from '@embry/pi-chat-adapter'
 *   app.use('/api/agent', createPiChatRouter())
 *
 * Client-side (React):
 *   import { usePiChat } from '@embry/pi-chat-adapter/hook'
 */

export type { PiEvent, PiEventHandler } from "./dbus-client.js";
export { PiDbusClient } from "./dbus-client.js";
export type { PiChatRouterOptions } from "./express-sse.js";
export { createPiChatRouter } from "./express-sse.js";
export type {
	CascadeLayer,
	ChatMessage,
	EntityRef,
	EvidenceCaseData,
	EvidenceGate,
	ReasoningStep,
} from "./message-assembler.js";
export { RequestAssembler } from "./message-assembler.js";
