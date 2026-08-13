export const PRODUCT_TOUR_PENDING_KEY = "parallly:tour:pending";
export const PRODUCT_TOUR_RESTART_EVENT = "parallly:start-tour";
export const PRODUCT_TOUR_PREPARE_EVENT = "parallly:prepare-tour";
export const PRODUCT_TOUR_CLOSED_EVENT = "parallly:tour-closed";
export const PRODUCT_TOUR_MIN_WIDTH = 768;
export const SETUP_COPILOT_PENDING_KEY = "parallly:setup:open-copilot";

export const PRODUCT_TOUR_TARGETS = {
  agent: "aiAgent",
  channels: "channels",
  inbox: "conversations",
  analytics: "analytics",
} as const;

/** The guided overlay is anchored to the persistent desktop navigation. */
export function canRunProductTourAtWidth(width: number): boolean {
  return Number.isFinite(width) && width >= PRODUCT_TOUR_MIN_WIDTH;
}

export function getProductTourSelector(labelKey: string): string {
  return `#tour-${labelKey}`;
}
