"use client";

import Link from "next/link";

export default function TermsEs() {
  return (
    <>
      {/* Back link */}
      <Link
        href="/"
        className="inline-flex items-center gap-2 text-sm text-text-muted hover:text-accent transition-colors mb-12"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M19 12H5M12 19l-7-7 7-7" />
        </svg>
        Volver al inicio
      </Link>

      {/* Title */}
      <h1 className="text-4xl font-bold tracking-tight mb-4">
        Términos y Condiciones
      </h1>
      <p className="text-text-muted text-sm mb-12">
        Última actualización: 29 de abril de 2026
      </p>

      <div className="space-y-12 text-text-secondary leading-relaxed">
        {/* Intro */}
        <p>
          Estos Términos y Condiciones (en adelante, los &quot;Términos&quot;)
          regulan el acceso y uso de la plataforma{" "}
          <strong className="text-text-primary">Parallly</strong>{" "}
          (parallly-chat.cloud), operada por{" "}
          <strong className="text-text-primary">Automation AI S.A.S</strong>{" "}
          (NIT: 902032943-1), con domicilio en Bogotá, Colombia. Al acceder o
          utilizar el servicio, aceptas estos Términos en su totalidad.
        </p>

        {/* 1 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            1. Aceptación de los términos
          </h2>
          <p className="mb-4">
            Al crear una cuenta, acceder o utilizar Parallly, declaras que:
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              Tienes al menos 18 años de edad y capacidad legal para celebrar
              contratos vinculantes.
            </li>
            <li>
              Actúas en nombre propio o como representante autorizado de una
              persona jurídica.
            </li>
            <li>
              Has leído, comprendido y aceptas estos Términos y nuestra{" "}
              <Link href="/privacy" className="text-accent hover:underline">
                Política de Privacidad
              </Link>
              .
            </li>
          </ul>
          <p className="mt-4">
            Si no estás de acuerdo con estos Términos, no debes utilizar el
            servicio.
          </p>
        </section>

        {/* 2 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            2. Descripción del servicio
          </h2>
          <p className="mb-4">
            Parallly es una plataforma de software como servicio (SaaS) de
            inteligencia artificial conversacional diseñada para automatizar las
            ventas y la atención al cliente a través de canales de mensajería,
            principalmente WhatsApp.
          </p>
          <p className="mb-4">
            El servicio incluye, entre otras funcionalidades:
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              Agentes de IA configurables que responden automáticamente a
              mensajes entrantes.
            </li>
            <li>
              Arquitectura multicliente con aislamiento de datos por
              organización.
            </li>
            <li>
              CRM integrado con bandeja de entrada, asignación de
              conversaciones y escalamiento a agentes humanos.
            </li>
            <li>
              Integración con múltiples proveedores de modelos de lenguaje
              (OpenAI, Anthropic, Google, entre otros).
            </li>
            <li>
              Panel de administración con métricas, configuración de personas y
              gestión de equipo.
            </li>
            <li>
              Integración nativa con WhatsApp Business API a través de Meta
              Cloud API.
            </li>
          </ul>
        </section>

        {/* 3 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            3. Registro y cuentas
          </h2>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              Para utilizar Parallly, debes crear una cuenta proporcionando
              información veraz, completa y actualizada.
            </li>
            <li>
              Eres responsable de mantener la confidencialidad de tus
              credenciales de acceso y de todas las actividades que se realicen
              bajo tu cuenta.
            </li>
            <li>
              Debes notificarnos inmediatamente cualquier uso no autorizado de
              tu cuenta.
            </li>
            <li>
              Nos reservamos el derecho de suspender o cancelar cuentas que
              violen estos Términos o que contengan información falsa.
            </li>
            <li>
              Cada organización puede tener múltiples usuarios con
              diferentes roles: administrador, supervisor y agente.
            </li>
          </ul>
        </section>

        {/* 4 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            4. Planes y precios
          </h2>
          <p className="mb-4">
            Los planes activos, precios, monedas, límites y funcionalidades
            vigentes se muestran en nuestra {" "}
            <Link href="/precios" className="text-accent hover:underline">
              página de precios
            </Link>
            {" "}y, cuando corresponda, en el panel de facturación antes de
            contratar o cambiar una suscripción. Esa información forma parte de
            la oferta aplicable a tu cuenta y puede variar por país.
          </p>
          <p className="text-text-muted text-sm">
            Nos reservamos el derecho de modificar los precios con un aviso
            previo de 30 días para suscripciones existentes, salvo que la ley
            aplicable exija un plazo distinto.
          </p>
        </section>

        {/* 5 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            5. Período de prueba
          </h2>
          <p>
            La disponibilidad, duración, funcionalidades y requisitos de pago de
            una prueba dependen del plan activo seleccionado y se muestran antes
            de activarla. Al finalizar, el acceso podrá limitarse hasta que
            actives una suscripción. No realizaremos un cargo automático sin una
            autorización de pago presentada y aceptada expresamente.
          </p>
        </section>

        {/* 6 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            6. Facturación y pagos
          </h2>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              Las suscripciones se facturan según el ciclo disponible que se
              muestre y confirmes antes de la compra.
            </li>
            <li>
              Los pagos se procesan a través de proveedores de pago certificados
              PCI DSS. No almacenamos datos de tarjetas de crédito en nuestros
              servidores.
            </li>
            <li>
              Las facturas se emiten electrónicamente conforme a la normativa
              colombiana vigente.
            </li>
            <li>
              Los precios no incluyen impuestos aplicables, los cuales se
              calcularán según la jurisdicción del cliente.
            </li>
            <li>
              En caso de impago, nos reservamos el derecho de suspender el
              servicio después de 7 días de vencimiento, y de cancelar la cuenta
              después de 30 días de impago continuado.
            </li>
            <li>
              No se realizan reembolsos por períodos parciales de uso, salvo en
              casos excepcionales evaluados individualmente.
            </li>
          </ul>
        </section>

        {/* 7 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            7. Uso aceptable
          </h2>
          <p className="mb-4">
            Al utilizar Parallly, te comprometes a no:
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              Enviar mensajes no solicitados (spam) ni comunicaciones masivas
              sin consentimiento previo del destinatario.
            </li>
            <li>
              Utilizar la plataforma para actividades ilegales, fraudulentas o
              que infrinjan derechos de terceros.
            </li>
            <li>
              Distribuir contenido que sea ilegal, difamatorio, obsceno,
              amenazante, que incite al odio o que viole derechos de propiedad
              intelectual.
            </li>
            <li>
              Intentar acceder a datos de otras organizaciones o eludir los mecanismos
              de seguridad de la plataforma.
            </li>
            <li>
              Realizar ingeniería inversa, descompilar o desensamblar cualquier
              parte del software.
            </li>
            <li>
              Exceder los límites de uso de tu plan (rate limits de API,
              conversaciones mensuales, etc.) mediante técnicas de evasión.
            </li>
            <li>
              Utilizar bots, scrapers u otras herramientas automatizadas para
              acceder al servicio fuera de las APIs proporcionadas.
            </li>
            <li>
              Revender, sublicenciar o redistribuir el servicio sin
              autorización escrita.
            </li>
          </ul>
          <p className="mt-4">
            El incumplimiento de estas normas puede resultar en la suspensión
            inmediata o cancelación de la cuenta, sin derecho a reembolso.
          </p>
        </section>

        {/* 8 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            8. Propiedad intelectual
          </h2>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              Parallly, incluyendo su software, diseño, logos, marcas y
              documentación, es propiedad exclusiva de Automation AI S.A.S o
              sus licenciantes.
            </li>
            <li>
              Se te otorga una licencia limitada, no exclusiva, no
              transferible y revocable para utilizar el servicio conforme a estos
              Términos y al plan contratado.
            </li>
            <li>
              No adquieres ningún derecho de propiedad sobre el software o la
              plataforma por el uso del servicio.
            </li>
            <li>
              Las configuraciones de agentes de IA, plantillas de personas
              (personas) y flujos creados por el cliente dentro de la plataforma
              son propiedad del cliente.
            </li>
          </ul>
        </section>

        {/* 9 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            9. Datos del cliente
          </h2>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              El cliente mantiene la propiedad sobre todos los datos que
              introduce, procesa o almacena a través de la plataforma (los
              &quot;Datos del Cliente&quot;).
            </li>
            <li>
              Parallly actúa como encargado del tratamiento de los Datos del
              Cliente conforme a nuestra{" "}
              <Link href="/privacy" className="text-accent hover:underline">
                Política de Privacidad
              </Link>{" "}
              y los acuerdos de procesamiento de datos aplicables.
            </li>
            <li>
              Nos comprometemos a no acceder, usar ni divulgar los Datos del
              Cliente excepto cuando sea necesario para: (a) proveer el
              servicio, (b) cumplir con obligaciones legales, o (c) con el
              consentimiento expreso del cliente.
            </li>
            <li>
              El cliente es responsable de obtener los consentimientos y
              autorizaciones necesarios de sus clientes finales (end-users) para
              el procesamiento de datos a través de la plataforma.
            </li>
            <li>
              En caso de terminación del servicio, el cliente podrá solicitar la
              exportación de sus datos dentro de los 30 días siguientes.
              Transcurrido este plazo, los datos serán eliminados de forma
              segura.
            </li>
          </ul>
        </section>

        {/* 10 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            10. Limitación de responsabilidad
          </h2>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              El servicio se proporciona &quot;tal cual&quot; y &quot;según
              disponibilidad&quot;, sin garantías de ningún tipo, expresas o
              implícitas.
            </li>
            <li>
              Parallly no garantiza que el servicio será ininterrumpido, libre
              de errores o que cumplirá con todos los requisitos específicos del
              cliente.
            </li>
            <li>
              No somos responsables de las respuestas generadas por los modelos
              de IA, las cuales pueden contener inexactitudes. El cliente es
              responsable de supervisar y validar el contenido generado.
            </li>
            <li>
              En ningún caso la responsabilidad total de Automation AI S.A.S
              excederá el monto total pagado por el cliente durante los 12 meses
              anteriores al evento que dio lugar a la reclamación.
            </li>
            <li>
              No seremos responsables por daños indirectos, incidentales,
              especiales, consecuentes o punitivos, incluyendo pérdida de
              beneficios, datos, uso o buena voluntad.
            </li>
            <li>
              Parallly no será responsable por interrupciones del servicio
              causadas por: (a) mantenimiento programado, (b) fuerza mayor, (c)
              fallas de proveedores terceros (Meta, proveedores de IA, hosting),
              o (d) acciones del cliente.
            </li>
          </ul>
        </section>

        {/* 11 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            11. Indemnización
          </h2>
          <p>
            El cliente se compromete a indemnizar, defender y mantener indemne a
            Automation AI S.A.S, sus directores, empleados, agentes y afiliados,
            de y contra cualquier reclamación, daño, pérdida, responsabilidad,
            costo y gasto (incluyendo honorarios de abogados) que surjan de o
            estén relacionados con: (a) el uso del servicio por parte del
            cliente, (b) la violación de estos Términos, (c) la violación de
            derechos de terceros, o (d) el contenido procesado a través de la
            plataforma por el cliente o sus usuarios finales.
          </p>
        </section>

        {/* 12 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            12. Terminación del servicio
          </h2>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              El cliente puede cancelar su suscripción en cualquier momento
              desde el panel de administración. La cancelación será efectiva al
              final del período de facturación vigente.
            </li>
            <li>
              Nos reservamos el derecho de suspender o cancelar el servicio
              inmediatamente en caso de: (a) violación de estos Términos, (b)
              actividad fraudulenta o ilegal, (c) impago continuado, o (d) por
              requerimiento legal.
            </li>
            <li>
              En caso de terminación, el cliente podrá exportar sus datos dentro
              de los 30 días siguientes. Transcurrido este plazo, todos los
              datos serán eliminados de forma segura.
            </li>
            <li>
              Las obligaciones de confidencialidad, propiedad intelectual,
              limitación de responsabilidad e indemnización sobrevivirán a la
              terminación.
            </li>
          </ul>
        </section>

        {/* 13 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            13. Modificaciones a los términos
          </h2>
          <p>
            Nos reservamos el derecho de modificar estos Términos en cualquier
            momento. Los cambios significativos serán notificados mediante un
            aviso en la plataforma o por correo electrónico con al menos 30 días
            de anticipación. El uso continuado del servicio después de la entrada
            en vigor de los cambios constituye la aceptación de los Términos
            modificados. Si no estás de acuerdo con las modificaciones, puedes
            cancelar tu suscripción antes de la fecha de entrada en vigor.
          </p>
        </section>

        {/* 14 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            14. Ley aplicable y resolución de disputas
          </h2>
          <p className="mb-4">
            Estos Términos se rigen e interpretan conforme a las leyes de la
            República de Colombia.
          </p>
          <p className="mb-4">
            Cualquier controversia que surja en relación con estos Términos será
            resuelta de la siguiente manera:
          </p>
          <ol className="list-decimal pl-6 space-y-2">
            <li>
              <strong className="text-text-primary">
                Negociación directa:
              </strong>{" "}
              las partes intentarán resolver la disputa de buena fe durante un
              período de 30 días hábiles.
            </li>
            <li>
              <strong className="text-text-primary">Mediación:</strong> si la
              negociación directa no resulta exitosa, las partes podrán acudir a
              un mediador designado de mutuo acuerdo.
            </li>
            <li>
              <strong className="text-text-primary">Arbitraje:</strong> como
              último recurso, la disputa será resuelta mediante arbitraje
              administrado por el Centro de Arbitraje y Conciliación de la
              Cámara de Comercio de Bogotá, conforme a su reglamento vigente. El
              laudo arbitral será definitivo y vinculante.
            </li>
          </ol>
        </section>

        {/* 15 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            15. Disposiciones generales
          </h2>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong className="text-text-primary">Acuerdo completo:</strong>{" "}
              estos Términos, junto con la Política de Privacidad y la Política
              de Tratamiento de Datos, constituyen el acuerdo completo entre las
              partes y reemplazan cualquier acuerdo anterior.
            </li>
            <li>
              <strong className="text-text-primary">Divisibilidad:</strong> si
              alguna disposición de estos Términos es declarada inválida o
              inaplicable, las demás disposiciones permanecerán en pleno vigor y
              efecto.
            </li>
            <li>
              <strong className="text-text-primary">Cesión:</strong> el cliente
              no podrá ceder ni transferir estos Términos sin el consentimiento
              previo por escrito de Automation AI S.A.S.
            </li>
            <li>
              <strong className="text-text-primary">
                Renuncia:
              </strong>{" "}
              la falta de ejercicio de cualquier derecho bajo estos Términos no
              constituirá una renuncia a dicho derecho.
            </li>
            <li>
              <strong className="text-text-primary">
                Fuerza mayor:
              </strong>{" "}
              ninguna de las partes será responsable por el incumplimiento
              causado por eventos fuera de su control razonable, incluyendo
              desastres naturales, pandemias, guerras, actos de gobierno o
              fallas de infraestructura de terceros.
            </li>
            <li>
              <strong className="text-text-primary">Notificaciones:</strong> las
              notificaciones legales se enviarán al correo electrónico
              registrado en la cuenta del cliente. Las notificaciones a
              Automation AI S.A.S deben dirigirse a{" "}
              <a
                href="mailto:cloud.manager@parallext.com"
                className="text-accent hover:underline"
              >
                cloud.manager@parallext.com
              </a>
              .
            </li>
          </ul>
        </section>

        {/* 16 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            16. Cumplimiento de las políticas de Meta y obligaciones del
            cliente
          </h2>
          <p className="mb-4">
            Cuando el cliente conecta WhatsApp, Instagram o Messenger a
            Parallly, el cliente se convierte en el responsable de cumplir con
            las políticas de Meta Platforms, Inc. que rigen dichos productos.
            Parallly proporciona la infraestructura técnica, pero no controla
            el contenido del mensaje, la audiencia ni la intención comercial
            decidida por el cliente.
          </p>

          <h3 className="text-lg font-semibold text-text-primary mt-6 mb-3">
            Políticas de Meta aplicables al cliente
          </h3>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong className="text-text-primary">
                Meta Platform Terms (DFC):
              </strong>{" "}
              términos generales que regulan el uso de las plataformas de Meta
              por parte de desarrolladores y empresas.
            </li>
            <li>
              <strong className="text-text-primary">
                Meta Developer Policies:
              </strong>{" "}
              normas de desarrollo, seguridad de datos y uso de las APIs de
              Meta.
            </li>
            <li>
              <strong className="text-text-primary">
                WhatsApp Business Solution Provider Terms:
              </strong>{" "}
              condiciones específicas que rigen el uso de la WhatsApp Business
              Platform a través de un proveedor de soluciones.
            </li>
            <li>
              <strong className="text-text-primary">
                WhatsApp Business Messaging Policy:
              </strong>{" "}
              ventana de servicio de 24 horas, requisitos de opt-in y
              categorías de mensaje (utility / authentication / marketing /
              service).
            </li>
            <li>
              <strong className="text-text-primary">
                WhatsApp Commerce Policy:
              </strong>{" "}
              lista de bienes y servicios prohibidos en WhatsApp.
            </li>
            <li>
              <strong className="text-text-primary">
                Instagram Platform Policy:
              </strong>{" "}
              normas aplicables a la mensajería e integraciones de Instagram.
            </li>
            <li>
              <strong className="text-text-primary">
                Messenger Platform Policy:
              </strong>{" "}
              normas aplicables a la mensajería e integraciones de Messenger.
            </li>
          </ul>

          <h3 className="text-lg font-semibold text-text-primary mt-6 mb-3">
            Obligaciones específicas del cliente
          </h3>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              Obtener un opt-in explícito de cada usuario final antes de
              iniciar conversaciones salientes en WhatsApp, Instagram o
              Messenger, y conservar la prueba de dicho opt-in.
            </li>
            <li>
              Respetar las palabras clave de baja (STOP, BAJA, CANCELAR, etc.).
              El pipeline de cumplimiento de Parallly las detecta, pero la
              decisión final de honrarlas continúa siendo un deber legal del
              cliente.
            </li>
            <li>
              Utilizar únicamente plantillas de mensaje (Message Templates)
              aprobadas por Meta para los mensajes salientes de WhatsApp fuera
              de la ventana de servicio de 24 horas.
            </li>
            <li>
              No enviar contenido prohibido (bienes ilegales, drogas, armas,
              contenido sexual, discurso de odio, fraudes financieros, etc.).
            </li>
            <li>
              Mantener un nombre comercial, perfil de empresa e información de
              contacto exactos en los canales conectados.
            </li>
            <li>
              Desconectar o actualizar de inmediato los canales si Meta degrada
              la calificación de calidad, suspende o notifica la cuenta.
            </li>
            <li>
              Mantener su propia política de privacidad y términos de servicio
              públicos y consistentes con los requisitos de Meta para empresas
              en sus plataformas.
            </li>
          </ul>

          <h3 className="text-lg font-semibold text-text-primary mt-6 mb-3">
            Indemnización
          </h3>
          <p>
            El cliente indemniza y mantiene indemne a Parallly frente a
            cualquier multa, suspensión, sanción de calidad de cuenta, demanda
            o daño impuesto por Meta Platforms o por terceros como consecuencia
            directa o indirecta de: (a) el uso indebido de los canales
            conectados por parte del cliente, (b) la violación por parte del
            cliente de cualquier política de Meta enumerada anteriormente, (c)
            la falta de obtención de opt-in de los usuarios finales por parte
            del cliente, o (d) el contenido que el cliente o sus agentes
            publiquen a través de Parallly.
          </p>

          <h3 className="text-lg font-semibold text-text-primary mt-6 mb-3">
            Suspensión por incumplimiento
          </h3>
          <p>
            Parallly se reserva el derecho de suspender o terminar el acceso a
            los canales afectados (o a la cuenta completa) si recibe una
            notificación creíble de Meta sobre violaciones reiteradas o graves
            de sus políticas, o si detecta abusos a través de su monitoreo
            interno. Notificaremos al cliente y ofreceremos un plazo razonable
            para subsanar la situación cuando ello sea factible; sin embargo,
            si Meta exige una acción inmediata, la suspensión podrá ser
            inmediata.
          </p>
        </section>

        {/* Contact */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            Contacto
          </h2>
          <div className="bg-surface rounded-xl border border-border p-6 space-y-3">
            <p>
              <strong className="text-text-primary">Razón social:</strong>{" "}
              Automation AI S.A.S
            </p>
            <p>
              <strong className="text-text-primary">NIT:</strong> 902032943-1
            </p>
            <p>
              <strong className="text-text-primary">Dirección:</strong> Bogotá,
              Colombia
            </p>
            <p>
              <strong className="text-text-primary">Correo:</strong>{" "}
              <a
                href="mailto:cloud.manager@parallext.com"
                className="text-accent hover:underline"
              >
                cloud.manager@parallext.com
              </a>
            </p>
            <p>
              <strong className="text-text-primary">Soporte:</strong>{" "}
              <a
                href="mailto:support@parallext.com"
                className="text-accent hover:underline"
              >
                support@parallext.com
              </a>
            </p>
          </div>
        </section>
      </div>
    </>
  );
}
