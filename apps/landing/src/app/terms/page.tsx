import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Términos y Condiciones — Parallly",
  description:
    "Términos y condiciones de uso de Parallly. Conoce las reglas que rigen el uso de nuestra plataforma.",
};

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-bg text-text-primary">
      <div className="mx-auto max-w-4xl px-6 py-16">
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
          Última actualización: Abril 2026
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
                Arquitectura multi-tenant con aislamiento de datos por
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
                Cada organización (tenant) puede tener múltiples usuarios con
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
              Parallly ofrece los siguientes planes de suscripción:
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-3 pr-4 text-text-primary font-semibold">
                      Característica
                    </th>
                    <th className="text-center py-3 px-4 text-text-primary font-semibold">
                      Starter
                    </th>
                    <th className="text-center py-3 px-4 text-text-primary font-semibold">
                      Pro
                    </th>
                    <th className="text-center py-3 px-4 text-text-primary font-semibold">
                      Enterprise
                    </th>
                  </tr>
                </thead>
                <tbody className="text-text-muted">
                  <tr className="border-b border-border/50">
                    <td className="py-3 pr-4">Conversaciones/mes</td>
                    <td className="text-center py-3 px-4">500</td>
                    <td className="text-center py-3 px-4">5.000</td>
                    <td className="text-center py-3 px-4">Ilimitadas</td>
                  </tr>
                  <tr className="border-b border-border/50">
                    <td className="py-3 pr-4">Agentes de IA</td>
                    <td className="text-center py-3 px-4">1</td>
                    <td className="text-center py-3 px-4">5</td>
                    <td className="text-center py-3 px-4">Ilimitados</td>
                  </tr>
                  <tr className="border-b border-border/50">
                    <td className="py-3 pr-4">Usuarios del equipo</td>
                    <td className="text-center py-3 px-4">2</td>
                    <td className="text-center py-3 px-4">10</td>
                    <td className="text-center py-3 px-4">Ilimitados</td>
                  </tr>
                  <tr className="border-b border-border/50">
                    <td className="py-3 pr-4">Soporte</td>
                    <td className="text-center py-3 px-4">Email</td>
                    <td className="text-center py-3 px-4">Prioritario</td>
                    <td className="text-center py-3 px-4">Dedicado</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="mt-4 text-text-muted text-sm">
              Los precios vigentes están publicados en la página de precios de
              parallly-chat.cloud. Nos reservamos el derecho de modificar los
              precios con un aviso previo de 30 días.
            </p>
          </section>

          {/* 5 */}
          <section>
            <h2 className="text-2xl font-semibold text-text-primary mb-4">
              5. Período de prueba
            </h2>
            <p>
              Parallly ofrece un período de prueba gratuito de 7 días calendario
              para nuevos usuarios. Durante este período, tendrás acceso a las
              funcionalidades del plan Pro. Al finalizar el período de prueba, si
              no has seleccionado un plan de pago, tu cuenta pasará a estado
              inactivo y no se procesarán mensajes hasta que actives una
              suscripción. No se realizará ningún cargo automático al finalizar la
              prueba salvo que hayas seleccionado explícitamente un plan de pago.
            </p>
          </section>

          {/* 6 */}
          <section>
            <h2 className="text-2xl font-semibold text-text-primary mb-4">
              6. Facturación y pagos
            </h2>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                Las suscripciones se facturan de forma mensual o anual, según el
                ciclo de facturación seleccionado.
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
                Intentar acceder a datos de otros tenants o eludir los mecanismos
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
      </div>
    </div>
  );
}
