-- ============================================
-- Migracion 007: Regla de automatizacion por defecto para Gecko Aventura
-- Envia plantilla de bienvenida cuando se captura un nuevo lead.
-- El delay de 30 segundos permite que el saludo AI llegue primero.
-- ============================================

-- Insertar regla de bienvenida para tenant Gecko Aventura
INSERT INTO "tenant_gecko_aventura"."automation_rules" (
    tenant_id,
    name,
    trigger_type,
    conditions_json,
    actions_json,
    active
) VALUES (
    'gecko-aventura-0001-0001-000000000001',
    'Plantilla de bienvenida al capturar lead',
    'lead.captured',
    '{}',
    '[{
        "type": "send_template",
        "delay_seconds": 30,
        "template_name": "welcome_lead",
        "language": "es",
        "components": []
    }]',
    true
) ON CONFLICT DO NOTHING;
