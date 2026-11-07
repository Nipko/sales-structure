# 0023 — Los planes deciden qué familias de herramientas recibe cada tenant

- Estado: aprobada
- Fecha: 2026-11-07 · Decide: Claude con la delegación del dueño (pedido: control de las herramientas y de los planes desde el superadmin) · Autor: Claude
- Ámbito:
  - `packages/shared/src/effective-capability-contract.ts`: `toolFamilies`, `planAllowsToolFamily`.
  - `plan-features.registry.ts`.
  - La puerta del plan en `effective-capability`, el borrador, la publicación y `AIToolExecutorService`.
  - `billing-admin.controller.ts`: crear y archivar planes.
  - Las páginas `/admin/plans` y `/admin/tools`.

## Contexto

Hasta acá el plan solo limitaba los pagos (`customerPayments`). Las otras 26 familias de herramientas no dependían del plan, así que no se podía vender un plan con menos capacidades. Desde el superadmin tampoco se podía crear ni archivar un plan; solo editar los existentes.

## Decisión

1. **Nueva función del plan `toolFamilies`**, una lista de familias. Sin lista, o con `null`, se permiten todas. Así ninguno de los 23 tenants actuales pierde nada, y los 5 planes existentes no se modifican. Con lista, solo esas. Pagos exige además `customerPayments`, como antes.
2. **La puerta se aplica donde ya estaba la de pagos:**
   - el contrato de capacidades del turno (razón `plan_missing_feature`);
   - el borrador y la publicación del agente;
   - **también en la ejecución** (`plan_excludes_tool_family`), porque el motor de reservas, Procedures, la confirmación y MCP llaman a las herramientas por nombre.

   Si el plan no se puede leer, pagos falla cerrado y el resto falla abierto, con un aviso. Un corte de Redis o de la base no debe dejar sin agenda a todos los tenants.
3. **Caché de 30 s del plan en la ejecución**, por tenant y solo de lecturas exitosas. Sin ella, cada llamada sumaba una lectura de Redis y otra de la base, en el mismo camino donde la carga de la base ya causó timeouts (ADR 0021). Un cambio de plan tarda como mucho 30 s en aplicarse a la ejecución; la publicación lo lee siempre fresco.
4. **Crear planes** (`POST plans`, con `copyFrom` opcional) y **archivarlos o reactivarlos**:
   - un plan archivado conserva sus tenants actuales, pero no se le puede asignar a nadie más;
   - `starter`, el plan por defecto, no se puede archivar;
   - todo queda en la auditoría.

## Consecuencias

- Qué familias lleva cada plan lo decide el dueño en `/admin/plans`. Esta decisión no configura ningún paquete.
- Si se le pone una lista a un plan, un tenant cuyo agente ya tenía activada una familia excluida no podrá guardar ni publicar cambios del agente hasta apagarla. Es el mismo comportamiento que ya existe con pagos.
- Las herramientas de lectura de proveedores externos (Mindbody, Cliniko, Toast) quedan limitadas al publicar, no al ejecutar.

## Reversión

Quitar `toolFamilies` de los planes que la tengan devuelve todas las familias. El código no necesita revertirse.
