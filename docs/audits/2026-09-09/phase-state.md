# Dónde está cada fase, y con qué evidencia

Este documento existe porque «avanzamos mucho» no es un estado. Cada fila dice
qué se cerró, con qué tipo de evidencia, y —cuando queda algo— qué exactamente.

Tres tipos de evidencia, y la diferencia importa:

- **`derived`** — lo calcula el código desde su propia autoridad. Nadie puede
  mejorarlo editando una etiqueta.
- **`executed_evidence`** — corrió, contra PostgreSQL/pgvector/Valkey reales o
  contra un navegador real, y dejó números.
- **`declared`** — lo afirma una persona. Es el más débil y está marcado como
  tal a propósito.

Revisión: la que diga `git rev-parse HEAD` cuando se lea. Los artefactos
generados (`closure-state`, `closure-report`, `certification-manifest`) llevan la
suya y `npm run verify:artifacts` falla si se separan del código.

## Estado por fase

| Fase | Estado | Evidencia | Qué queda |
|---|---|---|---|
| 2 — G1, dónde descansan las palabras del agente | **cerrada** | `derived`: `openAgentOutputStores()` = 0 sobre 20 stores, leído por `closure-state`. `executed_evidence`: retracción y borrado probados contra PostgreSQL en los cinco stores de evidencia y en el recibo del CRM externo | — |
| 3 — D2, calidad semántica bajo carga | **cerrada localmente** | `executed_evidence`: dataset etiquetado, 17 casos × 4 idiomas × 7 desafíos contra pgvector real, dos tamaños de corpus, barrido de umbral, carga concurrente con dos tenants, retiro en vuelo, índice y embedding degradados. Números en `docs/runbooks/rag-quality-and-slo.md` | El recall **semántico** necesita el modelo real: queda en el gate de LLM. `semanticEntailment` sigue en `not_evaluated` |
| 4 — E2, lectores comerciales congelados | **cerrada con excepciones declaradas** | `derived`: 30 de 34 grupos son comerciales, 19 con autoridad congelada entera, calculado desde la regla del manifiesto. `executed_evidence`: precio, stock, política y términos editados en vuelo hacen que la evidencia se rechace nombrando la tabla; dos tenants, dos workers, sellos ajenos y adulterados rechazados | Tres lecturas sin congelar —el reloj del proceso, el de la base y el espejo del channel manager— aceptadas **con motivo escrito** y sólo sobre dimensiones que una ventana de validez puede mover |
| 5 — ejecutor de certificación | **cerrada localmente** | `executed_evidence`: los 76 perfiles planificados, particionados, procesados por el worker real y reportados por perfil, con gasto cero. Recuperación de leases vencidos. Paridad de schema bajo las tres rutas | C3/F1 siguen bloqueadas **sólo** por el gate de LLM. La progresión de 4 etapas está escrita y no lanzada |
| 6 — benchmark operable | **cerrada localmente** | `executed_evidence`: techo, deadline, cancel, pause/resume y recuperación por lease probados; reserva antes de llamar al modelo; revisión ciega; rechazo de corpus derivado | Cuentas externas y revisores humanos siguen siendo el único gate |
| 7 — Playwright | **cerrada localmente** | `executed_evidence`: 168 pruebas, landing y dashboard, escritorio y móvil, cuatro idiomas, cuatro roles, aislamiento de tenant, teclado, landmarks, contraste medido con axe en los dos temas, reflow a 320 px y al 200 %, cero hostnames productivos y cero requests no declaradas. Dos corridas completas seguidas en verde | Publicar el agente se cubre como **destino** del traspaso, no como acto: `publication.agent.publish` abre `/admin/agent` y ahí se detiene. Las secciones del editor (herramientas, conocimiento, políticas, horario) se cubren por su pantalla, no campo por campo |
| 8 — revisión adversarial | **cerrada localmente** | `derived`: barrido de los 125 controllers en tres categorías, cada excepción con su motivo; barrido mecánico del diff entero contra las clases de defecto que este repositorio ya conoce (cadena opcional corta, `$n` sin cast, `NOW()` en vencimientos, ruta sin guarda, clave i18n en menos de cuatro idiomas). `executed_evidence`: los 35 commits que cambian runtime leídos, los de dinero y privacidad línea por línea; cuatro huecos reales cerrados —uno de comportamiento, dos de cobertura y una etiqueta que contradecía a quien puede abrir la página—, cada uno con su prueba y su mutación | — |
| 9 — verificación integral | **cerrada** | `executed_evidence`: tsc en frío en api/dashboard/whatsapp/landing/mobile/shared; builds de los cinco; bootstrap de Nest; **tres órdenes de suite** (por defecto, semilla 4711, semilla 90210) con 602 suites y 6.553 pruebas, cero falladas y **cero omitidas**; migraciones bajo escritura concurrente; `git diff --check` limpio; artefactos regenerados sin diff | — |
| 10 — rama de revisión y draft PR | **pendiente de la verificación integral** | — | Su condición —«cuando haya cero pendientes locales»— ya se cumple en fases. Falta repetir la fase 9 entera sobre este HEAD: la tanda tocó API, dashboard, shared y e2e, y una verificación de hace tres días no dice nada sobre este código |
| 11 — staging | **bloqueada** | — | Requiere credenciales de staging |

## Lo que esta tanda encontró y arregló

Nada de esto se buscó: cada uno apareció porque algo que antes no se medía
empezó a medirse.

1. **`similarityThreshold` no era un umbral.** Una señal de puntaje graduada se
   usaba como permiso de admisión, así que una palabra compartida metía un chunk
   con cualquier corte. La forma de la evidencia fue la curva: la abstención
   subía a 0,6 y se quedaba plana. `executed_evidence`.
2. **Planificar el catálogo tardaba 43 segundos con una transacción abierta.**
   78.120 INSERT de a uno contra el schema del tenant; bajo PgBouncer, una
   conexión que nadie más podía tener. Ahora tarda menos de 4.
3. **El benchmark pagaba dos veces por el mismo trabajo.** Llamaba al modelo y
   recién entonces insertaba con `ON CONFLICT DO NOTHING`: un job reintentado
   volvía a contestar todo y tiraba la respuesta.
4. **El techo del benchmark se pasaba por una tarea.** La condición dejaba correr
   una tarea más cuando lo gastado igualaba exactamente el techo.
5. **Un `tenant_agent` podía desconectar el CRM del negocio.** `TenantGuard` sin
   `RolesGuard` contesta «¿es tu tenant?» y nunca «¿podés hacer esto en él?».
6. **Los campos del login no tenían etiqueta asociada** y el selector de idioma
   no tenía nombre accesible: un lector de pantalla decía «edit text».
7. **La suite de navegación ya estaba roja en `main`** porque la tarjeta de
   puesta en marcha empezó a preguntarle a Assist qué falta y nadie lo declaró.
8. **Un error de tipos del dashboard** que la compilación incremental venía
   salteando.

### Lo que encontró abrir el navegador al recorrido completo (fase 7)

9. **Assist mandaba a pantallas que el panel esconde.** La lista de traspasos
   iba al modelo sin filtrar ni por rol ni por rubro, mientras la lista de
   creaciones justo encima sí filtraba por rol. Un agente de inbox recibía
   «andá a `/admin/users` y concedé el rol»; un restaurante, «andá a
   `/admin/appointments`». El panel rebotaba a los dos. Y `catalogue.course.create`
   no tiene ni cuota ni flag, así que el dueño de un restaurante podía pedirle a
   Assist un curso, aplicarlo, y escribir una fila en una tabla cuya pantalla no
   puede abrir: creado, auditado e inalcanzable.
10. **La ventana de OAuth de Instagram no se rendía nunca.** El canje no tenía
    plazo en ninguna parte —ni en la página ni en `api.ts`—, así que un API o un
    Meta lento la dejaban girando para siempre, sin mensaje ni salida, y con la
    pantalla que la abrió esperando un resultado que no llegaba.
11. **Y acusaba de CSRF a quien acababa de conectar.** El guardia de reintento
    estaba DESPUÉS de consumir el par CSRF, así que la segunda corrida del
    efecto no encontraba nada guardado y reportaba un ataque. En desarrollo eso
    era cada conexión de Instagram.
12. **Los cuatro campos del alta no tenían etiqueta asociada.** La primera
    pantalla del producto le decía «edit text» cuatro veces a un lector de
    pantalla, y el clic en la etiqueta no enfocaba nada.
13. **Ocho textos por debajo de 4,5:1**, medidos con axe en los dos temas: las
    cinco secciones del menú (2,58:1 en claro), el pie del login (2,47:1), el
    distintivo que dice si los números de la pantalla son reales (1,86:1) y el
    chip de canal del asistente (3,35:1).
14. **El asistente de puesta en marcha se colgaba con un espacio de trabajo
    incompleto**: `current?.operational.body` es opcional un nivel y después no,
    así que la excepción se iba al límite de error del recorrido y dejaba la
    única pantalla que una cuenta nueva no puede saltear girando sin mensaje.

### Lo que encontró leer los commits uno por uno (fase 8)

15. **Un rechazo con número y sin moneda no se contaba.** El cobro de una cita
    lee `COALESCE(amount_due, <precio acordado>)`, y `amount_due` —la columna de
    la seña— es anterior al atado de términos. Una fila creada entre las dos
    vuelve con un número y una moneda nula: el resolutor la rechaza bien, por el
    chequeo de tres letras, y `isMissingAgreedTermsRefusal` sólo miraba el
    importe. O sea que ese rechazo era mudo: una persona con un enlace de seña
    que no funciona, sin avisarle a nadie, idéntico a un error de tipeo en la
    referencia — que es justamente la distinción que esa función existe para
    hacer.
16. **El cobro de citas estaba probado por su texto SQL, no por su
    comportamiento.** La familia hermana —pedidos de catálogo— se probó contra
    PostgreSQL real, positivo y negativo; la que más vende se probó con un grep.
    Ahora tiene sus cinco casos sobre el DDL de producción, y la mutación que
    devuelve el precio de catálogo al camino del dinero los pone en rojo.
17. **La guarda `to_regclass` no tenía prueba de la rama que existe para
    cubrir.** Se agregó a los cuatro lectores de `outbound_payloads` sin un solo
    caso con la tabla ausente, que es exactamente cuando importa: estas
    funciones corren dentro de la transacción de otro —un borrado, un retiro— y
    una consulta contra una relación inexistente aborta todo lo que sigue.
18. **Una página decía ser de plataforma y era la única que la plataforma no
    podía abrir.** `/admin/channels/certification` se registró con
    `scope: "platform"` mientras el API la sirve a tres roles de tenant y
    `roles.ts` la alcanza por la regla de `/admin/channels`, que admite al
    administrador del tenant y al super_admin sólo mientras impersona.

## Cómo reproducir todo esto

- Suite completa, sin nada omitido: `docs/runbooks/full-api-suite.md`.
- Calidad de recuperación y sus umbrales: `docs/runbooks/rag-quality-and-slo.md`.
- Carga y SLO de despacho: `docs/runbooks/dispatch-load-and-slo.md`.
- Navegador: `cd apps/e2e && npx playwright test` (168 pruebas, dos proyectos
  de dashboard —escritorio y Pixel 7— más el landing).
- Artefactos: `npm run verify:artifacts` desde la raíz.

## Lo que sigue sin estar hecho, dicho sin adornos

El programa **no** está listo para publicar. Lo que falta:

- **Publicar el agente, como acto.** La fase 7 recorre el circuito hasta guardar
  el borrador y ofrecer probarlo. Publicar sale hacia los clientes del tenant y
  vive en su propia pantalla; el traspaso llega hasta la puerta y se detiene ahí,
  que es lo que el registro promete y no más.
- **Certificar un solo perfil.** El catálogo de 76 sigue en cero y la corrida
  entera cuesta US$677,40 en 139.940 llamadas: necesita una autorización
  explícita de modelo y de techo que nadie ha dado.
- **Staging.** Requiere credenciales que no existen acá.

Lo que sí está: las diez fases locales cerradas, con la evidencia que dice cada
fila y con el tipo de evidencia declarado. Ninguna se cierra por haber construido
la infraestructura que la mediría.

Y por encima de las dos: **ningún perfil está certificado**. El catálogo de 76
sigue en cero, la corrida completa cuesta US$677,40 en 139.940 llamadas, y eso
necesita una autorización explícita de modelo y de techo que nadie ha dado.
