CREATE TABLE "public"."billing_refund_operations" (
    "id" UUID PRIMARY KEY,
    "payment_id" UUID NOT NULL REFERENCES "public"."billing_payments"("id") ON DELETE CASCADE,
    "amount_cents" INTEGER NOT NULL CHECK ("amount_cents" > 0),
    "currency" TEXT NOT NULL,
    "requested_full" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'reserved',
    "provider_refund_id" TEXT UNIQUE,
    "first_submitted_at" TIMESTAMP(3),
    "next_check_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processing_token" TEXT,
    "processing_until" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error_code" TEXT,
    "actor_user_id" TEXT,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "billing_refund_operations_status_check" CHECK ("status" IN ('reserved', 'unknown', 'pending', 'succeeded', 'failed', 'needs_review'))
);
CREATE INDEX "billing_refund_operations_status_next_check_at_idx" ON "public"."billing_refund_operations"("status", "next_check_at");
CREATE INDEX "billing_refund_operations_payment_id_idx" ON "public"."billing_refund_operations"("payment_id");
CREATE UNIQUE INDEX "billing_refund_operations_one_open_per_payment" ON "public"."billing_refund_operations"("payment_id")
    WHERE "status" IN ('reserved', 'unknown', 'pending');

-- Prior releases had a payment fence but no durable Stripe idempotency key.
-- Preserve these uncertain effects for explicit review; never replay their POST.
INSERT INTO "public"."billing_refund_operations"
    ("id", "payment_id", "amount_cents", "currency", "status", "error_code", "reason")
SELECT gen_random_uuid(), "id", ("metadata"->>'refundPendingAmountCents')::int,
    "currency", 'needs_review', 'stripe_refund_legacy_pending', 'Imported unresolved refund from the legacy payment fence'
FROM "public"."billing_payments"
WHERE "provider" = 'stripe' AND "metadata" ? 'refundPendingTotalCents'
    AND COALESCE("metadata"->>'refundPendingAmountCents', '') ~ '^[1-9][0-9]{0,9}$'
    AND CASE WHEN COALESCE("metadata"->>'refundPendingAmountCents', '') ~ '^[1-9][0-9]{0,9}$'
        THEN ("metadata"->>'refundPendingAmountCents')::numeric <= 2147483647 ELSE false END;
