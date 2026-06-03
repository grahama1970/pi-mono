/** Critical path files for icon/role taxonomy review bundles (shared with Vite dev plugin). */
export const FOCUSED_TRANSPORT_REVIEW_FILES = [
  'collaboratorIcons.tsx',
  'transportRoleVisuals.ts',
  'subagentPersonaIcons.ts',
  'messageCardContract.ts',
  'TransportChatMessage.tsx',
  'TransportMessageTimeline.tsx',
  'TransportComposer.tsx',
  'TransportRoomHeader.tsx',
  'messageParse.ts',
  'transport-room.css',
] as const

export type FocusedTransportReviewFile = (typeof FOCUSED_TRANSPORT_REVIEW_FILES)[number]
