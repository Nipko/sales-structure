import Link from "next/link";

export default function PrivacyEn() {
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
        Privacy Policy
      </h1>
      <p className="text-text-muted text-sm mb-12">
        Last updated: April 29, 2026
      </p>

      <div className="space-y-12 text-text-secondary leading-relaxed">
        {/* Intro */}
        <p>
          At <strong className="text-text-primary">Automation AI S.A.S</strong>{" "}
          (NIT: 902032943-1), operator of the{" "}
          <strong className="text-text-primary">Parallly</strong>{" "}
          platform (parallly-chat.cloud), we are committed to protecting the
          privacy of our users. This Privacy Policy describes how we collect,
          use, share, and protect your personal information when you use our
          services.
        </p>
        <p>
          This policy complies with the European Union General Data Protection
          Regulation (GDPR), the California Consumer Privacy Act (CCPA), the
          Brazilian General Data Protection Law (LGPD), and Colombia&apos;s Law
          1581 of 2012, as well as the complementary regulations applicable in
          each jurisdiction.
        </p>

        {/* 1 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            1. Information we collect
          </h2>

          <h3 className="text-lg font-medium text-text-primary mt-6 mb-3">
            1.1 Personal data provided directly
          </h3>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              Registration information: full name, email address, phone number,
              company name, job title.
            </li>
            <li>
              Billing information: credit card details or payment method
              (processed by PCI DSS-certified payment providers; we do not
              store card data).
            </li>
            <li>
              Communication content: messages sent through the platform in the
              context of technical support.
            </li>
          </ul>

          <h3 className="text-lg font-medium text-text-primary mt-6 mb-3">
            1.2 Usage data
          </h3>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              IP address, browser type, operating system, pages visited, date
              and time of access.
            </li>
            <li>
              Service usage metrics: number of conversations, messages
              processed, agents configured.
            </li>
            <li>Activity logs for security and diagnostics.</li>
          </ul>

          <h3 className="text-lg font-medium text-text-primary mt-6 mb-3">
            1.3 End-user data
          </h3>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              WhatsApp phone number, profile name, and content of messages sent
              to the customer&apos;s business.
            </li>
            <li>
              This data is processed on behalf of the customer (data
              controller) and Parallly acts as the data processor in accordance
              with applicable data processing agreements.
            </li>
          </ul>

          <h3 className="text-lg font-medium text-text-primary mt-6 mb-3">
            1.4 Cookies and similar technologies
          </h3>
          <p>
            We use essential cookies for the operation of the platform,
            analytics cookies to improve the user experience, and preference
            cookies. See section 9 of this policy for more details.
          </p>
        </section>

        {/* 2 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            2. How we use your information
          </h2>
          <p className="mb-4">
            We use the information collected for the following purposes:
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              Provide, maintain, and improve our AI-powered conversational
              automation services.
            </li>
            <li>
              Process payments and manage your account and subscription.
            </li>
            <li>
              Send transactional communications (confirmations, service
              notifications, security alerts).
            </li>
            <li>
              Send commercial communications about updates and new features
              (with your prior consent).
            </li>
            <li>
              Analyze usage patterns to optimize platform performance and user
              experience.
            </li>
            <li>
              Train and improve internal AI models (data is anonymized and
              aggregated; identifiable personal data is never used for training
              without explicit consent).
              <strong className="text-text-primary">
                {" "}This purpose does NOT apply to data obtained through
                Google Workspace APIs (including Google Calendar).
              </strong>{" "}
              That data is governed exclusively by section 12 (Limited Use) of
              this policy.
            </li>
            <li>
              Comply with legal obligations, resolve disputes, and enforce our
              agreements.
            </li>
            <li>
              Prevent fraud, illegal activities, and protect the security of
              the platform.
            </li>
          </ul>
        </section>

        {/* 3 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            3. Legal basis for processing
          </h2>
          <p className="mb-4">
            In accordance with GDPR (Art. 6) and equivalent regulations, we
            process personal data based on the following legal bases:
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong className="text-text-primary">
                Performance of a contract:
              </strong>{" "}
              processing is necessary for the provision of the contracted
              service (account creation, message processing, billing).
            </li>
            <li>
              <strong className="text-text-primary">
                Consent:
              </strong>{" "}
              for commercial communications, non-essential cookies, and data
              processing for advanced analytics purposes.
            </li>
            <li>
              <strong className="text-text-primary">
                Legitimate interest:
              </strong>{" "}
              for platform security, fraud prevention, service improvement,
              and aggregate usage analysis.
            </li>
            <li>
              <strong className="text-text-primary">
                Legal obligation:
              </strong>{" "}
              to comply with applicable tax, accounting, and regulatory
              requirements.
            </li>
          </ul>
          <p className="mt-4">
            For LGPD (Brazil), in addition to the bases above, we rely on the
            controller&apos;s legitimate interest and credit protection where
            applicable.
          </p>
          <p className="mt-2">
            For Law 1581 of 2012 (Colombia), processing is carried out in
            accordance with the authorization granted by the data subject.
          </p>
        </section>

        {/* 4 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            4. Sharing data with third parties
          </h2>
          <p className="mb-4">
            We do not sell personal data. We share information only in the
            following cases:
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong className="text-text-primary">
                Meta / WhatsApp Business API:
              </strong>{" "}
              messages are transmitted through Meta&apos;s WhatsApp Cloud API.
              Meta acts as an independent processor in accordance with its own
              privacy policies.
            </li>
            <li>
              <strong className="text-text-primary">
                AI model providers:
              </strong>{" "}
              OpenAI, Anthropic, Google, and other language model providers
              process the content of conversations to generate responses. Data
              is sent securely via API and is subject to each provider&apos;s
              data processing agreements.
            </li>
            <li>
              <strong className="text-text-primary">
                Infrastructure providers:
              </strong>{" "}
              hosting, database, and CDN services necessary to operate the
              platform.
            </li>
            <li>
              <strong className="text-text-primary">
                Payment processors:
              </strong>{" "}
              to securely manage transactions (PCI DSS certification).
            </li>
            <li>
              <strong className="text-text-primary">
                Competent authorities:
              </strong>{" "}
              when required by law, court order, or valid legal process.
            </li>
          </ul>
          <p className="mt-4">
            All third parties are bound by data processing agreements (DPAs)
            that guarantee adequate levels of protection.
          </p>
        </section>

        {/* 5 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            5. International data transfers
          </h2>
          <p className="mb-4">
            Since we operate globally and use service providers with
            distributed infrastructure, your data may be transferred and
            processed in countries outside your jurisdiction, including the
            United States and the European Union.
          </p>
          <p className="mb-4">
            To ensure adequate protection of internationally transferred data,
            we implement the following safeguards:
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              Standard Contractual Clauses (SCCs) approved by the European
              Commission.
            </li>
            <li>
              Transfer Impact Assessments (TIAs) where applicable.
            </li>
            <li>
              Contracts with providers that include data protection commitments
              equivalent to the GDPR.
            </li>
            <li>
              For Colombia: authorization from the data subject in accordance
              with article 26 of Decree 1377 of 2013.
            </li>
            <li>
              For Brazil: compliance with article 33 of the LGPD for
              international transfers.
            </li>
          </ul>
        </section>

        {/* 6 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            6. Data security
          </h2>
          <p className="mb-4">
            We implement technical and organizational measures to protect your
            personal data:
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong className="text-text-primary">
                AES-256-GCM encryption:
              </strong>{" "}
              access tokens and sensitive data are encrypted at rest using
              AES-256-GCM.
            </li>
            <li>
              <strong className="text-text-primary">
                Business data isolation:
              </strong>{" "}
              each customer operates in an isolated database schema (one schema per business),
              ensuring logical data separation between organizations.
            </li>
            <li>
              <strong className="text-text-primary">Encryption in transit:</strong>{" "}
              all communications use TLS 1.2+ (HTTPS).
            </li>
            <li>
              <strong className="text-text-primary">
                Secure authentication:
              </strong>{" "}
              JWT with configurable expiration and role-based access control
              (RBAC).
            </li>
            <li>
              <strong className="text-text-primary">
                Continuous monitoring:
              </strong>{" "}
              security event logging, anomaly detection, and incident
              response.
            </li>
            <li>
              <strong className="text-text-primary">
                Backups:
              </strong>{" "}
              encrypted backups with configurable retention.
            </li>
          </ul>
        </section>

        {/* 7 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            7. Data retention
          </h2>
          <p className="mb-4">
            We retain personal data only for as long as necessary to fulfill
            the purposes described in this policy:
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong className="text-text-primary">Account data:</strong>{" "}
              for the duration of the contractual relationship and up to 30
              days after termination, unless a longer legal retention
              obligation applies.
            </li>
            <li>
              <strong className="text-text-primary">
                Conversation data:
              </strong>{" "}
              according to customer configuration, with a maximum of 24 months
              from creation.
            </li>
            <li>
              <strong className="text-text-primary">
                Billing data:
              </strong>{" "}
              for the period required by applicable tax legislation (minimum
              5 years in Colombia).
            </li>
            <li>
              <strong className="text-text-primary">
                Security logs:
              </strong>{" "}
              up to 12 months for security and diagnostic purposes.
            </li>
            <li>
              <strong className="text-text-primary">Anonymized data:</strong>{" "}
              aggregated and anonymized data may be retained indefinitely for
              analytical purposes.
            </li>
          </ul>
        </section>

        {/* 8 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            8. Your rights
          </h2>

          <h3 className="text-lg font-medium text-text-primary mt-6 mb-3">
            8.1 Rights under the GDPR (European Union / EEA)
          </h3>
          <p className="mb-3">
            If you are a resident of the European Economic Area, you have the
            following rights:
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong className="text-text-primary">Access:</strong> request a
              copy of your personal data.
            </li>
            <li>
              <strong className="text-text-primary">Rectification:</strong>{" "}
              correct inaccurate or incomplete data.
            </li>
            <li>
              <strong className="text-text-primary">Erasure:</strong>{" "}
              request the deletion of your data (&quot;right to be
              forgotten&quot;).
            </li>
            <li>
              <strong className="text-text-primary">Portability:</strong>{" "}
              receive your data in a structured, machine-readable format.
            </li>
            <li>
              <strong className="text-text-primary">Objection:</strong>{" "}
              object to processing based on legitimate interest.
            </li>
            <li>
              <strong className="text-text-primary">
                Restriction of processing:
              </strong>{" "}
              restrict processing in certain circumstances.
            </li>
            <li>
              <strong className="text-text-primary">
                Withdraw consent:
              </strong>{" "}
              at any time, without affecting the lawfulness of prior
              processing.
            </li>
            <li>
              <strong className="text-text-primary">
                Complaint to authority:
              </strong>{" "}
              file a complaint with your data protection authority.
            </li>
          </ul>

          <h3 className="text-lg font-medium text-text-primary mt-6 mb-3">
            8.2 Rights under the CCPA (California, USA)
          </h3>
          <p className="mb-3">
            If you are a California resident, you have the following rights:
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong className="text-text-primary">Right to know:</strong>{" "}
              request information about the categories and specific pieces of
              personal data collected.
            </li>
            <li>
              <strong className="text-text-primary">
                Right to delete:
              </strong>{" "}
              request the deletion of your personal data.
            </li>
            <li>
              <strong className="text-text-primary">
                Right to opt-out:
              </strong>{" "}
              we do not sell personal data. If this changes, we will provide
              an opt-out mechanism in accordance with the CCPA.
            </li>
            <li>
              <strong className="text-text-primary">
                Non-discrimination:
              </strong>{" "}
              we do not discriminate against users who exercise their rights
              under the CCPA.
            </li>
          </ul>

          <h3 className="text-lg font-medium text-text-primary mt-6 mb-3">
            8.3 Rights under Law 1581 of 2012 (Colombia)
          </h3>
          <p className="mb-3">
            As a personal data subject in Colombia, you have the right to:
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              Know, update, and rectify your personal data.
            </li>
            <li>
              Request proof of the authorization granted for processing.
            </li>
            <li>
              Be informed about the use given to your data.
            </li>
            <li>
              File complaints with the Superintendence of Industry and
              Commerce (SIC) for violations of the law.
            </li>
            <li>
              Revoke authorization and/or request the deletion of your data
              when constitutional and legal principles, rights, and guarantees
              are not respected.
            </li>
            <li>
              Access your personal data subject to processing free of charge.
            </li>
          </ul>
          <p className="mt-3">
            To exercise these rights, see our{" "}
            <Link
              href="/data-policy"
              className="text-accent hover:underline"
            >
              Personal Data Processing Policy
            </Link>
            .
          </p>

          <h3 className="text-lg font-medium text-text-primary mt-6 mb-3">
            8.4 Rights under the LGPD (Brazil)
          </h3>
          <p className="mb-3">
            If you are a data subject in Brazil, you have the right to:
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              Confirmation of the existence of processing of your data.
            </li>
            <li>Access to your personal data.</li>
            <li>
              Correction of incomplete, inaccurate, or outdated data.
            </li>
            <li>
              Anonymization, blocking, or deletion of unnecessary, excessive,
              or data processed in non-compliance with the LGPD.
            </li>
            <li>Portability of data to another service provider.</li>
            <li>
              Deletion of personal data processed based on consent.
            </li>
            <li>
              Information about public and private entities with which data
              has been shared.
            </li>
            <li>
              Withdrawal of consent at any time.
            </li>
          </ul>
        </section>

        {/* 9 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            9. Cookies and similar technologies
          </h2>
          <p className="mb-4">
            We use the following categories of cookies:
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong className="text-text-primary">
                Essential cookies:
              </strong>{" "}
              necessary for the operation of the service (authentication,
              security, session preferences). They cannot be disabled.
            </li>
            <li>
              <strong className="text-text-primary">
                Analytics cookies:
              </strong>{" "}
              help us understand how you interact with the platform to improve
              the experience. They can be disabled.
            </li>
            <li>
              <strong className="text-text-primary">
                Preference cookies:
              </strong>{" "}
              remember your settings (language, time zone). They can be
              disabled.
            </li>
          </ul>
          <p className="mt-4">
            You can manage your cookie preferences from your browser settings.
            Please note that disabling certain cookies may affect the
            functionality of the service.
          </p>
        </section>

        {/* 10 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            10. Minors
          </h2>
          <p>
            Parallly is not directed at people under 18 years of age. We do
            not knowingly collect personal data from minors. If we become
            aware that we have collected data from a minor without verifiable
            consent from a parent or guardian, we will take steps to delete
            such information from our systems. If you believe we may have
            collected information from a minor, contact us at{" "}
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
            11. Changes to this policy
          </h2>
          <p>
            We reserve the right to update this Privacy Policy at any time. We
            will notify significant changes through a notice on the platform
            or by email at least 30 days before they take effect. Continued
            use of the service after the effective date constitutes acceptance
            of the updated policy.
          </p>
        </section>

        {/* 12 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            12. Google Services and compliance with the Google API Services
            User Data Policy
          </h2>
          <p className="mb-4">
            Parallly integrates with Google services (Google Sign-In and
            Google Calendar) via OAuth 2.0. This section specifically
            describes how we treat data obtained through Google APIs and our
            commitment to the Limited Use restrictions.
          </p>

          <h3 className="text-lg font-medium text-text-primary mt-6 mb-3">
            12.1 Google scopes we request
          </h3>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong className="text-text-primary">
                openid, email, profile
              </strong>{" "}
              — used only when you sign in with Google. They allow us to
              authenticate you, display your name and profile picture inside
              the application, and link your Google account to your Parallly
              user.
            </li>
            <li>
              <strong className="text-text-primary">
                https://www.googleapis.com/auth/calendar
              </strong>{" "}
              — requested only if you connect Google Calendar as an
              appointment provider. We use it exclusively to create, update,
              move, and cancel calendar events associated with the
              appointments you manage within Parallly, and to verify
              availability when scheduling.
            </li>
          </ul>
          <p className="mt-3">
            We do not request or access Gmail, Drive, Contacts, or any other
            Google service outside of those listed above.
          </p>

          <h3 className="text-lg font-medium text-text-primary mt-6 mb-3">
            12.2 How we use Google data
          </h3>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              Profile data (name, email, picture) is used solely for
              authentication, identification within the application, and
              account linking.
            </li>
            <li>
              Google Calendar data is used solely to create, modify, read
              availability, and delete events directly related to the
              appointments the user manages in Parallly.
            </li>
            <li>
              We store the Google refresh token encrypted with AES-256-GCM and
              the email of the connected account. We do not store copies of
              calendar events outside the operational context necessary to
              display the appointment status.
            </li>
          </ul>

          <h3 className="text-lg font-medium text-text-primary mt-6 mb-3">
            12.3 Limited Use Statement
          </h3>
          <p className="mb-4">
            <em>
              The use of raw or derived user data received from Workspace APIs
              will adhere to the Google User Data Policy, including the
              Limited Use requirements.
            </em>
          </p>
          <p className="mb-4">
            Accordingly, we commit that data obtained from Google Workspace
            APIs:
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong className="text-text-primary">
                Is not used to display advertising
              </strong>{" "}
              — neither in Parallly nor in any external system.
            </li>
            <li>
              <strong className="text-text-primary">
                Is not sold, transferred, or assigned
              </strong>{" "}
              to third parties for advertising, marketing, lead generation, or
              database creation purposes.
            </li>
            <li>
              <strong className="text-text-primary">
                Is not used to train artificial intelligence models
              </strong>{" "}
              — neither our own nor third-party (OpenAI, Anthropic, Google AI,
              DeepSeek, xAI, or any other). Google calendar and profile data
              are never sent to LLM model providers.
            </li>
            <li>
              <strong className="text-text-primary">
                Is not read by humans
              </strong>{" "}
              except in the cases expressly permitted by Google: (a) with
              your explicit consent, (b) for security purposes (abuse or
              breach investigation), (c) to comply with applicable law, or
              (d) when the data has been irreversibly aggregated and
              anonymized and is used solely for internal operational
              purposes.
            </li>
          </ul>

          <h3 className="text-lg font-medium text-text-primary mt-6 mb-3">
            12.4 Revocation of access
          </h3>
          <p>
            You can revoke Parallly&apos;s access to your Google account at
            any time from your{" "}
            <a
              href="https://myaccount.google.com/permissions"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:underline"
            >
              Google permissions panel
            </a>
            , or from the settings &gt; integrations section within Parallly.
            When you revoke access we delete the encrypted refresh token and
            disable the integration. To request the complete deletion of
            associated data, write to us at{" "}
            <a
              href="mailto:cloud.manager@parallext.com"
              className="text-accent hover:underline"
            >
              cloud.manager@parallext.com
            </a>
            .
          </p>
        </section>

        {/* 13 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            13. Meta Platforms (WhatsApp / Instagram / Messenger)
          </h2>
          <p className="mb-4">
            Parallly integrates with Meta&apos;s messaging platforms (WhatsApp
            Business Cloud API, Instagram Messaging, and Messenger) via OAuth
            through Embedded Signup and Facebook Login. This section
            specifically describes how we treat data obtained through Meta
            APIs and the limited-use commitments we make for that data.
          </p>

          <h3 className="text-lg font-medium text-text-primary mt-6 mb-3">
            13.1 Permissions / scopes we request per channel
          </h3>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong className="text-text-primary">WhatsApp:</strong>{" "}
              <code>whatsapp_business_management</code>,{" "}
              <code>whatsapp_business_messaging</code>,{" "}
              <code>business_management</code>.
            </li>
            <li>
              <strong className="text-text-primary">Instagram:</strong>{" "}
              <code>instagram_basic</code>,{" "}
              <code>instagram_manage_messages</code>,{" "}
              <code>pages_show_list</code>,{" "}
              <code>pages_manage_metadata</code>,{" "}
              <code>pages_read_engagement</code>.
            </li>
            <li>
              <strong className="text-text-primary">Messenger:</strong>{" "}
              <code>pages_messaging</code>, <code>pages_show_list</code>,{" "}
              <code>pages_read_engagement</code>,{" "}
              <code>pages_manage_metadata</code>.
            </li>
          </ul>
          <p className="mt-3">
            Each of these permissions is used only to: (a) authenticate the
            business owner via Embedded Signup or Facebook Login, (b) receive
            incoming messages via webhook, and (c) send replies on behalf of
            the connected business account. We do not request or access
            permissions other than those listed.
          </p>

          <h3 className="text-lg font-medium text-text-primary mt-6 mb-3">
            13.2 Embedded Signup (WhatsApp)
          </h3>
          <p>
            When you complete the Embedded Signup flow we receive a
            long-lived System User access token. We encrypt that token at
            rest with AES-256-GCM, store the WABA ID and phone number ID
            associated with your account, and never share the raw token
            with any third party, including LLM providers.
          </p>

          <h3 className="text-lg font-medium text-text-primary mt-6 mb-3">
            13.3 End-user data
          </h3>
          <p className="mb-4">
            Data about the contacts who message your business via WhatsApp,
            Instagram, or Messenger is handled within the following
            framework:
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              The business using Parallly is the{" "}
              <strong className="text-text-primary">data controller</strong>{" "}
              under GDPR, LGPD, Colombia&apos;s Law 1581 of 2012, and
              equivalent regulations.
            </li>
            <li>
              Parallly acts as the{" "}
              <strong className="text-text-primary">data processor</strong>{" "}
              and processes the data on the customer business&apos;s instructions, under
              the Data Processing Agreement (DPA) implicit in the Terms of
              Service.
            </li>
            <li>
              We process: phone number / Instagram or Facebook profile id,
              profile name, message content (text, image URL references,
              location), and timestamps. We do not request or receive email
              or any other Workspace-style PII from Meta.
            </li>
            <li>
              Message content is forwarded to the LLM provider configured
              by the customer business (OpenAI, Anthropic, Google Gemini, DeepSeek, or
              xAI) for the sole purpose of generating the conversational
              reply, under each provider&apos;s standard data-processing
              terms.
            </li>
            <li>
              We retain conversation content for the duration configured by
              the customer business, capped at 24 months.
            </li>
          </ul>

          <h3 className="text-lg font-medium text-text-primary mt-6 mb-3">
            13.4 Use commitments
          </h3>
          <p className="mb-4">
            With respect to data obtained through Meta&apos;s platforms, we
            commit that such data:
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong className="text-text-primary">
                Is not used to display advertising
              </strong>{" "}
              — neither in Parallly nor in any external system.
            </li>
            <li>
              <strong className="text-text-primary">
                Is not sold, transferred, or assigned
              </strong>{" "}
              to third parties for advertising, marketing, lead generation,
              or database creation purposes.
            </li>
            <li>
              <strong className="text-text-primary">
                Is not used to train artificial intelligence models
              </strong>{" "}
              — neither our own nor third-party. Conversation content is
              sent to the LLM solely to generate the immediate reply for
              the current turn, never as training data.
            </li>
            <li>
              <strong className="text-text-primary">
                Is not read by humans
              </strong>{" "}
              except in the cases expressly permitted by Meta: (a) with
              your explicit consent, (b) for security purposes (abuse or
              breach investigation), (c) to comply with applicable law, or
              (d) when the data has been irreversibly aggregated and
              anonymized.
            </li>
          </ul>

          <h3 className="text-lg font-medium text-text-primary mt-6 mb-3">
            13.5 Deletion mechanism
          </h3>
          <p>
            Parallly account holders can request deletion of their account and
            associated data through our{" "}
            <Link
              href="/data-deletion"
              className="text-accent hover:underline"
            >
              account and data deletion request
            </Link>{" "}
            page. We also receive signed requests from Meta at{" "}
            <code>
              https://api.parallly-chat.cloud/api/v1/meta/data-deletion-callback
            </code>
            . Each request receives a tracking code and enters our compliance
            process. Before deleting the account and applicable data, we verify
            the requester's identity and the scope of the request. We retain only
            information required for legal, security, or fraud-prevention purposes.
          </p>

          <h3 className="text-lg font-medium text-text-primary mt-6 mb-3">
            13.6 24-hour window and pre-approved templates
          </h3>
          <p>
            Per WhatsApp Business policy, outside the 24-hour service
            window after the customer&apos;s last message, only Meta-approved
            Message Templates may be sent. The end customer initiates the
            conversation, and our pipeline blocks free-form sends outside
            of that window. Each business that uses Parallly is responsible
            for obtaining opt-in from their contacts before initiating
            outbound campaigns.
          </p>

          <h3 className="text-lg font-medium text-text-primary mt-6 mb-3">
            13.7 Sub-processors
          </h3>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong className="text-text-primary">
                Meta Platforms Inc.
              </strong>{" "}
              — operator of WhatsApp Cloud API, Instagram Messaging, and
              Messenger.
            </li>
            <li>
              <strong className="text-text-primary">
                LLM model providers
              </strong>{" "}
              — OpenAI, Anthropic, Google AI, DeepSeek, and xAI, used per
              business configuration.
            </li>
            <li>
              <strong className="text-text-primary">
                Hosting / infrastructure providers
              </strong>{" "}
              — Hostinger (VPS) and Cloudflare (Tunnel and edge network).
            </li>
            <li>
              <strong className="text-text-primary">
                Email provider
              </strong>{" "}
              — SMTP service used for transactional email.
            </li>
          </ul>
          <p className="mt-3">
            All sub-processors are bound by data processing agreements
            (DPAs) that guarantee adequate levels of protection.
          </p>
        </section>

        {/* 14 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            14. Contact
          </h2>
          <p className="mb-4">
            To exercise any of your rights or for inquiries related to this
            policy, you can contact us through:
          </p>
          <div className="bg-surface rounded-xl border border-border p-6 space-y-3">
            <p>
              <strong className="text-text-primary">Controller:</strong>{" "}
              Automation AI S.A.S
            </p>
            <p>
              <strong className="text-text-primary">NIT:</strong> 902032943-1
            </p>
            <p>
              <strong className="text-text-primary">
                Data Protection Officer (DPO):
              </strong>{" "}
              Andres Felipe Matallana
            </p>
            <p>
              <strong className="text-text-primary">Privacy email:</strong>{" "}
              <a
                href="mailto:cloud.manager@parallext.com"
                className="text-accent hover:underline"
              >
                cloud.manager@parallext.com
              </a>
            </p>
            <p>
              <strong className="text-text-primary">Support email:</strong>{" "}
              <a
                href="mailto:support@parallext.com"
                className="text-accent hover:underline"
              >
                support@parallext.com
              </a>
            </p>
            <p>
              <strong className="text-text-primary">Address:</strong> Bogotá,
              Colombia
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
          </div>
          <p className="mt-6 text-text-muted text-sm">
            If you believe that the processing of your personal data infringes
            applicable regulations, you have the right to file a complaint
            with the competent data protection authority of your jurisdiction.
            In Colombia, the competent authority is the Superintendence of
            Industry and Commerce (SIC).
          </p>
        </section>
      </div>
    </>
  );
}
