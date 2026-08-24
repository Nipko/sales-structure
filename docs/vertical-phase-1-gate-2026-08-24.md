# Gate 1 — taxonomía y preflight vertical

Fecha de corte: 24 de agosto de 2026
Estado: **código completo; cierre operativo condicionado a ejecutar el inventario read-only en producción**.

## Resultado

La Fase 1 quedó implementada sin escrituras sobre tenants, sin migraciones de datos y sin activar capacidades comerciales nuevas:

- **20 verticales canónicas**;
- **76 configuraciones canónicas**: 75 subtipos más `otro`;
- **81 IDs resolubles**: las 76 configuraciones canónicas y cinco IDs heredados compatibles;
- cuatro fuentes ambiguas disponen de clasificación versionada: `finanzas/fintech`, `fotografia/wedding_planner`, `inmobiliaria/construccion` y `technology/consultoria_ti`;
- los destinos nuevos siguen en `waitlist` y no aparecen en onboarding ni en creación administrativa;
- `SUBTYPE_TAXONOMY_MIGRATION_APPLY_SUPPORTED` permanece en `false`.

El quinto ID heredado, `veterinaria/peluqueria_canina`, conserva resolución compatible hacia el perfil canónico existente `pet_services/peluqueria`; por eso no forma parte del clasificador ambiguo.

## Controles implementados

### TAX-01 — catálogo objetivo y compatibilidad

- El manifest compartido y el registro de experiencia distinguen `canonical` de `legacy`.
- Los agentes persistidos con versiones anteriores siguen resolviendo mediante el manifest vigente; no se exige una variable nueva para arrancar.
- El API expone por separado los conteos de payload, configuraciones canónicas, perfiles canónicos e IDs resolubles.
- La landing conserva el claim comprobable de 18 verticales públicas; las dos verticales nuevas no se anuncian mientras estén en `waitlist`.

### TAX-02 — clasificador puro

- Solo acepta `businessModel` estructurado y consentimiento explícito del owner.
- No infiere el negocio desde prompts, FAQs, descripciones, conversaciones ni otras fuentes libres.
- Admite destinos múltiples para promotora/contratista y MSP/consultoría de proyectos.
- Devuelve razones tipadas y estados `candidate`, `needs_owner` o `approved`; aun `approved` no habilita escritura.

### TAX-03 — inventario read-only

- El endpoint `GET /verticals/taxonomy-migrations/inventory` está restringido a `super_admin`.
- La consulta lee únicamente `id`, `industry` y `settings` para clasificar; la respuesta no expone nombre, correo, teléfono, schema ni el documento completo de settings.
- Todos los registros afectados reciben un estado y razones tipadas.
- El servicio no contiene ruta de aplicación, actualización, inserción ni borrado.

## Evidencia de verificación

| Control | Resultado |
|---|---:|
| TypeScript: shared, API, dashboard y landing | 4/4 limpios |
| API Jest | 365 suites pasaron, 1 omitida; 3.547 tests pasaron, 10 omitidos |
| Dashboard Jest | 31 suites y 275 tests pasaron |
| Contratos de claims públicos | 3/3 pasaron para 18 verticales públicas y cuatro idiomas |
| Browser E2E | 24/24 escenarios reportaron éxito; el runner local Windows conservó procesos de desarrollo abiertos al terminar y fue detenido después de completarlos |
| `git diff --check` | limpio |

Para el smoke de arranque de Nest se usaron `JWT_SECRET`, `JWT_REFRESH_SECRET` y `ENCRYPTION_KEY` efímeros dentro del proceso de Jest. No se crearon archivos `.env`, no se cambiaron secretos persistidos y no se volvió obligatoria ninguna variable nueva.

## Pendiente obligatorio para cerrar el Gate 1 operativo

El workspace no tiene `DATABASE_URL` ni `DIRECT_DATABASE_URL` configuradas. Antes de comenzar una migración real o abrir un destino nuevo se debe:

1. desplegar esta versión en un entorno con acceso read-only al catálogo global de tenants;
2. ejecutar `GET /verticals/taxonomy-migrations/inventory` como `super_admin`;
3. guardar solo el agregado y el registro de owners en el artefacto privado de release;
4. asignar owner a cada fila `needs_owner` o `candidate`;
5. confirmar que la suma por estado coincide con `affected`;
6. mantener `applySupported=false` hasta el Gate 7 de migración y canary.

Este pendiente no bloquea el diseño de contratos de la Fase 2. Sí bloquea cualquier migración de tenants, publicación de los destinos `waitlist` o creación de un ejecutor `apply`.
