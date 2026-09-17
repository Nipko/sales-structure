/**
 * What `POST /channels/whatsapp/disconnect` actually achieved.
 *
 * The endpoint always answers 200 with `success: true`, because the local
 * disconnect goes ahead even when Meta refuses. What matters is in the two
 * fields it returns (apps/api/src/modules/whatsapp/whatsapp.controller.ts,
 * `disconnect`):
 *  - `metaUnsubscribed`: Meta removed our app from the WABA, so it stopped
 *    sending this number's webhooks to us;
 *  - `metaError`: set when that call failed, OR when Meta let go but the
 *    tenant's own `whatsapp_channels` row could not be marked (the controller
 *    only writes it after a successful unsubscribe in that case).
 *
 * The page used to read `providerOk`, which the endpoint never sent, so every
 * disconnect —including one that left the app subscribed in Meta— showed the
 * green success message. Only an explicit confirmation counts as complete.
 */
export type DisconnectOutcome = "complete" | "provider_pending" | "local_incomplete";

export function readDisconnectOutcome(response: unknown): DisconnectOutcome {
  if (typeof response !== "object" || response === null) return "provider_pending";
  const body = response as Record<string, unknown>;
  const unsubscribed = body.metaUnsubscribed === true;
  const failed = typeof body.metaError === "string" && body.metaError.trim().length > 0;

  if (unsubscribed && !failed) return "complete";
  if (unsubscribed && failed) return "local_incomplete";
  return "provider_pending";
}
