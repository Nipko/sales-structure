-- Unified public catalogue, authorised 2026-09-14. No payment/attempt is rewritten.
-- Preserve a full before image in the audit log; superadmin edits remain authoritative afterwards.
INSERT INTO public.audit_logs (id, action, resource, details, created_at)
SELECT gen_random_uuid(), 'billing_catalog_unified', 'billing-plans/' || slug,
       jsonb_build_object('before', to_jsonb(p), 'revision', '2026-09-14'), clock_timestamp()
FROM public.billing_plans p WHERE slug IN ('emprendedor','starter','pro','enterprise')
  -- Una sola vez. Un deploy que reintenta tras un corte de red volvería a
  -- escribir la "antes-imagen" capturando el estado YA CAMBIADO, y el registro
  -- diría que los precios nuevos eran los viejos.
  AND NOT EXISTS (SELECT 1 FROM public.audit_logs a
    WHERE a.action = 'billing_catalog_unified'
      AND a.resource = 'billing-plans/' || p.slug
      AND a.details->>'revision' = '2026-09-14');

UPDATE public.billing_plans p SET
 price_usd_cents = v.usd, max_ai_messages = v.messages,
 features = (COALESCE(p.features, '{}'::jsonb) || jsonb_build_object(
   'llmCostBudgetUsdCents', v.soft, 'llmHardBudgetUsdCents', v.hard)),
 price_local_overrides = COALESCE(p.price_local_overrides, '{}'::jsonb) || jsonb_build_object(
   'CO', jsonb_build_object('currency','COP','amountCents',v.monthly) ||
         CASE WHEN v.annual <= 2147483647 THEN jsonb_build_object('annual',jsonb_build_object('currency','COP','amountCents',v.annual)) ELSE '{}'::jsonb END),
 mp_plan_id = NULL, updated_at = clock_timestamp()
FROM (VALUES
('emprendedor', 2900, 12990000, 140292000, 1000, 210, 300),
('starter', 6900, 29990000, 323892000, 5000, 560, 800),
('pro', 17900, 79990000, 863892000, 15000, 1750, 2500),
('enterprise', 49900, 219990000, 2375892000, 40000, 5600, 8000)
) AS v(slug,usd,monthly,annual,messages,soft,hard) WHERE p.slug=v.slug;

-- Email is not an operational self-service conversational channel.
UPDATE public.billing_plans SET features = jsonb_set(features, '{channels}',
 COALESCE((SELECT jsonb_agg(c) FROM jsonb_array_elements(features->'channels') c
 WHERE c <> '"email"'::jsonb), '[]'::jsonb)), updated_at=clock_timestamp()
WHERE jsonb_typeof(features->'channels')='array' AND (features->'channels') ? 'email';

-- Remove historical commercial quota exceptions, as requested for the single catalogue.
-- Other operational overrides remain intact; superadmin may create new explicit exceptions.
INSERT INTO public.audit_logs (id,tenant_id,action,resource,details,created_at)
SELECT gen_random_uuid(),id,'commercial_quota_overrides_reset','tenants/' || id::text,
 jsonb_build_object('before',settings->'quotaOverrides'),clock_timestamp()
FROM public.tenants t WHERE plan IN ('emprendedor','starter','pro','enterprise')
 AND jsonb_typeof(settings->'quotaOverrides')='object'
 -- Idem: al reintentar, `quotaOverrides` sigue siendo un objeto (con las claves
 -- ya quitadas), así que sin esto la segunda corrida guardaría como "antes" el
 -- después.
 AND NOT EXISTS (SELECT 1 FROM public.audit_logs a
   WHERE a.action = 'commercial_quota_overrides_reset'
     AND a.resource = 'tenants/' || t.id::text);
UPDATE public.tenants SET settings=jsonb_set(settings,'{quotaOverrides}',
 (settings->'quotaOverrides') - 'maxAiMessages' - 'llmCostBudgetUsdCents' - 'llmHardBudgetUsdCents')
WHERE plan IN ('emprendedor','starter','pro','enterprise') AND jsonb_typeof(settings->'quotaOverrides')='object';
