/**
 * Un `$executeRawUnsafe` de mentira que hace lo que hace PostgreSQL con los
 * `jsonb_set` de `tenant-settings-branch.util.ts`.
 *
 * Existe porque las escrituras de configuración pasaron de un
 * `tenant.update({ settings: {...todo} })` —que en una prueba es una asignación
 * y en producción **pierde lo que otro módulo escribió en el medio**— a un
 * merge sobre la fila viva. Las pruebas que verifican qué queda guardado
 * necesitan ver el resultado de ese merge, no el de la asignación.
 *
 * Deliberadamente NO parsea SQL: reconoce las cuatro formas que la utilidad
 * emite y aplica su semántica. Un intérprete de SQL a medias daría confianza
 * falsa sobre consultas que nunca corrió nadie.
 */
export function fakeSettingsWriter(read: () => Record<string, any>,
    write: (next: Record<string, any>) => void) {
    return async (sql: string, ...params: any[]): Promise<number> => {
        if (!/UPDATE public\.tenants/.test(sql)) return 0;
        const settings = { ...(read() || {}) };

        // deleteTenantSettingsLeaf: `... - $3::text`
        if (/- \$3::text/.test(sql)) {
            const branch = String(params[1]).replace(/[{}]/g, '');
            const leaf = String(params[2]);
            const current = { ...(settings[branch] || {}) };
            delete current[leaf];
            settings[branch] = current;
            write(settings);
            return 1;
        }

        // replaceTenantSettingsLeaf: dos `jsonb_set` anidados, path de dos niveles
        if (/jsonb_set\(\s*jsonb_set\(/.test(sql)) {
            const [, branchPath, leafPath, json] = params;
            const branch = String(branchPath).replace(/[{}]/g, '');
            const leaf = String(leafPath).replace(/[{}]/g, '').split(',')[1];
            settings[branch] = { ...(settings[branch] || {}), [leaf]: JSON.parse(json) };
            write(settings);
            return 1;
        }

        // mergeTenantSettingsBranch: `|| $3::jsonb`
        if (/\|\| \$3::jsonb/.test(sql)) {
            const branch = String(params[1]).replace(/[{}]/g, '');
            settings[branch] = { ...(settings[branch] || {}), ...JSON.parse(params[2]) };
            write(settings);
            return 1;
        }

        // replaceTenantSettingsBranch
        const branch = String(params[1]).replace(/[{}]/g, '');
        settings[branch] = JSON.parse(params[2]);
        write(settings);
        return 1;
    };
}
