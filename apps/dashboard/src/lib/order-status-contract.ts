export type OrderLifecycleStatus = "pending" | "confirmed" | "paid" | "cancelled";

/** Keep the UI choices identical to the server-side order state machine. */
export function allowedOrderTransitions(
  status: OrderLifecycleStatus,
  canCancel: boolean,
): OrderLifecycleStatus[] {
  if (status === "pending") return canCancel ? ["confirmed", "cancelled"] : ["confirmed"];
  if (status === "confirmed") return canCancel ? ["paid", "cancelled"] : ["paid"];
  return [];
}
