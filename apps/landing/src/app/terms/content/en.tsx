"use client";

import Link from "next/link";

export default function TermsEn() {
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
        Terms and Conditions
      </h1>
      <p className="text-text-muted text-sm mb-12">
        Last updated: April 2026
      </p>

      <div className="space-y-12 text-text-secondary leading-relaxed">
        {/* Intro */}
        <p>
          These Terms and Conditions (hereinafter, the &quot;Terms&quot;)
          govern the access to and use of the{" "}
          <strong className="text-text-primary">Parallly</strong>{" "}
          platform (parallly-chat.cloud), operated by{" "}
          <strong className="text-text-primary">Automation AI S.A.S</strong>{" "}
          (NIT: 902032943-1), with its registered office in Bogotá, Colombia. By
          accessing or using the service, you accept these Terms in their
          entirety.
        </p>

        {/* 1 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            1. Acceptance of the terms
          </h2>
          <p className="mb-4">
            By creating an account, accessing or using Parallly, you declare
            that:
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              You are at least 18 years old and have the legal capacity to enter
              into binding contracts.
            </li>
            <li>
              You are acting on your own behalf or as an authorized
              representative of a legal entity.
            </li>
            <li>
              You have read, understood and accept these Terms and our{" "}
              <Link href="/privacy" className="text-accent hover:underline">
                Privacy Policy
              </Link>
              .
            </li>
          </ul>
          <p className="mt-4">
            If you do not agree with these Terms, you must not use the service.
          </p>
        </section>

        {/* 2 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            2. Description of the service
          </h2>
          <p className="mb-4">
            Parallly is a software-as-a-service (SaaS) conversational
            artificial-intelligence platform designed to automate sales and
            customer support across messaging channels, primarily WhatsApp.
          </p>
          <p className="mb-4">
            The service includes, among other features:
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              Configurable AI agents that automatically respond to incoming
              messages.
            </li>
            <li>
              Multi-tenant architecture with data isolation per organization.
            </li>
            <li>
              Built-in CRM with shared inbox, conversation assignment and
              escalation to human agents.
            </li>
            <li>
              Integration with multiple language-model providers (OpenAI,
              Anthropic, Google, among others).
            </li>
            <li>
              Admin panel with metrics, persona configuration and team
              management.
            </li>
            <li>
              Native integration with the WhatsApp Business API through the Meta
              Cloud API.
            </li>
          </ul>
        </section>

        {/* 3 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            3. Registration and accounts
          </h2>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              To use Parallly, you must create an account by providing
              truthful, complete and up-to-date information.
            </li>
            <li>
              You are responsible for maintaining the confidentiality of your
              access credentials and for all activity carried out under your
              account.
            </li>
            <li>
              You must notify us immediately of any unauthorized use of your
              account.
            </li>
            <li>
              We reserve the right to suspend or cancel accounts that violate
              these Terms or contain false information.
            </li>
            <li>
              Each organization (tenant) may have multiple users with different
              roles: administrator, supervisor and agent.
            </li>
          </ul>
        </section>

        {/* 4 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            4. Plans and pricing
          </h2>
          <p className="mb-4">
            Parallly offers the following subscription plans:
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-3 pr-4 text-text-primary font-semibold">
                    Feature
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
                  <td className="py-3 pr-4">Conversations/month</td>
                  <td className="text-center py-3 px-4">500</td>
                  <td className="text-center py-3 px-4">5,000</td>
                  <td className="text-center py-3 px-4">Unlimited</td>
                </tr>
                <tr className="border-b border-border/50">
                  <td className="py-3 pr-4">AI agents</td>
                  <td className="text-center py-3 px-4">1</td>
                  <td className="text-center py-3 px-4">5</td>
                  <td className="text-center py-3 px-4">Unlimited</td>
                </tr>
                <tr className="border-b border-border/50">
                  <td className="py-3 pr-4">Team users</td>
                  <td className="text-center py-3 px-4">2</td>
                  <td className="text-center py-3 px-4">10</td>
                  <td className="text-center py-3 px-4">Unlimited</td>
                </tr>
                <tr className="border-b border-border/50">
                  <td className="py-3 pr-4">Support</td>
                  <td className="text-center py-3 px-4">Email</td>
                  <td className="text-center py-3 px-4">Priority</td>
                  <td className="text-center py-3 px-4">Dedicated</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-4 text-text-muted text-sm">
            Current prices are published on the pricing page at
            parallly-chat.cloud. We reserve the right to change prices with at
            least 30 days&apos; prior notice.
          </p>
        </section>

        {/* 5 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            5. Trial period
          </h2>
          <p>
            Parallly offers a free 7-calendar-day trial period for new users.
            During this period, you will have access to the features of the Pro
            plan. At the end of the trial period, if you have not selected a
            paid plan, your account will become inactive and no messages will be
            processed until you activate a subscription. No automatic charge
            will be made at the end of the trial unless you have explicitly
            selected a paid plan.
          </p>
        </section>

        {/* 6 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            6. Billing and payments
          </h2>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              Subscriptions are billed monthly or annually, according to the
              billing cycle selected.
            </li>
            <li>
              Payments are processed through PCI-DSS-certified payment
              providers. We do not store credit-card data on our servers.
            </li>
            <li>
              Invoices are issued electronically in accordance with current
              Colombian regulations.
            </li>
            <li>
              Prices do not include applicable taxes, which will be calculated
              based on the customer&apos;s jurisdiction.
            </li>
            <li>
              In the event of non-payment, we reserve the right to suspend the
              service after 7 days past due, and to cancel the account after 30
              days of continued non-payment.
            </li>
            <li>
              No refunds are given for partial usage periods, except in
              exceptional cases evaluated individually.
            </li>
          </ul>
        </section>

        {/* 7 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            7. Acceptable use
          </h2>
          <p className="mb-4">
            By using Parallly, you agree not to:
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              Send unsolicited messages (spam) or mass communications without
              the recipient&apos;s prior consent.
            </li>
            <li>
              Use the platform for illegal or fraudulent activities, or for
              activities that infringe third-party rights.
            </li>
            <li>
              Distribute content that is illegal, defamatory, obscene,
              threatening, hateful or that violates intellectual-property
              rights.
            </li>
            <li>
              Attempt to access data of other tenants or to circumvent the
              platform&apos;s security mechanisms.
            </li>
            <li>
              Reverse-engineer, decompile or disassemble any part of the
              software.
            </li>
            <li>
              Exceed the usage limits of your plan (API rate limits, monthly
              conversations, etc.) through evasion techniques.
            </li>
            <li>
              Use bots, scrapers or other automated tools to access the service
              outside the APIs provided.
            </li>
            <li>
              Resell, sublicense or redistribute the service without written
              authorization.
            </li>
          </ul>
          <p className="mt-4">
            Failure to comply with these rules may result in immediate
            suspension or cancellation of the account, with no right to a
            refund.
          </p>
        </section>

        {/* 8 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            8. Intellectual property
          </h2>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              Parallly, including its software, design, logos, trademarks and
              documentation, is the exclusive property of Automation AI S.A.S
              or its licensors.
            </li>
            <li>
              You are granted a limited, non-exclusive, non-transferable and
              revocable license to use the service in accordance with these
              Terms and the contracted plan.
            </li>
            <li>
              You do not acquire any ownership rights over the software or the
              platform through use of the service.
            </li>
            <li>
              AI-agent configurations, persona templates and flows created by
              the customer within the platform are the property of the
              customer.
            </li>
          </ul>
        </section>

        {/* 9 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            9. Customer data
          </h2>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              The customer retains ownership of all data that they enter,
              process or store through the platform (the &quot;Customer
              Data&quot;).
            </li>
            <li>
              Parallly acts as data processor of the Customer Data in
              accordance with our{" "}
              <Link href="/privacy" className="text-accent hover:underline">
                Privacy Policy
              </Link>{" "}
              and the applicable data-processing agreements.
            </li>
            <li>
              We undertake not to access, use or disclose the Customer Data
              except where necessary to: (a) provide the service, (b) comply
              with legal obligations, or (c) with the express consent of the
              customer.
            </li>
            <li>
              The customer is responsible for obtaining the consents and
              authorizations needed from their end-users for processing their
              data through the platform.
            </li>
            <li>
              In the event of service termination, the customer may request the
              export of their data within the following 30 days. After this
              period, the data will be securely deleted.
            </li>
          </ul>
        </section>

        {/* 10 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            10. Limitation of liability
          </h2>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              The service is provided &quot;as is&quot; and &quot;as
              available&quot;, without warranties of any kind, express or
              implied.
            </li>
            <li>
              Parallly does not warrant that the service will be uninterrupted,
              error-free or that it will meet every specific requirement of the
              customer.
            </li>
            <li>
              We are not responsible for the responses generated by the AI
              models, which may contain inaccuracies. The customer is
              responsible for supervising and validating the generated content.
            </li>
            <li>
              In no event shall the total liability of Automation AI S.A.S
              exceed the total amount paid by the customer during the 12 months
              preceding the event giving rise to the claim.
            </li>
            <li>
              We will not be liable for indirect, incidental, special,
              consequential or punitive damages, including loss of profits,
              data, use or goodwill.
            </li>
            <li>
              Parallly will not be liable for service interruptions caused by:
              (a) scheduled maintenance, (b) force majeure, (c) failures of
              third-party providers (Meta, AI providers, hosting), or (d) the
              customer&apos;s actions.
            </li>
          </ul>
        </section>

        {/* 11 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            11. Indemnification
          </h2>
          <p>
            The customer agrees to indemnify, defend and hold harmless
            Automation AI S.A.S, its directors, employees, agents and
            affiliates, from and against any claim, damage, loss, liability,
            cost or expense (including attorneys&apos; fees) arising out of or
            related to: (a) the customer&apos;s use of the service, (b) the
            violation of these Terms, (c) the violation of third-party rights,
            or (d) the content processed through the platform by the customer
            or their end-users.
          </p>
        </section>

        {/* 12 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            12. Termination of the service
          </h2>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              The customer may cancel their subscription at any time from the
              admin panel. The cancellation will be effective at the end of the
              current billing period.
            </li>
            <li>
              We reserve the right to suspend or cancel the service immediately
              in the event of: (a) violation of these Terms, (b) fraudulent or
              illegal activity, (c) continued non-payment, or (d) legal
              requirement.
            </li>
            <li>
              In case of termination, the customer may export their data within
              the following 30 days. After this period, all data will be
              securely deleted.
            </li>
            <li>
              The obligations of confidentiality, intellectual property,
              limitation of liability and indemnification will survive
              termination.
            </li>
          </ul>
        </section>

        {/* 13 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            13. Modifications to the terms
          </h2>
          <p>
            We reserve the right to modify these Terms at any time. Significant
            changes will be notified through a notice on the platform or by
            email at least 30 days in advance. Continued use of the service
            after the changes take effect constitutes acceptance of the
            modified Terms. If you do not agree with the modifications, you may
            cancel your subscription before the effective date.
          </p>
        </section>

        {/* 14 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            14. Governing law and dispute resolution
          </h2>
          <p className="mb-4">
            These Terms are governed by and construed in accordance with the
            laws of the Republic of Colombia.
          </p>
          <p className="mb-4">
            Any controversy arising in connection with these Terms will be
            resolved as follows:
          </p>
          <ol className="list-decimal pl-6 space-y-2">
            <li>
              <strong className="text-text-primary">
                Direct negotiation:
              </strong>{" "}
              the parties will attempt to resolve the dispute in good faith
              over a period of 30 business days.
            </li>
            <li>
              <strong className="text-text-primary">Mediation:</strong> if
              direct negotiation is not successful, the parties may resort to a
              mediator designated by mutual agreement.
            </li>
            <li>
              <strong className="text-text-primary">Arbitration:</strong> as a
              last resort, the dispute will be resolved through arbitration
              administered by the Centro de Arbitraje y Conciliación de la
              Cámara de Comercio de Bogotá (Arbitration and Conciliation Center
              of the Bogotá Chamber of Commerce), in accordance with its rules
              in force. The arbitral award will be final and binding.
            </li>
          </ol>
        </section>

        {/* 15 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            15. General provisions
          </h2>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong className="text-text-primary">Entire agreement:</strong>{" "}
              these Terms, together with the Privacy Policy and the Data
              Processing Policy, constitute the entire agreement between the
              parties and supersede any prior agreement.
            </li>
            <li>
              <strong className="text-text-primary">Severability:</strong> if
              any provision of these Terms is held invalid or unenforceable,
              the remaining provisions will remain in full force and effect.
            </li>
            <li>
              <strong className="text-text-primary">Assignment:</strong> the
              customer may not assign or transfer these Terms without the prior
              written consent of Automation AI S.A.S.
            </li>
            <li>
              <strong className="text-text-primary">Waiver:</strong> the
              failure to exercise any right under these Terms will not
              constitute a waiver of that right.
            </li>
            <li>
              <strong className="text-text-primary">Force majeure:</strong>{" "}
              neither party will be responsible for breach caused by events
              beyond their reasonable control, including natural disasters,
              pandemics, wars, acts of government or third-party infrastructure
              failures.
            </li>
            <li>
              <strong className="text-text-primary">Notices:</strong> legal
              notices will be sent to the email address registered in the
              customer&apos;s account. Notices to Automation AI S.A.S must be
              sent to{" "}
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
            Contact
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
              Colombia
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
              <strong className="text-text-primary">Support:</strong>{" "}
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
