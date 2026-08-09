import Link from "next/link";

export default function DataPolicyEn() {
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
        Back to home
      </Link>

      {/* Title */}
      <h1 className="text-4xl font-bold tracking-tight mb-4">
        Personal Data Treatment Policy
      </h1>
      <p className="text-text-muted text-sm mb-4">
        Last updated: April 2026
      </p>
      <p className="text-text-muted text-sm mb-12">
        Issued in accordance with Ley Estatutaria 1581 de 2012 (Colombia&apos;s
        Statutory Data Protection Law), Decreto Reglamentario 1377 de 2013
        (Colombia&apos;s implementing decree) and other concordant regulations
        of the Republic of Colombia.
      </p>

      <div className="space-y-12 text-text-secondary leading-relaxed">
        {/* 1 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            1. Data controller
          </h2>
          <div className="bg-surface rounded-xl border border-border p-6 space-y-3">
            <p>
              <strong className="text-text-primary">Legal name:</strong>{" "}
              Automation AI S.A.S
            </p>
            <p>
              <strong className="text-text-primary">NIT:</strong> 902032943-1
            </p>
            <p>
              <strong className="text-text-primary">Address:</strong> Bogotá,
              D.C., Colombia
            </p>
            <p>
              <strong className="text-text-primary">Email:</strong>{" "}
              <a
                href="mailto:cloud.manager@parallext.com"
                className="text-accent hover:underline"
              >
                cloud.manager@parallext.com
              </a>
            </p>
            <p>
              <strong className="text-text-primary">Website:</strong>{" "}
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
              <strong className="text-text-primary">Product:</strong> Parallly
              (parallly-chat.cloud)
            </p>
          </div>
          <p className="mt-4">
            Automation AI S.A.S (hereinafter, &quot;the Company&quot;), in its
            capacity as data controller, complies with Ley 1581 de 2012
            (Colombia&apos;s Data Protection Law), Decreto 1377 de 2013 and
            other rules that complement, modify or supplement them, by means of
            this Personal Data Treatment Policy.
          </p>
        </section>

        {/* 2 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            2. Treatment and purposes
          </h2>
          <p className="mb-4">
            The Company will process personal data for the following purposes:
          </p>

          <h3 className="text-lg font-medium text-text-primary mt-6 mb-3">
            2.1 Purposes related to clients and users
          </h3>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              Manage the contractual relationship for the provision of the
              Parallly platform&apos;s services.
            </li>
            <li>
              Create and manage user accounts and customer organizations on
              the platform.
            </li>
            <li>
              Process payments, issue invoices and manage billing.
            </li>
            <li>
              Provide technical support and customer service.
            </li>
            <li>
              Send transactional communications related to the service
              (confirmations, notifications, security alerts).
            </li>
            <li>
              Send commercial communications about updates, new features and
              promotions, with prior authorization from the data subject.
            </li>
            <li>
              Carry out statistical and usage analyses to improve the platform.
            </li>
          </ul>

          <h3 className="text-lg font-medium text-text-primary mt-6 mb-3">
            2.2 Purposes related to end-users
          </h3>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              Process and store WhatsApp messages on behalf of the client
              (controller) under the data processing agreement.
            </li>
            <li>
              Generate automated responses through artificial intelligence.
            </li>
            <li>
              Facilitate the escalation of conversations to human agents when
              necessary.
            </li>
          </ul>

          <h3 className="text-lg font-medium text-text-primary mt-6 mb-3">
            2.3 Purposes related to suppliers and partners
          </h3>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              Manage the commercial and contractual relationship with
              suppliers.
            </li>
            <li>
              Carry out payments and accounting and tax management.
            </li>
          </ul>
        </section>

        {/* 3 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            3. Rights of data subjects
          </h2>
          <p className="mb-4">
            In accordance with Article 8 of Ley 1581 de 2012, holders of
            personal data have the following rights:
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong className="text-text-primary">Access:</strong> to know the
              personal data being processed by the Company. This right may be
              exercised free of charge at least once each calendar month.
            </li>
            <li>
              <strong className="text-text-primary">Update:</strong> request the
              update of personal data when it is partial, inaccurate,
              incomplete, fragmented or misleading.
            </li>
            <li>
              <strong className="text-text-primary">Rectification:</strong>{" "}
              request the correction of personal data that is incorrect.
            </li>
            <li>
              <strong className="text-text-primary">Deletion:</strong> request
              the deletion of personal data when: (a) it is not necessary for
              the authorized purposes, (b) authorization has been revoked, or
              (c) the treatment period has been exceeded. This right does not
              apply when there is a legal or contractual duty to remain in the
              database.
            </li>
            <li>
              <strong className="text-text-primary">
                Revocation of authorization:
              </strong>{" "}
              revoke the authorization granted for the treatment of personal
              data, in whole or in part.
            </li>
            <li>
              <strong className="text-text-primary">
                Proof of authorization:
              </strong>{" "}
              request proof of the authorization granted, except when the law
              does not require authorization.
            </li>
            <li>
              <strong className="text-text-primary">Information:</strong> be
              informed about the use that has been made of their personal
              data.
            </li>
            <li>
              <strong className="text-text-primary">
                Complaint before the SIC:
              </strong>{" "}
              file complaints before the Superintendencia de Industria y
              Comercio for violations of Ley 1581 de 2012 and its supplementary
              regulations.
            </li>
          </ul>
        </section>

        {/* 4 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            4. Data subject&apos;s authorization
          </h2>
          <p className="mb-4">
            The Company will obtain the prior and informed authorization of the
            data subject for the treatment of their personal data, which may be
            granted by:
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>Signed physical or electronic document.</li>
            <li>
              Acceptance of terms and conditions when registering on the
              platform (checkbox or equivalent mechanism).
            </li>
            <li>
              Unequivocal conduct by the data subject that allows the
              conclusion that authorization was granted (for example,
              voluntarily submitting data through forms).
            </li>
            <li>
              Any other mechanism that guarantees the subsequent consultation
              of the authorization.
            </li>
          </ul>
          <p className="mt-4">
            Authorization will not be required when it concerns: (a) data
            required by a public entity in the exercise of its functions, (b)
            data of a public nature, (c) cases of medical or health emergency,
            or (d) treatment authorized by law.
          </p>
        </section>

        {/* 5 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            5. Persons authorized to process data
          </h2>
          <p className="mb-4">
            Personal data may be processed by:
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong className="text-text-primary">
                Automation AI S.A.S:
              </strong>{" "}
              as data controller.
            </li>
            <li>
              <strong className="text-text-primary">
                Employees and contractors:
              </strong>{" "}
              from the technical and support areas, who require access to
              fulfill their duties, subject to confidentiality agreements.
            </li>
            <li>
              <strong className="text-text-primary">
                Data processors:
              </strong>{" "}
              third-party service providers acting on behalf of and under the
              instructions of the Company, in accordance with data
              transmission contracts that guarantee adequate protection.
              These include: hosting and infrastructure providers, AI model
              providers (OpenAI, Anthropic, Google), Meta/WhatsApp Business
              API, payment processors.
            </li>
          </ul>
        </section>

        {/* 6 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            6. Procedure to exercise rights
          </h2>
          <p className="mb-4">
            Data subjects may exercise their rights by submitting a request to
            the Company through the following channels:
          </p>
          <div className="bg-surface rounded-xl border border-border p-6 space-y-3 mb-6">
            <p>
              <strong className="text-text-primary">Email:</strong>{" "}
              <a
                href="mailto:cloud.manager@parallext.com"
                className="text-accent hover:underline"
              >
                cloud.manager@parallext.com
              </a>
            </p>
            <p>
              <strong className="text-text-primary">Email subject:</strong>{" "}
              &quot;Exercise of rights — Personal Data&quot;
            </p>
          </div>

          <p className="mb-4">
            The request must contain at least:
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              Full name and identification document of the data subject.
            </li>
            <li>
              Clear and precise description of the facts and the right that
              they wish to exercise.
            </li>
            <li>
              Physical and/or electronic address to receive the response.
            </li>
            <li>
              Documents supporting the request, if applicable.
            </li>
          </ul>

          <h3 className="text-lg font-medium text-text-primary mt-6 mb-3">
            Response times
          </h3>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong className="text-text-primary">Inquiries:</strong> the
              Company will respond within a maximum period of ten (10)
              business days from the date of receipt of the request.
            </li>
            <li>
              <strong className="text-text-primary">Claims:</strong> the
              Company will respond within a maximum period of fifteen (15)
              business days from the date of receipt of the claim.
            </li>
            <li>
              If it is not possible to address the inquiry or claim within the
              indicated periods, the data subject will be informed of the
              reasons for the delay and the date on which it will be
              addressed, which may not exceed five (5) additional business
              days for inquiries and eight (8) additional business days for
              claims.
            </li>
          </ul>
        </section>

        {/* 7 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            7. Area responsible for handling petitions, inquiries and claims
          </h2>
          <div className="bg-surface rounded-xl border border-border p-6 space-y-3">
            <p>
              <strong className="text-text-primary">
                Data Protection Officer (DPO):
              </strong>{" "}
              Andres Felipe Matallana
            </p>
            <p>
              <strong className="text-text-primary">Email:</strong>{" "}
              <a
                href="mailto:cloud.manager@parallext.com"
                className="text-accent hover:underline"
              >
                cloud.manager@parallext.com
              </a>
            </p>
            <p>
              <strong className="text-text-primary">Address:</strong> Bogotá,
              D.C., Colombia
            </p>
          </div>
          <p className="mt-4">
            The Data Protection Officer is responsible for processing the
            requests of data subjects to enforce their rights, as well as
            ensuring compliance with this policy and current regulations on
            personal data protection.
          </p>
        </section>

        {/* 8 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            8. Validity of the databases
          </h2>
          <p className="mb-4">
            The databases managed by the Company will be valid as long as the
            purpose of the treatment is maintained and there is a need to
            preserve the data. Specifically:
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong className="text-text-primary">
                Customer database:
              </strong>{" "}
              during the term of the contractual relationship and up to thirty
              (30) days after the termination of the service for data export
              purposes.
            </li>
            <li>
              <strong className="text-text-primary">
                Billing database:
              </strong>{" "}
              during the period required by Colombian tax legislation
              (minimum five years pursuant to the Estatuto Tributario /
              Colombian Tax Statute).
            </li>
            <li>
              <strong className="text-text-primary">
                Conversation database:
              </strong>{" "}
              according to the client&apos;s configuration, with a maximum of
              twenty-four (24) months from creation.
            </li>
            <li>
              <strong className="text-text-primary">
                Security logs:
              </strong>{" "}
              up to twelve (12) months for IT security and diagnostic purposes.
            </li>
          </ul>
          <p className="mt-4">
            Once the purpose of the treatment has been fulfilled and the
            applicable legal terms have elapsed, personal data will be securely
            deleted or irreversibly anonymized.
          </p>
        </section>

        {/* 9 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            9. Data transfer and transmission
          </h2>
          <p className="mb-4">
            The Company may carry out transfers and transmissions of personal
            data to third parties, both nationally and internationally, in
            accordance with articles 25 and 26 of Decreto 1377 de 2013:
          </p>

          <h3 className="text-lg font-medium text-text-primary mt-6 mb-3">
            9.1 Transmission (Data processors)
          </h3>
          <p className="mb-3">
            Data is transmitted to the following processors:
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong className="text-text-primary">
                Infrastructure providers:
              </strong>{" "}
              for hosting and operating the platform.
            </li>
            <li>
              <strong className="text-text-primary">
                Meta Platforms (WhatsApp Business API):
              </strong>{" "}
              for transmitting WhatsApp messages.
            </li>
            <li>
              <strong className="text-text-primary">
                AI model providers:
              </strong>{" "}
              OpenAI, Anthropic and Google for processing automated
              responses.
            </li>
            <li>
              <strong className="text-text-primary">
                Payment processors:
              </strong>{" "}
              for the management of financial transactions.
            </li>
          </ul>

          <h3 className="text-lg font-medium text-text-primary mt-6 mb-3">
            9.2 International transfer
          </h3>
          <p>
            Since some data processors are based abroad (United States,
            European Union), the Company guarantees that such transfers are
            carried out in accordance with applicable legal provisions,
            verifying that the destination countries have adequate levels of
            data protection or, failing that, signing contractual clauses that
            guarantee the protection of the personal data transferred, in
            accordance with article 26 of Ley 1581 de 2012.
          </p>
        </section>

        {/* 10 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            10. Security measures
          </h2>
          <p className="mb-4">
            The Company has adopted the following technical, administrative and
            human measures to protect personal data against unauthorized
            access, misuse, alteration, loss or destruction:
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong className="text-text-primary">
                AES-256-GCM encryption:
              </strong>{" "}
              for access tokens and sensitive data stored at rest.
            </li>
            <li>
              <strong className="text-text-primary">
                Encryption in transit:
              </strong>{" "}
              all communications are made via TLS 1.2+ (HTTPS).
            </li>
            <li>
              <strong className="text-text-primary">
                Business data isolation:
              </strong>{" "}
              each client organization operates in an isolated PostgreSQL
              database schema (one schema per business), ensuring that each
              client&apos;s data is logically separated.
            </li>
            <li>
              <strong className="text-text-primary">
                Role-based access control (RBAC):
              </strong>{" "}
              with four access levels (super_admin, tenant_admin,
              tenant_supervisor, tenant_agent).
            </li>
            <li>
              <strong className="text-text-primary">
                JWT authentication:
              </strong>{" "}
              with configurable expiration tokens.
            </li>
            <li>
              <strong className="text-text-primary">
                Webhook idempotency:
              </strong>{" "}
              deduplication mechanisms to avoid duplicate data processing.
            </li>
            <li>
              <strong className="text-text-primary">
                Backups:
              </strong>{" "}
              encrypted backups with retention and verified periodic
              restoration.
            </li>
            <li>
              <strong className="text-text-primary">
                Monitoring and auditing:
              </strong>{" "}
              logging of security and access events for anomaly detection.
            </li>
            <li>
              <strong className="text-text-primary">
                Confidentiality agreements:
              </strong>{" "}
              all employees and contractors with access to personal data are
              subject to confidentiality clauses.
            </li>
          </ul>
        </section>

        {/* 11 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            11. Cookies
          </h2>
          <p className="mb-4">
            The Parallly platform uses cookies and similar technologies to
            enhance the user experience. The categories of cookies used are:
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong className="text-text-primary">
                Strictly necessary cookies:
              </strong>{" "}
              required for the operation of the service (authentication,
              session, security).
            </li>
            <li>
              <strong className="text-text-primary">
                Analytics cookies:
              </strong>{" "}
              for usage analysis and platform improvement.
            </li>
            <li>
              <strong className="text-text-primary">
                Preference cookies:
              </strong>{" "}
              to remember user settings.
            </li>
          </ul>
          <p className="mt-4">
            Users can configure their browser to reject non-essential cookies.
            Disabling essential cookies may affect the operation of the
            platform. For more information, see our{" "}
            <Link href="/privacy" className="text-accent hover:underline">
              Privacy Policy
            </Link>
            .
          </p>
        </section>

        {/* 12 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            12. Modifications to this policy
          </h2>
          <p>
            The Company reserves the right to modify this Personal Data
            Treatment Policy at any time. Modifications will be published on
            the platform&apos;s website and notified to data subjects through
            the available communication channels. Changes will take effect
            from the date of their publication, unless a later date is
            indicated. Continued use of the platform after the publication of
            the modifications will constitute acceptance of the updated
            policy.
          </p>
        </section>

        {/* 13 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            13. Contact details of the Superintendencia de Industria y
            Comercio (SIC)
          </h2>
          <p className="mb-4">
            If the data subject considers that their rights have been violated
            or that the Company has failed to comply with data protection
            regulations, they may file a complaint with the Superintendencia
            de Industria y Comercio (Colombia&apos;s data protection
            authority):
          </p>
          <div className="bg-surface rounded-xl border border-border p-6 space-y-3">
            <p>
              <strong className="text-text-primary">Entity:</strong>{" "}
              Superintendencia de Industria y Comercio (SIC)
            </p>
            <p>
              <strong className="text-text-primary">Address:</strong> Carrera
              13 No. 27-00, Floors 1 to 7, Bogotá, D.C., Colombia
            </p>
            <p>
              <strong className="text-text-primary">
                Phone line:
              </strong>{" "}
              (601) 587 0000
            </p>
            <p>
              <strong className="text-text-primary">
                National toll-free line:
              </strong>{" "}
              01 8000 910 165
            </p>
            <p>
              <strong className="text-text-primary">Website:</strong>{" "}
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
              <strong className="text-text-primary">Email:</strong>{" "}
              <a
                href="mailto:contactenos@sic.gov.co"
                className="text-accent hover:underline"
              >
                contactenos@sic.gov.co
              </a>
            </p>
          </div>
          <p className="mt-4 text-text-muted text-sm">
            Before approaching the SIC, the data subject must have submitted
            their request directly to the Company and exhausted the inquiry or
            claim procedure, in accordance with articles 14 and 15 of Ley 1581
            de 2012.
          </p>
        </section>
      </div>
    </>
  );
}
