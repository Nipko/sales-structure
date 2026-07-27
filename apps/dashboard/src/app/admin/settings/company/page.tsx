"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Página retirada — redirige a Información del negocio.
 *
 * Esta pantalla guardaba nombre/industria/web/contacto con `PUT /settings`,
 * que persiste en la tabla GLOBAL `platform_settings`: nada quedaba guardado
 * en el tenant (la industria real vive en `tenants.industry`) y un
 * `tenant_admin` podía sobrescribir configuración compartida de la
 * plataforma. Además nunca estuvo registrada en `_settings-config.ts`, así
 * que no era alcanzable desde el hub de Configuración.
 *
 * La página viva y registrada es `/admin/settings/business-info`: cubre los
 * mismos campos (y más) y escribe en el tenant vía el módulo business-info.
 * Se deja este stub en vez de borrar la ruta para no romper marcadores ni
 * enlaces viejos.
 */
export default function CompanyPageRedirect() {
    const router = useRouter();

    useEffect(() => {
        router.replace("/admin/settings/business-info");
    }, [router]);

    return null;
}
