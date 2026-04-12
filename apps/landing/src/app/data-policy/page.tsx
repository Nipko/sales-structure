import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Política de Tratamiento de Datos Personales — Parallly",
  description:
    "Política de tratamiento de datos personales de Parallly conforme a la Ley 1581 de 2012 y el Decreto 1377 de 2013 de Colombia.",
};

export default function DataPolicyPage() {
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
          Política de Tratamiento de Datos Personales
        </h1>
        <p className="text-text-muted text-sm mb-4">
          Última actualización: Abril 2026
        </p>
        <p className="text-text-muted text-sm mb-12">
          Conforme a la Ley Estatutaria 1581 de 2012, el Decreto Reglamentario
          1377 de 2013 y demás normas concordantes de la República de Colombia.
        </p>

        <div className="space-y-12 text-text-secondary leading-relaxed">
          {/* 1 */}
          <section>
            <h2 className="text-2xl font-semibold text-text-primary mb-4">
              1. Responsable del tratamiento
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
                <strong className="text-text-primary">Domicilio:</strong> Bogotá,
                D.C., Colombia
              </p>
              <p>
                <strong className="text-text-primary">Correo electrónico:</strong>{" "}
                <a
                  href="mailto:cloud.manager@parallext.com"
                  className="text-accent hover:underline"
                >
                  cloud.manager@parallext.com
                </a>
              </p>
              <p>
                <strong className="text-text-primary">Sitio web:</strong>{" "}
                <a
                  href="https://parallext.com"
                  className="text-accent hover:underline"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  parallext.com
                </a>
              </p>
              <p>
                <strong className="text-text-primary">Producto:</strong> Parallly
                (parallly-chat.cloud)
              </p>
            </div>
            <p className="mt-4">
              Automation AI S.A.S (en adelante, &quot;la Empresa&quot;), en su
              calidad de responsable del tratamiento de datos personales, da
              cumplimiento a la Ley 1581 de 2012, el Decreto 1377 de 2013 y demás
              normas que las complementen, modifiquen o adicionen, mediante la
              presente Política de Tratamiento de Datos Personales.
            </p>
          </section>

          {/* 2 */}
          <section>
            <h2 className="text-2xl font-semibold text-text-primary mb-4">
              2. Tratamiento y finalidades
            </h2>
            <p className="mb-4">
              La Empresa realizará el tratamiento de datos personales para las
              siguientes finalidades:
            </p>

            <h3 className="text-lg font-medium text-text-primary mt-6 mb-3">
              2.1 Finalidades relacionadas con clientes y usuarios
            </h3>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                Gestionar la relación contractual para la prestación de los
                servicios de la plataforma Parallly.
              </li>
              <li>
                Crear y administrar las cuentas de usuario y organizaciones
                (tenants) en la plataforma.
              </li>
              <li>
                Procesar pagos, emitir facturas y administrar la facturación.
              </li>
              <li>
                Brindar soporte técnico y atención al cliente.
              </li>
              <li>
                Enviar comunicaciones transaccionales relacionadas con el servicio
                (confirmaciones, notificaciones, alertas de seguridad).
              </li>
              <li>
                Enviar comunicaciones comerciales sobre actualizaciones, nuevas
                funcionalidades y promociones, previa autorización del titular.
              </li>
              <li>
                Realizar análisis estadísticos y de uso para mejorar la
                plataforma.
              </li>
            </ul>

            <h3 className="text-lg font-medium text-text-primary mt-6 mb-3">
              2.2 Finalidades relacionadas con clientes finales (end-users)
            </h3>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                Procesar y almacenar mensajes de WhatsApp en nombre del cliente
                (responsable) conforme al acuerdo de procesamiento de datos.
              </li>
              <li>
                Generar respuestas automatizadas mediante inteligencia artificial.
              </li>
              <li>
                Facilitar el escalamiento de conversaciones a agentes humanos
                cuando sea necesario.
              </li>
            </ul>

            <h3 className="text-lg font-medium text-text-primary mt-6 mb-3">
              2.3 Finalidades relacionadas con proveedores y aliados
            </h3>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                Gestionar la relación comercial y contractual con proveedores.
              </li>
              <li>
                Realizar pagos y gestiones contables y tributarias.
              </li>
            </ul>
          </section>

          {/* 3 */}
          <section>
            <h2 className="text-2xl font-semibold text-text-primary mb-4">
              3. Derechos de los titulares
            </h2>
            <p className="mb-4">
              De conformidad con el artículo 8 de la Ley 1581 de 2012, los
              titulares de datos personales tienen los siguientes derechos:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                <strong className="text-text-primary">Acceso:</strong> conocer los
                datos personales objeto de tratamiento por parte de la Empresa.
                Este derecho podrá ejercerse de forma gratuita al menos una vez
                cada mes calendario.
              </li>
              <li>
                <strong className="text-text-primary">Actualización:</strong>{" "}
                solicitar la actualización de los datos personales cuando estos
                sean parciales, inexactos, incompletos, fraccionados o induzcan a
                error.
              </li>
              <li>
                <strong className="text-text-primary">Rectificación:</strong>{" "}
                solicitar la corrección de datos personales que sean erróneos.
              </li>
              <li>
                <strong className="text-text-primary">Supresión:</strong> solicitar
                la eliminación de los datos personales cuando: (a) no sean
                necesarios para las finalidades autorizadas, (b) se haya revocado
                la autorización, o (c) se haya superado el período de
                tratamiento. Este derecho no procede cuando exista un deber legal
                o contractual de permanecer en la base de datos.
              </li>
              <li>
                <strong className="text-text-primary">
                  Revocatoria de autorización:
                </strong>{" "}
                revocar la autorización otorgada para el tratamiento de datos
                personales, total o parcialmente.
              </li>
              <li>
                <strong className="text-text-primary">
                  Prueba de autorización:
                </strong>{" "}
                solicitar prueba de la autorización otorgada, salvo cuando la ley
                no exija autorización.
              </li>
              <li>
                <strong className="text-text-primary">Información:</strong> ser
                informado sobre el uso que se ha dado a sus datos personales.
              </li>
              <li>
                <strong className="text-text-primary">Queja ante la SIC:</strong>{" "}
                presentar quejas ante la Superintendencia de Industria y Comercio
                por infracciones a la Ley 1581 de 2012 y sus normas
                complementarias.
              </li>
            </ul>
          </section>

          {/* 4 */}
          <section>
            <h2 className="text-2xl font-semibold text-text-primary mb-4">
              4. Autorización del titular
            </h2>
            <p className="mb-4">
              La Empresa obtendrá la autorización previa e informada del titular
              para el tratamiento de sus datos personales, la cual podrá otorgarse
              mediante:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Documento físico o electrónico firmado.</li>
              <li>
                Aceptación de términos y condiciones al momento del registro en la
                plataforma (checkbox o mecanismo equivalente).
              </li>
              <li>
                Conducta inequívoca del titular que permita concluir que otorgó
                autorización (por ejemplo, enviar datos voluntariamente a través
                de formularios).
              </li>
              <li>
                Cualquier otro mecanismo que garantice la consulta posterior de la
                autorización.
              </li>
            </ul>
            <p className="mt-4">
              La autorización no será necesaria cuando se trate de: (a) datos
              requeridos por una entidad pública en ejercicio de sus funciones, (b)
              datos de naturaleza pública, (c) casos de urgencia médica o
              sanitaria, o (d) tratamiento autorizado por la ley.
            </p>
          </section>

          {/* 5 */}
          <section>
            <h2 className="text-2xl font-semibold text-text-primary mb-4">
              5. Personas autorizadas para el tratamiento
            </h2>
            <p className="mb-4">
              Los datos personales podrán ser tratados por:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                <strong className="text-text-primary">
                  Automation AI S.A.S:
                </strong>{" "}
                como responsable del tratamiento.
              </li>
              <li>
                <strong className="text-text-primary">
                  Empleados y contratistas:
                </strong>{" "}
                del área técnica y de soporte, que requieran acceso para el
                cumplimiento de sus funciones, sujetos a acuerdos de
                confidencialidad.
              </li>
              <li>
                <strong className="text-text-primary">
                  Encargados del tratamiento:
                </strong>{" "}
                terceros proveedores de servicios que actúen por cuenta y bajo las
                instrucciones de la Empresa, conforme a contratos de transmisión
                de datos que garanticen la protección adecuada. Estos incluyen:
                proveedores de hosting e infraestructura, proveedores de modelos
                de IA (OpenAI, Anthropic, Google), Meta/WhatsApp Business API,
                procesadores de pago.
              </li>
            </ul>
          </section>

          {/* 6 */}
          <section>
            <h2 className="text-2xl font-semibold text-text-primary mb-4">
              6. Procedimiento para ejercer derechos
            </h2>
            <p className="mb-4">
              Los titulares podrán ejercer sus derechos mediante solicitud
              dirigida a la Empresa a través de los siguientes canales:
            </p>
            <div className="bg-surface rounded-xl border border-border p-6 space-y-3 mb-6">
              <p>
                <strong className="text-text-primary">Correo electrónico:</strong>{" "}
                <a
                  href="mailto:cloud.manager@parallext.com"
                  className="text-accent hover:underline"
                >
                  cloud.manager@parallext.com
                </a>
              </p>
              <p>
                <strong className="text-text-primary">Asunto del correo:</strong>{" "}
                &quot;Ejercicio de derechos — Datos Personales&quot;
              </p>
            </div>

            <p className="mb-4">
              La solicitud deberá contener como mínimo:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                Nombre completo y documento de identificación del titular.
              </li>
              <li>
                Descripción clara y precisa de los hechos y del derecho que desea
                ejercer.
              </li>
              <li>
                Dirección física y/o electrónica para recibir la respuesta.
              </li>
              <li>
                Documentos que soporten la solicitud, si aplica.
              </li>
            </ul>

            <h3 className="text-lg font-medium text-text-primary mt-6 mb-3">
              Tiempos de respuesta
            </h3>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                <strong className="text-text-primary">Consultas:</strong> la
                Empresa responderá en un plazo máximo de diez (10) días hábiles
                contados a partir de la fecha de recibo de la solicitud.
              </li>
              <li>
                <strong className="text-text-primary">Reclamos:</strong> la
                Empresa responderá en un plazo máximo de quince (15) días hábiles
                contados a partir de la fecha de recibo del reclamo.
              </li>
              <li>
                Si no es posible atender la consulta o el reclamo dentro de los
                plazos señalados, se informará al titular los motivos de la demora
                y la fecha en que será atendida, la cual no podrá superar los
                cinco (5) días hábiles adicionales para consultas y los ocho (8)
                días hábiles adicionales para reclamos.
              </li>
            </ul>
          </section>

          {/* 7 */}
          <section>
            <h2 className="text-2xl font-semibold text-text-primary mb-4">
              7. Área responsable de la atención de peticiones, consultas y
              reclamos
            </h2>
            <div className="bg-surface rounded-xl border border-border p-6 space-y-3">
              <p>
                <strong className="text-text-primary">
                  Delegado de Protección de Datos (DPO):
                </strong>{" "}
                Andres Felipe Matallana
              </p>
              <p>
                <strong className="text-text-primary">Correo electrónico:</strong>{" "}
                <a
                  href="mailto:cloud.manager@parallext.com"
                  className="text-accent hover:underline"
                >
                  cloud.manager@parallext.com
                </a>
              </p>
              <p>
                <strong className="text-text-primary">Dirección:</strong> Bogotá,
                D.C., Colombia
              </p>
            </div>
            <p className="mt-4">
              El Delegado de Protección de Datos es el encargado de dar trámite a
              las solicitudes de los titulares para hacer efectivos sus derechos,
              así como de velar por el cumplimiento de la presente política y de
              la normatividad vigente en materia de protección de datos
              personales.
            </p>
          </section>

          {/* 8 */}
          <section>
            <h2 className="text-2xl font-semibold text-text-primary mb-4">
              8. Vigencia de las bases de datos
            </h2>
            <p className="mb-4">
              Las bases de datos administradas por la Empresa tendrán vigencia
              mientras se mantenga la finalidad del tratamiento y exista la
              necesidad de conservar los datos. Específicamente:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                <strong className="text-text-primary">
                  Base de datos de clientes:
                </strong>{" "}
                durante la vigencia de la relación contractual y hasta treinta
                (30) días después de la terminación del servicio para efectos de
                exportación de datos.
              </li>
              <li>
                <strong className="text-text-primary">
                  Base de datos de facturación:
                </strong>{" "}
                durante el período requerido por la legislación tributaria
                colombiana (mínimo cinco años conforme al Estatuto Tributario).
              </li>
              <li>
                <strong className="text-text-primary">
                  Base de datos de conversaciones:
                </strong>{" "}
                según la configuración del cliente, con un máximo de veinticuatro
                (24) meses desde su creación.
              </li>
              <li>
                <strong className="text-text-primary">
                  Registros de seguridad:
                </strong>{" "}
                hasta doce (12) meses para fines de seguridad informática y
                diagnóstico.
              </li>
            </ul>
            <p className="mt-4">
              Una vez cumplida la finalidad del tratamiento y transcurridos los
              plazos legales aplicables, los datos personales serán eliminados de
              forma segura o anonimizados de manera irreversible.
            </p>
          </section>

          {/* 9 */}
          <section>
            <h2 className="text-2xl font-semibold text-text-primary mb-4">
              9. Transferencia y transmisión de datos
            </h2>
            <p className="mb-4">
              La Empresa podrá realizar transferencias y transmisiones de datos
              personales a terceros, tanto a nivel nacional como internacional,
              conforme a lo previsto en los artículos 25 y 26 del Decreto 1377 de
              2013:
            </p>

            <h3 className="text-lg font-medium text-text-primary mt-6 mb-3">
              9.1 Transmisión (Encargados del tratamiento)
            </h3>
            <p className="mb-3">
              Se realiza transmisión de datos a los siguientes encargados:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                <strong className="text-text-primary">
                  Proveedores de infraestructura:
                </strong>{" "}
                para el alojamiento y operación de la plataforma.
              </li>
              <li>
                <strong className="text-text-primary">
                  Meta Platforms (WhatsApp Business API):
                </strong>{" "}
                para la transmisión de mensajes de WhatsApp.
              </li>
              <li>
                <strong className="text-text-primary">
                  Proveedores de modelos de IA:
                </strong>{" "}
                OpenAI, Anthropic y Google para el procesamiento de respuestas
                automáticas.
              </li>
              <li>
                <strong className="text-text-primary">
                  Procesadores de pago:
                </strong>{" "}
                para la gestión de transacciones financieras.
              </li>
            </ul>

            <h3 className="text-lg font-medium text-text-primary mt-6 mb-3">
              9.2 Transferencia internacional
            </h3>
            <p>
              Dado que algunos encargados del tratamiento tienen sede en el
              exterior (Estados Unidos, Unión Europea), la Empresa garantiza que
              dichas transferencias se realizan conforme a las disposiciones
              legales aplicables, verificando que los países de destino cuenten
              con niveles adecuados de protección de datos o, en su defecto,
              suscribiendo cláusulas contractuales que garanticen la protección de
              los datos personales transferidos, conforme al artículo 26 de la Ley
              1581 de 2012.
            </p>
          </section>

          {/* 10 */}
          <section>
            <h2 className="text-2xl font-semibold text-text-primary mb-4">
              10. Medidas de seguridad
            </h2>
            <p className="mb-4">
              La Empresa ha adoptado las siguientes medidas técnicas,
              administrativas y humanas para proteger los datos personales contra
              acceso no autorizado, uso indebido, alteración, pérdida o
              destrucción:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                <strong className="text-text-primary">
                  Cifrado AES-256-GCM:
                </strong>{" "}
                para tokens de acceso y datos sensibles almacenados en reposo.
              </li>
              <li>
                <strong className="text-text-primary">
                  Cifrado en tránsito:
                </strong>{" "}
                todas las comunicaciones se realizan mediante TLS 1.2+ (HTTPS).
              </li>
              <li>
                <strong className="text-text-primary">
                  Aislamiento multi-tenant:
                </strong>{" "}
                cada organización cliente opera en un esquema de base de datos
                PostgreSQL aislado (schema-per-tenant), garantizando que los datos
                de cada cliente estén lógicamente separados.
              </li>
              <li>
                <strong className="text-text-primary">
                  Control de acceso basado en roles (RBAC):
                </strong>{" "}
                con cuatro niveles de acceso (super_admin, tenant_admin,
                tenant_supervisor, tenant_agent).
              </li>
              <li>
                <strong className="text-text-primary">
                  Autenticación JWT:
                </strong>{" "}
                con tokens de expiración configurable.
              </li>
              <li>
                <strong className="text-text-primary">
                  Idempotencia de webhooks:
                </strong>{" "}
                mecanismos de deduplicación para evitar procesamiento duplicado de
                datos.
              </li>
              <li>
                <strong className="text-text-primary">
                  Copias de seguridad:
                </strong>{" "}
                respaldos cifrados con retención y restauración periódica
                verificada.
              </li>
              <li>
                <strong className="text-text-primary">
                  Monitoreo y auditoría:
                </strong>{" "}
                registro de eventos de seguridad y acceso para detección de
                anomalías.
              </li>
              <li>
                <strong className="text-text-primary">
                  Acuerdos de confidencialidad:
                </strong>{" "}
                todos los empleados y contratistas con acceso a datos personales
                están sujetos a cláusulas de confidencialidad.
              </li>
            </ul>
          </section>

          {/* 11 */}
          <section>
            <h2 className="text-2xl font-semibold text-text-primary mb-4">
              11. Cookies
            </h2>
            <p className="mb-4">
              La plataforma Parallly utiliza cookies y tecnologías similares para
              mejorar la experiencia del usuario. Las categorías de cookies
              utilizadas son:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                <strong className="text-text-primary">
                  Cookies estrictamente necesarias:
                </strong>{" "}
                requeridas para el funcionamiento del servicio (autenticación,
                sesión, seguridad).
              </li>
              <li>
                <strong className="text-text-primary">
                  Cookies analíticas:
                </strong>{" "}
                para análisis de uso y mejora de la plataforma.
              </li>
              <li>
                <strong className="text-text-primary">
                  Cookies de preferencias:
                </strong>{" "}
                para recordar configuraciones del usuario.
              </li>
            </ul>
            <p className="mt-4">
              El usuario puede configurar su navegador para rechazar cookies no
              esenciales. La desactivación de cookies esenciales puede afectar el
              funcionamiento de la plataforma. Para más información, consulta
              nuestra{" "}
              <Link href="/privacy" className="text-accent hover:underline">
                Política de Privacidad
              </Link>
              .
            </p>
          </section>

          {/* 12 */}
          <section>
            <h2 className="text-2xl font-semibold text-text-primary mb-4">
              12. Modificaciones a esta política
            </h2>
            <p>
              La Empresa se reserva el derecho de modificar la presente Política
              de Tratamiento de Datos Personales en cualquier momento. Las
              modificaciones serán publicadas en el sitio web de la plataforma y
              notificadas a los titulares a través de los canales de comunicación
              disponibles. Los cambios entrarán en vigor a partir de la fecha de
              su publicación, salvo que se indique una fecha posterior. El uso
              continuado de la plataforma después de la publicación de las
              modificaciones constituirá la aceptación de la política
              actualizada.
            </p>
          </section>

          {/* 13 */}
          <section>
            <h2 className="text-2xl font-semibold text-text-primary mb-4">
              13. Datos de contacto de la Superintendencia de Industria y
              Comercio (SIC)
            </h2>
            <p className="mb-4">
              Si el titular considera que sus derechos han sido vulnerados o que
              la Empresa ha incumplido la normatividad de protección de datos,
              podrá presentar una queja ante la Superintendencia de Industria y
              Comercio:
            </p>
            <div className="bg-surface rounded-xl border border-border p-6 space-y-3">
              <p>
                <strong className="text-text-primary">Entidad:</strong>{" "}
                Superintendencia de Industria y Comercio (SIC)
              </p>
              <p>
                <strong className="text-text-primary">Dirección:</strong> Carrera
                13 No. 27-00, Pisos 1 al 7, Bogotá, D.C., Colombia
              </p>
              <p>
                <strong className="text-text-primary">
                  Línea telefónica:
                </strong>{" "}
                (601) 587 0000
              </p>
              <p>
                <strong className="text-text-primary">
                  Línea gratuita nacional:
                </strong>{" "}
                01 8000 910 165
              </p>
              <p>
                <strong className="text-text-primary">Sitio web:</strong>{" "}
                <a
                  href="https://www.sic.gov.co"
                  className="text-accent hover:underline"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  www.sic.gov.co
                </a>
              </p>
              <p>
                <strong className="text-text-primary">Correo:</strong>{" "}
                <a
                  href="mailto:contactenos@sic.gov.co"
                  className="text-accent hover:underline"
                >
                  contactenos@sic.gov.co
                </a>
              </p>
            </div>
            <p className="mt-4 text-text-muted text-sm">
              Antes de acudir ante la SIC, el titular deberá haber presentado su
              solicitud directamente ante la Empresa y haber agotado el trámite
              de consulta o reclamo, conforme a lo establecido en los artículos
              14 y 15 de la Ley 1581 de 2012.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
