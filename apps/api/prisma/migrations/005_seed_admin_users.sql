-- ============================================
-- Seed: Super Admin User
-- ============================================
-- Password: Parallext2026!
-- Hash: bcrypt, 12 rounds
-- 
-- To generate a new hash, use:
--   node -e "require('bcrypt').hash('YOUR_PASSWORD', 12).then(h => console.log(h))"
-- ============================================

INSERT INTO public.users (id, email, password, first_name, last_name, role, tenant_id, is_active, created_at, updated_at)
VALUES (
    gen_random_uuid(),
    'admin@parallext.com',
    '$2b$12$95qKCG/djm1h4pJzpIM3wupq9PQ5WaugUXDSv4GO4/IX74njlKZr2',  -- Parallext2026!
    'Admin',
    'Parallext',
    'super_admin',
    NULL,
    true,
    NOW(),
    NOW()
)
ON CONFLICT (email) DO NOTHING;

-- ============================================
-- Seed: Gecko Aventura Admin
-- ============================================
-- Password: Gecko2026!

INSERT INTO public.users (id, email, password, first_name, last_name, role, tenant_id, is_active, created_at, updated_at)
VALUES (
    gen_random_uuid(),
    'gecko@parallext.com',
    '$2b$12$95qKCG/djm1h4pJzpIM3wupq9PQ5WaugUXDSv4GO4/IX74njlKZr2',  -- Parallext2026! (cambiar)
    'Gecko',
    'Admin',
    'tenant_admin',
    (SELECT id FROM public.tenants WHERE slug = 'gecko-aventura' LIMIT 1),
    true,
    NOW(),
    NOW()
)
ON CONFLICT (email) DO NOTHING;
