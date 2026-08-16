-- Mercado Pago is no longer a platform subscription rail. A live remote
-- mandate id cannot be presumed safe from a local status: it must first be
-- cancelled and verified at Mercado Pago while the old operational access is
-- still available. Abort the deploy instead of removing webhook/cancellation
-- handling while an external mandate may continue debiting customers.
DO $$
DECLARE
    live_mandates INTEGER;
BEGIN
    SELECT (
        SELECT COUNT(*)
          FROM billing_subscriptions
         WHERE provider = 'mercadopago'
           AND provider_subscription_id IS NOT NULL
    ) + (
        SELECT COUNT(*)
          FROM audit_logs stranded
         WHERE stranded.action = 'billing.stranded_provider_mandate'
           AND stranded.details->>'provider' = 'mercadopago'
           AND COALESCE(stranded.details->>'mandateId', '') <> ''
           AND NOT EXISTS (
                SELECT 1
                  FROM audit_logs resolved
                 WHERE resolved.action = 'billing.stranded_provider_mandate_resolved'
                   AND resolved.details->>'provider' = 'mercadopago'
                   AND resolved.details->>'mandateId' = stranded.details->>'mandateId'
                   AND resolved.created_at >= stranded.created_at
           )
    )
      INTO live_mandates
    ;

    IF live_mandates > 0 THEN
        RAISE EXCEPTION
            'mercadopago_platform_retirement_blocked: % subscription/audit mandate record(s) require provider-side cancellation and append-only verification before deploy',
            live_mandates;
    END IF;
END $$;

-- Wompi is Colombia-only. Commercial local rows outside Colombia cannot be
-- repointed automatically, but leaving them ACTIVE/TRIALING on a retired rail
-- silently grants entitlement forever. Lock them in a durable, explicitly
-- manual state until an eligible provider (for example Stripe) is configured.
UPDATE billing_subscriptions AS s
   SET status = 'pending_auth',
       dunning_state = 'activation_pending',
       next_charge_at = NULL,
       provider_customer_id = NULL,
       metadata = COALESCE(s.metadata, '{}'::jsonb)
           || jsonb_build_object(
                'retiredRailPreviousStatus', s.status,
                'retiredRailNeedsManualAssignment', true,
                'retiredRailRepair', '20260815161000'
              ),
       updated_at = NOW()
  FROM tenants AS t
 WHERE t.id = s.tenant_id
   AND s.provider = 'mercadopago'
   AND s.provider_subscription_id IS NULL
   AND s.engine = 'provider'
   AND s.status IN ('trialing', 'active', 'past_due')
   AND t.is_internal = FALSE
   AND COALESCE(s.cancellation_reason, '') NOT LIKE 'comp:%';

UPDATE tenants AS t
   SET subscription_status = 'pending_auth',
       payment_provider_customer_id = NULL
  FROM billing_subscriptions AS s
 WHERE s.tenant_id = t.id
   AND s.provider = 'mercadopago'
   AND s.status = 'pending_auth'
   AND s.metadata->>'retiredRailNeedsManualAssignment' = 'true';
