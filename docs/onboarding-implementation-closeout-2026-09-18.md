# Cierre de implementación del onboarding — 18 de septiembre de 2026

Estado: implementación terminada en `feat/onboarding-guided-experience`; sin despliegue. Este documento separa lo que quedó construido de la evidencia externa necesaria antes de ampliar el lanzamiento.

## Resultado construido

El recorrido corto ya mantiene una sola guía hasta una respuesta real, conserva el avance en servidor y distingue ensayo, conexión, atención operativa y resultado. El cierre no afirma que un canal responde solo porque fue autorizado: usa la primera respuesta reactiva atribuible y conserva los estados desconocidos.

La receta del rubro ahora llega al dueño en cuatro preguntas —oferta, lugar/horario, compra o reserva y preguntas frecuentes— y **Usar esta base** modifica la configuración canónica que sirve el agente. Las preguntas sugeridas prueban esa receta; una respuesta incorrecta se corrige hacia una FAQ publicada. Los precios sembrados siguen marcados como ejemplo o cotización y su presentación de día 0 nunca expone un importe como confirmado.

La conexión respeta plan y preferencia, registra el aplazamiento por canal y permite retomar en el punto correcto. El enlace público exige una elección explícita entre prueba y atención de clientes; el cambio de plan no cambia esa intención silenciosamente. La finalización muestra el receptor humano real, incluido el dueño de un negocio unipersonal.

El editor posterior reutiliza el lenguaje de las cuatro preguntas y puede abrir Assist con una propuesta contextual que la persona todavía debe revisar. Salud responde si atiende y dónde, qué sabe y puede hacer, qué resultados tienen evidencia y cuál es la siguiente acción. Falta de tráfico, muestra insuficiente y resultado observado permanecen separados.

Se instrumentaron hitos y abandonos del recorrido, incluida la primera prueba y la primera atención real. Las rutas opcionales del cierre llevan a documentos con texto legible, aprendizaje revisado desde conversaciones que ya están en Parallly y simulaciones. Fotos, audios e historial alojado únicamente en otro proveedor no se anuncian como importables. Salud ofrece la suscripción existente a reportes semanales o mensuales por correo y declara que el resumen por WhatsApp aún requiere consentimiento, control de costo y entrega comprobable.

La ayuda de Parallly Assist quedó alineada en español, inglés, portugués y francés. Los contratos nuevos de receta, guardado no destructivo, accesibilidad, Salud y ayuda forman parte de `deploy.yml` y `vertical-quality.yml`.

## Commits de cierre

- `eb025fcc` — guía honesta del día 0.
- `2277bbbd` — medición de resultados del recorrido.
- `f9ba4570` — primera atención real comprobada.
- `55ca8dcb` — intención explícita del enlace público.
- `a188ecae` — receta aplicada y corrección desde la prueba.
- `7c98cf7e` — aplazamientos conservados por canal.
- `c1c7749a` — Salud organizada por preguntas del negocio.
- `24bf4c33` — misma guía en editor y Assist.
- `e69c4cc9` — entradas opcionales verificables.
- `7db70d25` — contratos de recetas, ayuda y CI.
- `bde92d07` — resumen periódico voluntario y límite de WhatsApp.

## Evidencia técnica final

- TypeScript de API y dashboard: aprobado.
- API focal: 4 suites, 133 pruebas aprobadas.
- Dashboard focal: 11 suites, 81 pruebas aprobadas.
- JSON de los cuatro idiomas: válido.
- YAML de ambos workflows: válido.
- `git diff --check`: aprobado.

La advertencia de navegación que imprime jsdom en `setup-wizard-one-guide.a11y.spec.tsx` corresponde a `window.location.href`; la suite aprueba y no representa un fallo de aplicación.

## Evidencia que todavía debe obtenerse fuera del código

Estas actividades son puertas de lanzamiento, no funcionalidades que puedan declararse realizadas desde el repositorio:

1. Dos rondas moderadas con dueños, incluidas personas que usan solo celular, interrupción y reanudación, 320 px, teclado y lector de pantalla.
2. Recorridos reales y fallidos de WhatsApp, Instagram, Messenger, Telegram y chat web con credenciales, permisos y retornos de proveedor válidos.
3. Verificación en entorno candidato de migraciones, rollback, colas, correo y conservación del estado entre dispositivos.
4. Medición de primera respuesta útil, primera atención operativa y primer resultado verificable a 7 y 28 días. Las metas de tres y diez minutos siguen siendo hipótesis hasta tener esas cohortes.
5. Decisión de producto sobre captura revisable por foto/voz y resumen por WhatsApp solo si la investigación demuestra valor y existen consentimiento, costos y entrega seguros.

No se debe presentar la experiencia como validada por usuarios o certificada por proveedores hasta completar esas puertas. Tampoco se debe desplegar por el solo hecho de que las pruebas focales pasen.
