import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Política de Privacidad — Parallly",
  description:
    "Política de privacidad de Parallly. Conoce cómo recopilamos, usamos y protegemos tu información personal.",
};

export default function PrivacyPage() {
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
          Política de Privacidad
        </h1>
        <p className="text-text-muted text-sm mb-12">
          Última actualización: Abril 2026
        </p>

        <div className="space-y-12 text-text-secondary leading-relaxed">
          {/* Intro */}
          <p>
            En <strong className="text-text-primary">Automation AI S.A.S</strong>{" "}
            (NIT: 902032943-1), operadora de la plataforma{" "}
            <strong className="text-text-primary">Parallly</strong>{" "}
            (parallly-chat.cloud), nos comprometemos a proteger la privacidad de
            nuestros usuarios. Esta Política de Privacidad describe cómo
            recopilamos, usamos, compartimos y protegemos tu información personal
            cuando utilizas nuestros servicios.
          </p>
          <p>
            Esta política cumple con el Reglamento General de Protección de Datos
            (GDPR) de la Unión Europea, la Ley de Privacidad del Consumidor de
            California (CCPA), la Ley General de Protección de Datos de Brasil
            (LGPD) y la Ley 1581 de 2012 de Colombia, así como las normas
            complementarias aplicables en cada jurisdicción.
          </p>

          {/* 1 */}
          <section>
            <h2 className="text-2xl font-semibold text-text-primary mb-4">
              1. Información que recopilamos
            </h2>

            <h3 className="text-lg font-medium text-text-primary mt-6 mb-3">
              1.1 Datos personales proporcionados directamente
            </h3>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                Información de registro: nombre completo, correo electrónico,
                número de teléfono, nombre de la empresa, cargo.
              </li>
              <li>
                Información de facturación: datos de tarjeta de crédito o método
                de pago (procesados por proveedores de pago certificados PCI DSS,
                no almacenamos datos de tarjeta).
              </li>
              <li>
                Contenido de comunicaciones: mensajes enviados a través de la
                plataforma en el contexto de soporte técnico.
              </li>
            </ul>

            <h3 className="text-lg font-medium text-text-primary mt-6 mb-3">
              1.2 Datos de uso
            </h3>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                Dirección IP, tipo de navegador, sistema operativo, páginas
                visitadas, fecha y hora de acceso.
              </li>
              <li>
                Métricas de uso del servicio: número de conversaciones, mensajes
                procesados, agentes configurados.
              </li>
              <li>Registros de actividad (logs) para seguridad y diagnóstico.</li>
            </ul>

            <h3 className="text-lg font-medium text-text-primary mt-6 mb-3">
              1.3 Datos de clientes finales (end-users)
            </h3>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                Número de teléfono de WhatsApp, nombre de perfil y contenido de
                los mensajes enviados al negocio del cliente.
              </li>
              <li>
                Estos datos son procesados por cuenta del cliente (responsable del
                tratamiento) y Parallly actúa como encargado del tratamiento
                conforme a los acuerdos de procesamiento de datos aplicables.
              </li>
            </ul>

            <h3 className="text-lg font-medium text-text-primary mt-6 mb-3">
              1.4 Cookies y tecnologías similares
            </h3>
            <p>
              Utilizamos cookies esenciales para el funcionamiento de la
              plataforma, cookies analíticas para mejorar la experiencia del
              usuario y cookies de preferencias. Consulta la sección 9 de esta
              política para más detalles.
            </p>
          </section>

          {/* 2 */}
          <section>
            <h2 className="text-2xl font-semibold text-text-primary mb-4">
              2. Cómo usamos tu información
            </h2>
            <p className="mb-4">
              Utilizamos la información recopilada para los siguientes fines:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                Proveer, mantener y mejorar nuestros servicios de automatización
                conversacional con IA.
              </li>
              <li>
                Procesar pagos y administrar tu cuenta y suscripción.
              </li>
              <li>
                Enviar comunicaciones transaccionales (confirmaciones,
                notificaciones de servicio, alertas de seguridad).
              </li>
              <li>
                Enviar comunicaciones comerciales sobre actualizaciones y nuevas
                funcionalidades (con tu consentimiento previo).
              </li>
              <li>
                Analizar patrones de uso para optimizar el rendimiento de la
                plataforma y la experiencia del usuario.
              </li>
              <li>
                Entrenar y mejorar modelos de IA internos (los datos son
                anonimizados y agregados; nunca se utilizan datos personales
                identificables para entrenamiento sin consentimiento explícito).
              </li>
              <li>
                Cumplir con obligaciones legales, resolver disputas y hacer
                cumplir nuestros acuerdos.
              </li>
              <li>
                Prevenir fraude, actividades ilegales y proteger la seguridad de
                la plataforma.
              </li>
            </ul>
          </section>

          {/* 3 */}
          <section>
            <h2 className="text-2xl font-semibold text-text-primary mb-4">
              3. Base legal para el tratamiento
            </h2>
            <p className="mb-4">
              Conforme al GDPR (Art. 6) y normativas equivalentes, tratamos datos
              personales con base en las siguientes bases legales:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                <strong className="text-text-primary">
                  Ejecución de un contrato:
                </strong>{" "}
                el tratamiento es necesario para la prestación del servicio
                contratado (creación de cuenta, procesamiento de mensajes,
                facturación).
              </li>
              <li>
                <strong className="text-text-primary">
                  Consentimiento:
                </strong>{" "}
                para comunicaciones comerciales, cookies no esenciales y
                procesamiento de datos con fines analíticos avanzados.
              </li>
              <li>
                <strong className="text-text-primary">
                  Interés legítimo:
                </strong>{" "}
                para la seguridad de la plataforma, prevención de fraude, mejora
                del servicio y análisis de uso agregado.
              </li>
              <li>
                <strong className="text-text-primary">
                  Obligación legal:
                </strong>{" "}
                para cumplir con requerimientos fiscales, contables y regulatorios
                aplicables.
              </li>
            </ul>
            <p className="mt-4">
              Para la LGPD (Brasil), además de las bases anteriores, nos basamos
              en el legítimo interés del controlador y la protección del crédito
              cuando corresponda.
            </p>
            <p className="mt-2">
              Para la Ley 1581 de 2012 (Colombia), el tratamiento se realiza
              conforme a la autorización otorgada por el titular de los datos.
            </p>
          </section>

          {/* 4 */}
          <section>
            <h2 className="text-2xl font-semibold text-text-primary mb-4">
              4. Compartir datos con terceros
            </h2>
            <p className="mb-4">
              No vendemos datos personales. Compartimos información solo en los
              siguientes casos:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                <strong className="text-text-primary">
                  Meta / WhatsApp Business API:
                </strong>{" "}
                los mensajes se transmiten a través de la API de WhatsApp Cloud de
                Meta. Meta actúa como procesador independiente conforme a sus
                propias políticas de privacidad.
              </li>
              <li>
                <strong className="text-text-primary">
                  Proveedores de modelos de IA:
                </strong>{" "}
                OpenAI, Anthropic, Google y otros proveedores de modelos de
                lenguaje procesan el contenido de las conversaciones para generar
                respuestas. Los datos se envían de forma segura vía API y están
                sujetos a los acuerdos de procesamiento de datos de cada
                proveedor.
              </li>
              <li>
                <strong className="text-text-primary">
                  Proveedores de infraestructura:
                </strong>{" "}
                servicios de hosting, bases de datos y CDN necesarios para operar
                la plataforma.
              </li>
              <li>
                <strong className="text-text-primary">
                  Procesadores de pago:
                </strong>{" "}
                para gestionar transacciones de forma segura (certificación PCI
                DSS).
              </li>
              <li>
                <strong className="text-text-primary">
                  Autoridades competentes:
                </strong>{" "}
                cuando sea requerido por ley, orden judicial o proceso legal
                válido.
              </li>
            </ul>
            <p className="mt-4">
              Todos los terceros están sujetos a acuerdos de procesamiento de
              datos (DPA) que garantizan niveles adecuados de protección.
            </p>
          </section>

          {/* 5 */}
          <section>
            <h2 className="text-2xl font-semibold text-text-primary mb-4">
              5. Transferencias internacionales de datos
            </h2>
            <p className="mb-4">
              Dado que operamos globalmente y utilizamos proveedores de servicios
              con infraestructura distribuida, tus datos pueden ser transferidos y
              procesados en países fuera de tu jurisdicción, incluyendo Estados
              Unidos y la Unión Europea.
            </p>
            <p className="mb-4">
              Para garantizar la protección adecuada de los datos transferidos
              internacionalmente, implementamos las siguientes salvaguardas:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                Cláusulas Contractuales Tipo (SCC) aprobadas por la Comisión
                Europea.
              </li>
              <li>
                Evaluaciones de impacto de transferencia (TIA) cuando corresponda.
              </li>
              <li>
                Contratos con proveedores que incluyen compromisos de protección
                de datos equivalentes al GDPR.
              </li>
              <li>
                Para Colombia: autorización del titular conforme al artículo 26
                del Decreto 1377 de 2013.
              </li>
              <li>
                Para Brasil: cumplimiento del artículo 33 de la LGPD para
                transferencias internacionales.
              </li>
            </ul>
          </section>

          {/* 6 */}
          <section>
            <h2 className="text-2xl font-semibold text-text-primary mb-4">
              6. Seguridad de los datos
            </h2>
            <p className="mb-4">
              Implementamos medidas técnicas y organizativas para proteger tus
              datos personales:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                <strong className="text-text-primary">
                  Cifrado AES-256-GCM:
                </strong>{" "}
                los tokens de acceso y datos sensibles se cifran en reposo
                utilizando AES-256-GCM.
              </li>
              <li>
                <strong className="text-text-primary">
                  Aislamiento multi-tenant:
                </strong>{" "}
                cada cliente opera en un esquema de base de datos aislado (schema-per-tenant),
                garantizando la separación lógica de datos entre organizaciones.
              </li>
              <li>
                <strong className="text-text-primary">Cifrado en tránsito:</strong>{" "}
                todas las comunicaciones utilizan TLS 1.2+ (HTTPS).
              </li>
              <li>
                <strong className="text-text-primary">
                  Autenticación segura:
                </strong>{" "}
                JWT con expiración configurable y control de acceso basado en
                roles (RBAC).
              </li>
              <li>
                <strong className="text-text-primary">
                  Monitoreo continuo:
                </strong>{" "}
                registro de eventos de seguridad, detección de anomalías y
                respuesta a incidentes.
              </li>
              <li>
                <strong className="text-text-primary">
                  Copias de seguridad:
                </strong>{" "}
                respaldos cifrados con retención configurable.
              </li>
            </ul>
          </section>

          {/* 7 */}
          <section>
            <h2 className="text-2xl font-semibold text-text-primary mb-4">
              7. Retención de datos
            </h2>
            <p className="mb-4">
              Conservamos los datos personales únicamente durante el tiempo
              necesario para cumplir con los fines descritos en esta política:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                <strong className="text-text-primary">Datos de cuenta:</strong>{" "}
                durante la vigencia de la relación contractual y hasta 30 días
                después de la terminación, salvo obligación legal de retención
                mayor.
              </li>
              <li>
                <strong className="text-text-primary">
                  Datos de conversaciones:
                </strong>{" "}
                según la configuración del cliente, con un máximo de 24 meses
                desde su creación.
              </li>
              <li>
                <strong className="text-text-primary">
                  Datos de facturación:
                </strong>{" "}
                durante el período requerido por la legislación tributaria
                aplicable (mínimo 5 años en Colombia).
              </li>
              <li>
                <strong className="text-text-primary">
                  Logs de seguridad:
                </strong>{" "}
                hasta 12 meses para fines de seguridad y diagnóstico.
              </li>
              <li>
                <strong className="text-text-primary">Datos anonimizados:</strong>{" "}
                los datos agregados y anonimizados pueden ser retenidos
                indefinidamente para fines analíticos.
              </li>
            </ul>
          </section>

          {/* 8 */}
          <section>
            <h2 className="text-2xl font-semibold text-text-primary mb-4">
              8. Tus derechos
            </h2>

            <h3 className="text-lg font-medium text-text-primary mt-6 mb-3">
              8.1 Derechos bajo el GDPR (Unión Europea / EEE)
            </h3>
            <p className="mb-3">
              Si eres residente del Espacio Económico Europeo, tienes los
              siguientes derechos:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                <strong className="text-text-primary">Acceso:</strong> solicitar
                una copia de tus datos personales.
              </li>
              <li>
                <strong className="text-text-primary">Rectificación:</strong>{" "}
                corregir datos inexactos o incompletos.
              </li>
              <li>
                <strong className="text-text-primary">Supresión:</strong>{" "}
                solicitar la eliminación de tus datos (&quot;derecho al
                olvido&quot;).
              </li>
              <li>
                <strong className="text-text-primary">Portabilidad:</strong>{" "}
                recibir tus datos en un formato estructurado y de lectura
                mecánica.
              </li>
              <li>
                <strong className="text-text-primary">Oposición:</strong>{" "}
                oponerte al tratamiento basado en interés legítimo.
              </li>
              <li>
                <strong className="text-text-primary">
                  Limitación del tratamiento:
                </strong>{" "}
                restringir el procesamiento en determinadas circunstancias.
              </li>
              <li>
                <strong className="text-text-primary">
                  Retirar consentimiento:
                </strong>{" "}
                en cualquier momento, sin afectar la licitud del tratamiento
                anterior.
              </li>
              <li>
                <strong className="text-text-primary">
                  Reclamación ante autoridad:
                </strong>{" "}
                presentar una queja ante tu autoridad de protección de datos.
              </li>
            </ul>

            <h3 className="text-lg font-medium text-text-primary mt-6 mb-3">
              8.2 Derechos bajo la CCPA (California, EE.UU.)
            </h3>
            <p className="mb-3">
              Si eres residente de California, tienes los siguientes derechos:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                <strong className="text-text-primary">Derecho a saber:</strong>{" "}
                solicitar información sobre las categorías y piezas específicas de
                datos personales recopilados.
              </li>
              <li>
                <strong className="text-text-primary">
                  Derecho a eliminar:
                </strong>{" "}
                solicitar la eliminación de tus datos personales.
              </li>
              <li>
                <strong className="text-text-primary">
                  Derecho a optar por no participar (opt-out):
                </strong>{" "}
                no vendemos datos personales. Si esto cambiara, proporcionaremos
                un mecanismo de opt-out conforme a la CCPA.
              </li>
              <li>
                <strong className="text-text-primary">
                  No discriminación:
                </strong>{" "}
                no discriminamos a los usuarios que ejercen sus derechos bajo la
                CCPA.
              </li>
            </ul>

            <h3 className="text-lg font-medium text-text-primary mt-6 mb-3">
              8.3 Derechos bajo la Ley 1581 de 2012 (Colombia)
            </h3>
            <p className="mb-3">
              Como titular de datos personales en Colombia, tienes derecho a:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                Conocer, actualizar y rectificar tus datos personales.
              </li>
              <li>
                Solicitar prueba de la autorización otorgada para el tratamiento.
              </li>
              <li>
                Ser informado sobre el uso que se ha dado a tus datos.
              </li>
              <li>
                Presentar quejas ante la Superintendencia de Industria y Comercio
                (SIC) por violaciones a la ley.
              </li>
              <li>
                Revocar la autorización y/o solicitar la supresión de tus datos
                cuando no se respeten los principios, derechos y garantías
                constitucionales y legales.
              </li>
              <li>
                Acceder gratuitamente a tus datos personales objeto de
                tratamiento.
              </li>
            </ul>
            <p className="mt-3">
              Para ejercer estos derechos, consulta nuestra{" "}
              <Link
                href="/data-policy"
                className="text-accent hover:underline"
              >
                Política de Tratamiento de Datos Personales
              </Link>
              .
            </p>

            <h3 className="text-lg font-medium text-text-primary mt-6 mb-3">
              8.4 Derechos bajo la LGPD (Brasil)
            </h3>
            <p className="mb-3">
              Si eres titular de datos en Brasil, tienes derecho a:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                Confirmación de la existencia de tratamiento de tus datos.
              </li>
              <li>Acceso a tus datos personales.</li>
              <li>
                Corrección de datos incompletos, inexactos o desactualizados.
              </li>
              <li>
                Anonimización, bloqueo o eliminación de datos innecesarios,
                excesivos o tratados en incumplimiento de la LGPD.
              </li>
              <li>Portabilidad de datos a otro proveedor de servicios.</li>
              <li>
                Eliminación de datos personales tratados con base en
                consentimiento.
              </li>
              <li>
                Información sobre entidades públicas y privadas con las que se
                compartieron datos.
              </li>
              <li>
                Revocación del consentimiento en cualquier momento.
              </li>
            </ul>
          </section>

          {/* 9 */}
          <section>
            <h2 className="text-2xl font-semibold text-text-primary mb-4">
              9. Cookies y tecnologías similares
            </h2>
            <p className="mb-4">
              Utilizamos las siguientes categorías de cookies:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                <strong className="text-text-primary">
                  Cookies esenciales:
                </strong>{" "}
                necesarias para el funcionamiento del servicio (autenticación,
                seguridad, preferencias de sesión). No pueden desactivarse.
              </li>
              <li>
                <strong className="text-text-primary">
                  Cookies analíticas:
                </strong>{" "}
                nos ayudan a entender cómo interactúas con la plataforma para
                mejorar la experiencia. Pueden desactivarse.
              </li>
              <li>
                <strong className="text-text-primary">
                  Cookies de preferencias:
                </strong>{" "}
                recuerdan tus configuraciones (idioma, zona horaria). Pueden
                desactivarse.
              </li>
            </ul>
            <p className="mt-4">
              Puedes gestionar tus preferencias de cookies desde la configuración
              de tu navegador. Ten en cuenta que desactivar ciertas cookies puede
              afectar la funcionalidad del servicio.
            </p>
          </section>

          {/* 10 */}
          <section>
            <h2 className="text-2xl font-semibold text-text-primary mb-4">
              10. Menores de edad
            </h2>
            <p>
              Parallly no está dirigido a menores de 18 años. No recopilamos
              intencionalmente datos personales de menores de edad. Si tenemos
              conocimiento de que hemos recopilado datos de un menor sin el
              consentimiento verificable de su padre, madre o tutor, tomaremos
              medidas para eliminar dicha información de nuestros sistemas. Si
              crees que podemos haber recopilado información de un menor, contáctanos
              a{" "}
              <a
                href="mailto:cloud.manager@parallext.com"
                className="text-accent hover:underline"
              >
                cloud.manager@parallext.com
              </a>
              .
            </p>
          </section>

          {/* 11 */}
          <section>
            <h2 className="text-2xl font-semibold text-text-primary mb-4">
              11. Cambios a esta política
            </h2>
            <p>
              Nos reservamos el derecho de actualizar esta Política de Privacidad
              en cualquier momento. Notificaremos los cambios significativos
              mediante un aviso en la plataforma o por correo electrónico al menos
              30 días antes de que entren en vigor. El uso continuado del servicio
              después de la fecha de entrada en vigor constituye la aceptación de
              la política actualizada.
            </p>
          </section>

          {/* 12 */}
          <section>
            <h2 className="text-2xl font-semibold text-text-primary mb-4">
              12. Contacto
            </h2>
            <p className="mb-4">
              Para ejercer cualquiera de tus derechos o para consultas
              relacionadas con esta política, puedes contactarnos a través de:
            </p>
            <div className="bg-surface rounded-xl border border-border p-6 space-y-3">
              <p>
                <strong className="text-text-primary">Responsable:</strong>{" "}
                Automation AI S.A.S
              </p>
              <p>
                <strong className="text-text-primary">NIT:</strong> 902032943-1
              </p>
              <p>
                <strong className="text-text-primary">
                  Delegado de Protección de Datos (DPO):
                </strong>{" "}
                Andres Felipe Matallana
              </p>
              <p>
                <strong className="text-text-primary">Correo de privacidad:</strong>{" "}
                <a
                  href="mailto:cloud.manager@parallext.com"
                  className="text-accent hover:underline"
                >
                  cloud.manager@parallext.com
                </a>
              </p>
              <p>
                <strong className="text-text-primary">Correo de soporte:</strong>{" "}
                <a
                  href="mailto:support@parallext.com"
                  className="text-accent hover:underline"
                >
                  support@parallext.com
                </a>
              </p>
              <p>
                <strong className="text-text-primary">Dirección:</strong> Bogotá,
                Colombia
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
            </div>
            <p className="mt-6 text-text-muted text-sm">
              Si consideras que el tratamiento de tus datos personales infringe la
              normativa aplicable, tienes derecho a presentar una reclamación ante
              la autoridad de protección de datos competente de tu jurisdicción. En
              Colombia, la autoridad competente es la Superintendencia de Industria
              y Comercio (SIC).
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
