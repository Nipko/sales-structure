import type { PrismaClient } from '@prisma/client';
import { withRuntimeSchemaLock } from '../../common/utils/runtime-schema-lock';

/** Shared definition: the trigger initializer must not create a weaker table. */
export async function ensureWidgetSchema(prisma: PrismaClient): Promise<void> {
    await withRuntimeSchemaLock(prisma, 'public', async (tx) => {
        await tx.$queryRawUnsafe(`
                    CREATE TABLE IF NOT EXISTS public.widget_configs (
                        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                        tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
                        widget_id TEXT NOT NULL UNIQUE DEFAULT 'wgt_' || substr(gen_random_uuid()::text, 1, 12),
                        name TEXT NOT NULL DEFAULT 'Web Chat',
                        primary_color TEXT NOT NULL DEFAULT '#6c5ce7',
                        position TEXT NOT NULL DEFAULT 'bottom-right',
                        welcome_message TEXT DEFAULT '¡Hola! ¿En qué te puedo ayudar?',
                        agent_name TEXT DEFAULT 'Asistente',
                        agent_avatar TEXT,
                        pre_chat_enabled BOOLEAN DEFAULT false,
                        pre_chat_fields JSONB DEFAULT '["name","email"]'::jsonb,
                        allowed_domains TEXT[] DEFAULT '{}',
                        is_active BOOLEAN DEFAULT true,
                        locale TEXT DEFAULT 'es',
                        created_at TIMESTAMPTZ DEFAULT NOW(),
                        updated_at TIMESTAMPTZ DEFAULT NOW()
                    )
                `);
        // D11 (sep-2026): the tenant's public link "El enlace de {Nombre}" is a
        // widget born at day 0 with is_demo = true. It never counts as a
        // connected channel and its traffic is paid by the platform up to a
        // cap. Additive so the template can run on every start.
        await tx.$queryRawUnsafe(`ALTER TABLE public.widget_configs ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT false`);
        // One public link per tenant is an invariant, not a hope: two concurrent
        // provisionings both see NOT EXISTS under READ COMMITTED, and the loser
        // must fail with 23505 instead of minting a second link.
        await tx.$queryRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS ux_widget_configs_demo_per_tenant
            ON public.widget_configs (tenant_id) WHERE is_demo = true AND is_active = true`);
        await tx.$queryRawUnsafe(`
                    CREATE TABLE IF NOT EXISTS public.widget_sessions (
                        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                        widget_config_id UUID NOT NULL REFERENCES public.widget_configs(id) ON DELETE CASCADE,
                        tenant_id UUID NOT NULL,
                        visitor_id TEXT NOT NULL,
                        conversation_id UUID,
                        contact_id UUID,
                        visitor_name TEXT,
                        visitor_email TEXT,
                        visitor_phone TEXT,
                        page_url TEXT,
                        token TEXT,
                        created_at TIMESTAMPTZ DEFAULT NOW(),
                        last_seen_at TIMESTAMPTZ DEFAULT NOW()
                    )
                `);
        await tx.$queryRawUnsafe(`
                    CREATE INDEX IF NOT EXISTS idx_widget_sessions_visitor ON public.widget_sessions(visitor_id, widget_config_id)
                `);
        await tx.$queryRawUnsafe(`
                    CREATE TABLE IF NOT EXISTS public.widget_triggers (
                        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                        widget_config_id UUID NOT NULL REFERENCES public.widget_configs(id) ON DELETE CASCADE,
                        name TEXT NOT NULL,
                        conditions JSONB NOT NULL DEFAULT '[]',
                        condition_operator TEXT NOT NULL DEFAULT 'AND',
                        action_type TEXT NOT NULL DEFAULT 'show_bubble_message',
                        action_config JSONB NOT NULL DEFAULT '{}',
                        frequency_minutes INTEGER DEFAULT 0,
                        is_active BOOLEAN DEFAULT true,
                        priority INTEGER DEFAULT 0,
                        created_at TIMESTAMPTZ DEFAULT NOW(),
                        updated_at TIMESTAMPTZ DEFAULT NOW()
                    )
                `);
        await tx.$queryRawUnsafe(`
                    CREATE INDEX IF NOT EXISTS idx_widget_triggers_config ON public.widget_triggers(widget_config_id)
                `);
    });
}
