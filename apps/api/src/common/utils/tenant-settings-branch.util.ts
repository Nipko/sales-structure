import { NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../modules/prisma/prisma.service';

/**
 * ═══ `tenant.settings` ES UN JSONB QUE COMPARTEN DIEZ MÓDULOS ═══
 *
 * Ahí adentro viven la marca blanca, el SSO, el channel manager, las
 * integraciones verticales, la salud de esas integraciones, el e-commerce,
 * Slack, reseñas, el tier gestionado, MCP y las notificaciones por SMS. Y casi
 * todos escribían así:
 *
 * ```ts
 * const tenant = await prisma.tenant.findUnique({ select: { settings: true } });
 * await prisma.tenant.update({ data: { settings: { ...tenant.settings, miRama: valor } } });
 * ```
 *
 * Entre el `findUnique` y el `update` pasa tiempo real, y lo que otro módulo
 * haya escrito en el medio **se pierde entero**: el `...settings` que se manda
 * es una foto vieja del objeto completo. No hay error, no hay conflicto, no hay
 * traza — la configuración simplemente vuelve a como estaba.
 *
 * El caso concreto que lo hace probable, no teórico: el re-cifrado de
 * credenciales corre **desde una lectura** y en segundo plano (`.catch()`), o
 * sea disparado por una conversación cualquiera. Un dueño guardando su
 * configuración de SSO en ese momento la ve desaparecer; o al revés, su guardado
 * pisa el re-cifrado y la credencial vuelve a quedar en claro.
 *
 * La técnica correcta ya estaba en el repositorio —`updateHealth` usa
 * `jsonb_set` y lo explica— y se usaba en **un** lugar. Acá queda como función,
 * para que usarla sea más fácil que escribir el patrón que pierde datos.
 */

/** Sólo nombres de rama simples: esto se interpola en el path del `jsonb_set`. */
const BRANCH_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,60}$/;

function assertBranch(branch: string): void {
    if (!BRANCH_RE.test(branch)) {
        throw new Error(`Nombre de rama inválido en tenant.settings: ${branch}`);
    }
}

/**
 * Reemplaza **una** rama de `tenant.settings` sin tocar las demás.
 *
 * El objeto entero nunca viaja: PostgreSQL hace el merge sobre la fila viva, así
 * que lo que otro módulo escribió mientras tanto sobrevive.
 */
export async function replaceTenantSettingsBranch(
    prisma: PrismaService,
    tenantId: string,
    branch: string,
    value: unknown,
): Promise<void> {
    assertBranch(branch);
    const affected = await prisma.$executeRawUnsafe(
        `UPDATE public.tenants
            SET settings = jsonb_set(
                COALESCE(settings, '{}'::jsonb), $2::text[], $3::jsonb, true
            ),
            updated_at = NOW()
          WHERE id = $1::uuid`,
        tenantId,
        `{${branch}}`,
        JSON.stringify(value ?? null),
    );
    if (Number(affected) !== 1) throw new NotFoundException('Tenant not found');
}

/**
 * Fusiona claves dentro de una rama, conservando las que no se nombran.
 *
 * Es lo que necesita el re-cifrado: reescribe `apiKey` y `apiSecret` y deja
 * intacto todo lo demás de esa rama, incluso lo que otro proceso acabe de
 * cambiar. Con el patrón anterior, re-cifrar la credencial de Hostaway podía
 * revertir el intervalo de sincronización que el dueño había guardado un
 * segundo antes.
 */
export async function mergeTenantSettingsBranch(
    prisma: PrismaService,
    tenantId: string,
    branch: string,
    patch: Record<string, unknown>,
): Promise<void> {
    assertBranch(branch);
    if (!patch || !Object.keys(patch).length) return;
    const affected = await prisma.$executeRawUnsafe(
        `UPDATE public.tenants
            SET settings = jsonb_set(
                COALESCE(settings, '{}'::jsonb),
                $2::text[],
                COALESCE(settings #> $2::text[], '{}'::jsonb) || $3::jsonb,
                true
            ),
            updated_at = NOW()
          WHERE id = $1::uuid`,
        tenantId,
        `{${branch}}`,
        JSON.stringify(patch),
    );
    if (Number(affected) !== 1) throw new NotFoundException('Tenant not found');
}

/**
 * Lo mismo, un nivel más adentro: `settings.rama.hoja = valor`.
 *
 * Las integraciones verticales guardan un proveedor por hoja, y reescribir la
 * rama entera para tocar Toast borraba lo que se hubiera guardado de Cliniko en
 * el mismo instante.
 */
export async function replaceTenantSettingsLeaf(
    prisma: PrismaService,
    tenantId: string,
    branch: string,
    leaf: string,
    value: unknown,
): Promise<void> {
    assertBranch(branch);
    assertBranch(leaf);
    // `jsonb_set` con `create_missing` crea la hoja y, si la rama no existe,
    // también la rama — pero sólo si el padre existe. El `COALESCE` de la rama
    // se hace en dos pasos por eso: primero se garantiza la rama, después la
    // hoja. Las dos corren en la misma sentencia contra la fila viva.
    const affected = await prisma.$executeRawUnsafe(
        `UPDATE public.tenants
            SET settings = jsonb_set(
                jsonb_set(
                    COALESCE(settings, '{}'::jsonb),
                    $2::text[],
                    COALESCE(settings #> $2::text[], '{}'::jsonb),
                    true
                ),
                $3::text[], $4::jsonb, true
            ),
            updated_at = NOW()
          WHERE id = $1::uuid`,
        tenantId,
        `{${branch}}`,
        `{${branch},${leaf}}`,
        JSON.stringify(value ?? null),
    );
    if (Number(affected) !== 1) throw new NotFoundException('Tenant not found');
}

/** Borra una hoja: `settings.rama.hoja`. Usado al cambiar de proveedor. */
export async function deleteTenantSettingsLeaf(
    prisma: PrismaService,
    tenantId: string,
    branch: string,
    leaf: string,
): Promise<void> {
    assertBranch(branch);
    assertBranch(leaf);
    await prisma.$executeRawUnsafe(
        `UPDATE public.tenants
            SET settings = jsonb_set(
                COALESCE(settings, '{}'::jsonb),
                $2::text[],
                COALESCE(settings #> $2::text[], '{}'::jsonb) - $3::text,
                true
            ),
            updated_at = NOW()
          WHERE id = $1::uuid`,
        tenantId,
        `{${branch}}`,
        leaf,
    );
}
