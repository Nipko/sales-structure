-- Repair the non-terminal Mercado Pago cohort repointed to Wompi by
-- 20260814120000_retire_mercadopago_platform_rail.
--
-- Wompi has no native subscription object. An ACTIVE/PAST_DUE row with
-- engine='provider' and no provider_subscription_id therefore has nobody that
-- can ever collect its renewal. Leaving it ACTIVE grants paid entitlement for
-- free; leaving it PAST_DUE makes recovery impossible. Fail closed by returning
-- commercial tenants to the two-phase PENDING_AUTH flow. Saving/activating an
-- AVAILABLE Wompi source will arm the internal engine and collect safely.
--
-- Internal-use and complimentary subscriptions are deliberately excluded: they
-- are not sales and must never be converted into a charge-bearing mandate.

UPDATE billing_subscriptions AS s
   SET status = 'pending_auth',
       dunning_state = 'activation_pending',
       next_charge_at = NULL,
       provider_customer_id = NULL,
       metadata = COALESCE(s.metadata, '{}'::jsonb)
           || jsonb_build_object(
                'legacyRailPreviousStatus', s.status,
                'legacyRailNeedsActivation', true,
                'legacyRailRepair', '20260815160000'
              ),
       updated_at = NOW()
  FROM tenants AS t
 WHERE t.id = s.tenant_id
   AND s.provider = 'wompi'
   AND s.provider_subscription_id IS NULL
   AND s.engine = 'provider'
   AND s.status IN ('active', 'past_due')
   AND t.is_internal = FALSE
   AND COALESCE(s.cancellation_reason, '') NOT LIKE 'comp:%';

-- Keep the denormalized hot-path state aligned so SubscriptionGuard blocks
-- product access immediately, and remove the retired provider's customer id.
UPDATE tenants AS t
   SET subscription_status = 'pending_auth',
       payment_provider_customer_id = NULL
  FROM billing_subscriptions AS s
 WHERE s.tenant_id = t.id
   AND s.provider = 'wompi'
   AND s.status = 'pending_auth'
   AND s.metadata->>'legacyRailNeedsActivation' = 'true';
