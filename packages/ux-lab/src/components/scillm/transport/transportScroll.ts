/** Scroll position helpers for the transport collaboration timeline. */
export const SCROLL_NEAR_BOTTOM_PX = 80

export function distanceFromBottom(scrollHeight: number, scrollTop: number, clientHeight: number): number {
  return Math.max(0, scrollHeight - scrollTop - clientHeight)
}

export function isNearBottom(scrollHeight: number, scrollTop: number, clientHeight: number, threshold = SCROLL_NEAR_BOTTOM_PX): boolean {
  return distanceFromBottom(scrollHeight, scrollTop, clientHeight) <= threshold
}

export function shouldShowScrollToBottom(
  scrollHeight: number,
  scrollTop: number,
  clientHeight: number,
  threshold = SCROLL_NEAR_BOTTOM_PX,
): boolean {
  if (scrollHeight <= clientHeight + threshold) return false
  return !isNearBottom(scrollHeight, scrollTop, clientHeight, threshold)
}
