"use client";

import Link from "next/link";

export default function TermsFr() {
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
        Retour à l&apos;accueil
      </Link>

      {/* Title */}
      <h1 className="text-4xl font-bold tracking-tight mb-4">
        Conditions générales d&apos;utilisation
      </h1>
      <p className="text-text-muted text-sm mb-12">
        Dernière mise à jour : 29 avril 2026
      </p>

      <div className="space-y-12 text-text-secondary leading-relaxed">
        {/* Intro */}
        <p>
          Les présentes conditions générales (ci-après, les
          &quot;Conditions&quot;) régissent l&apos;accès et l&apos;utilisation
          de la plateforme{" "}
          <strong className="text-text-primary">Parallly</strong>{" "}
          (parallly-chat.cloud), exploitée par{" "}
          <strong className="text-text-primary">Automation AI S.A.S</strong>{" "}
          (NIT : 902032943-1), dont le siège est situé à Bogotá, Colombie. En
          accédant au service ou en l&apos;utilisant, vous acceptez les
          présentes Conditions dans leur intégralité.
        </p>

        {/* 1 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            1. Acceptation des conditions
          </h2>
          <p className="mb-4">
            En créant un compte, en accédant à Parallly ou en l&apos;utilisant,
            vous déclarez que :
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              Vous avez au moins 18 ans et la capacité juridique de conclure
              des contrats engageants.
            </li>
            <li>
              Vous agissez en votre nom propre ou en tant que représentant
              autorisé d&apos;une personne morale.
            </li>
            <li>
              Vous avez lu, compris et accepté les présentes Conditions ainsi
              que notre{" "}
              <Link href="/privacy" className="text-accent hover:underline">
                politique de confidentialité
              </Link>
              .
            </li>
          </ul>
          <p className="mt-4">
            Si vous n&apos;êtes pas d&apos;accord avec les présentes
            Conditions, vous ne devez pas utiliser le service.
          </p>
        </section>

        {/* 2 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            2. Description du service
          </h2>
          <p className="mb-4">
            Parallly est une plateforme de logiciel en tant que service (SaaS)
            d&apos;intelligence artificielle conversationnelle conçue pour
            automatiser les ventes et le support client sur les canaux de
            messagerie, principalement WhatsApp.
          </p>
          <p className="mb-4">
            Le service inclut, entre autres fonctionnalités :
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              Des agents d&apos;IA configurables qui répondent automatiquement
              aux messages entrants.
            </li>
            <li>
              Une architecture multi-tenant avec isolation des données par
              organisation.
            </li>
            <li>
              Un CRM intégré avec boîte de réception, attribution des
              conversations et escalade vers des agents humains.
            </li>
            <li>
              Une intégration avec plusieurs fournisseurs de modèles de langage
              (OpenAI, Anthropic, Google, entre autres).
            </li>
            <li>
              Un panneau d&apos;administration avec métriques, configuration
              des personas et gestion d&apos;équipe.
            </li>
            <li>
              Une intégration native avec l&apos;API WhatsApp Business via la
              Meta Cloud API.
            </li>
          </ul>
        </section>

        {/* 3 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            3. Inscription et comptes
          </h2>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              Pour utiliser Parallly, vous devez créer un compte en fournissant
              des informations exactes, complètes et à jour.
            </li>
            <li>
              Vous êtes responsable du maintien de la confidentialité de vos
              identifiants d&apos;accès et de toutes les activités effectuées
              sous votre compte.
            </li>
            <li>
              Vous devez nous notifier immédiatement toute utilisation non
              autorisée de votre compte.
            </li>
            <li>
              Nous nous réservons le droit de suspendre ou de résilier les
              comptes qui violent les présentes Conditions ou qui contiennent
              des informations fausses.
            </li>
            <li>
              Chaque organisation (tenant) peut comporter plusieurs
              utilisateurs avec différents rôles : administrateur, superviseur
              et agent.
            </li>
          </ul>
        </section>

        {/* 4 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            4. Forfaits et tarifs
          </h2>
          <p className="mb-4">
            Parallly propose les forfaits d&apos;abonnement suivants :
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-3 pr-4 text-text-primary font-semibold">
                    Caractéristique
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
                  <td className="py-3 pr-4">Conversations/mois</td>
                  <td className="text-center py-3 px-4">500</td>
                  <td className="text-center py-3 px-4">5 000</td>
                  <td className="text-center py-3 px-4">Illimitées</td>
                </tr>
                <tr className="border-b border-border/50">
                  <td className="py-3 pr-4">Agents d&apos;IA</td>
                  <td className="text-center py-3 px-4">1</td>
                  <td className="text-center py-3 px-4">5</td>
                  <td className="text-center py-3 px-4">Illimités</td>
                </tr>
                <tr className="border-b border-border/50">
                  <td className="py-3 pr-4">Utilisateurs de l&apos;équipe</td>
                  <td className="text-center py-3 px-4">2</td>
                  <td className="text-center py-3 px-4">10</td>
                  <td className="text-center py-3 px-4">Illimités</td>
                </tr>
                <tr className="border-b border-border/50">
                  <td className="py-3 pr-4">Support</td>
                  <td className="text-center py-3 px-4">E-mail</td>
                  <td className="text-center py-3 px-4">Prioritaire</td>
                  <td className="text-center py-3 px-4">Dédié</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-4 text-text-muted text-sm">
            Les tarifs en vigueur sont publiés sur la page de tarification de
            parallly-chat.cloud. Nous nous réservons le droit de modifier les
            tarifs avec un préavis d&apos;au moins 30 jours.
          </p>
        </section>

        {/* 5 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            5. Période d&apos;essai
          </h2>
          <p>
            Parallly offre une période d&apos;essai gratuite de 7 jours
            calendaires aux nouveaux utilisateurs. Pendant cette période, vous
            aurez accès aux fonctionnalités du forfait Pro. À l&apos;issue de
            la période d&apos;essai, si vous n&apos;avez pas sélectionné de
            forfait payant, votre compte passera en état inactif et aucun
            message ne sera traité tant que vous n&apos;aurez pas activé un
            abonnement. Aucun prélèvement automatique ne sera effectué à la fin
            de l&apos;essai sauf si vous avez explicitement choisi un forfait
            payant.
          </p>
        </section>

        {/* 6 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            6. Facturation et paiements
          </h2>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              Les abonnements sont facturés mensuellement ou annuellement,
              selon le cycle de facturation sélectionné.
            </li>
            <li>
              Les paiements sont traités par des prestataires de paiement
              certifiés PCI DSS. Nous ne stockons pas les données de cartes
              bancaires sur nos serveurs.
            </li>
            <li>
              Les factures sont émises de manière électronique conformément à
              la réglementation colombienne en vigueur.
            </li>
            <li>
              Les tarifs n&apos;incluent pas les taxes applicables, qui seront
              calculées en fonction de la juridiction du client.
            </li>
            <li>
              En cas de défaut de paiement, nous nous réservons le droit de
              suspendre le service après 7 jours de retard et de résilier le
              compte après 30 jours de défaut de paiement continu.
            </li>
            <li>
              Aucun remboursement n&apos;est effectué pour des périodes
              partielles d&apos;utilisation, sauf cas exceptionnels évalués
              individuellement.
            </li>
          </ul>
        </section>

        {/* 7 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            7. Utilisation acceptable
          </h2>
          <p className="mb-4">
            En utilisant Parallly, vous vous engagez à ne pas :
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              Envoyer des messages non sollicités (spam) ou des communications
              de masse sans le consentement préalable du destinataire.
            </li>
            <li>
              Utiliser la plateforme à des fins illégales, frauduleuses ou
              portant atteinte aux droits de tiers.
            </li>
            <li>
              Diffuser un contenu illégal, diffamatoire, obscène, menaçant,
              haineux ou portant atteinte aux droits de propriété
              intellectuelle.
            </li>
            <li>
              Tenter d&apos;accéder aux données d&apos;autres tenants ou
              contourner les mécanismes de sécurité de la plateforme.
            </li>
            <li>
              Procéder à la rétro-ingénierie, à la décompilation ou au
              désassemblage de toute partie du logiciel.
            </li>
            <li>
              Dépasser les limites d&apos;utilisation de votre forfait (rate
              limits de l&apos;API, conversations mensuelles, etc.) au moyen
              de techniques de contournement.
            </li>
            <li>
              Utiliser des bots, scrapers ou autres outils automatisés pour
              accéder au service en dehors des API fournies.
            </li>
            <li>
              Revendre, sous-licencier ou redistribuer le service sans
              autorisation écrite.
            </li>
          </ul>
          <p className="mt-4">
            Le non-respect de ces règles peut entraîner la suspension immédiate
            ou la résiliation du compte, sans droit à remboursement.
          </p>
        </section>

        {/* 8 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            8. Propriété intellectuelle
          </h2>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              Parallly, y compris son logiciel, son design, ses logos, ses
              marques et sa documentation, est la propriété exclusive de
              Automation AI S.A.S ou de ses concédants de licence.
            </li>
            <li>
              Une licence limitée, non exclusive, non transférable et révocable
              vous est accordée pour utiliser le service conformément aux
              présentes Conditions et au forfait souscrit.
            </li>
            <li>
              Vous n&apos;acquérez aucun droit de propriété sur le logiciel ou
              la plateforme du fait de l&apos;utilisation du service.
            </li>
            <li>
              Les configurations d&apos;agents d&apos;IA, les modèles de
              personas et les flux créés par le client au sein de la plateforme
              demeurent la propriété du client.
            </li>
          </ul>
        </section>

        {/* 9 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            9. Données du client
          </h2>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              Le client conserve la propriété de toutes les données qu&apos;il
              saisit, traite ou stocke via la plateforme (les &quot;Données
              Client&quot;).
            </li>
            <li>
              Parallly agit en qualité de sous-traitant des Données Client
              conformément à notre{" "}
              <Link href="/privacy" className="text-accent hover:underline">
                politique de confidentialité
              </Link>{" "}
              et aux accords de traitement des données applicables.
            </li>
            <li>
              Nous nous engageons à ne pas accéder, utiliser ou divulguer les
              Données Client, sauf lorsque cela est nécessaire pour : (a)
              fournir le service, (b) respecter des obligations légales, ou
              (c) avec le consentement exprès du client.
            </li>
            <li>
              Le client est responsable de l&apos;obtention des consentements
              et autorisations nécessaires de ses utilisateurs finaux
              (end-users) pour le traitement des données via la plateforme.
            </li>
            <li>
              En cas de résiliation du service, le client pourra demander
              l&apos;exportation de ses données dans les 30 jours suivants.
              Passé ce délai, les données seront supprimées de manière
              sécurisée.
            </li>
          </ul>
        </section>

        {/* 10 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            10. Limitation de responsabilité
          </h2>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              Le service est fourni &quot;en l&apos;état&quot; et &quot;selon
              disponibilité&quot;, sans garantie d&apos;aucune sorte, expresse
              ou implicite.
            </li>
            <li>
              Parallly ne garantit pas que le service sera ininterrompu, exempt
              d&apos;erreurs ou qu&apos;il répondra à toutes les exigences
              spécifiques du client.
            </li>
            <li>
              Nous ne sommes pas responsables des réponses générées par les
              modèles d&apos;IA, lesquelles peuvent contenir des
              inexactitudes. Le client est responsable de la supervision et de
              la validation des contenus générés.
            </li>
            <li>
              En aucun cas la responsabilité totale d&apos;Automation AI S.A.S
              ne dépassera le montant total payé par le client au cours des 12
              mois précédant l&apos;événement à l&apos;origine de la
              réclamation.
            </li>
            <li>
              Nous ne serons pas responsables des dommages indirects,
              accessoires, spéciaux, consécutifs ou punitifs, y compris la
              perte de profits, de données, d&apos;usage ou de réputation.
            </li>
            <li>
              Parallly ne sera pas responsable des interruptions de service
              causées par : (a) une maintenance programmée, (b) un cas de
              force majeure, (c) des défaillances de prestataires tiers (Meta,
              fournisseurs d&apos;IA, hébergeurs), ou (d) des actions du
              client.
            </li>
          </ul>
        </section>

        {/* 11 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            11. Indemnisation
          </h2>
          <p>
            Le client s&apos;engage à indemniser, défendre et garantir
            Automation AI S.A.S, ses dirigeants, employés, agents et affiliés,
            de toute réclamation, dommage, perte, responsabilité, coût et
            dépense (y compris les honoraires d&apos;avocats) découlant de ou
            liés à : (a) l&apos;utilisation du service par le client, (b) la
            violation des présentes Conditions, (c) la violation de droits de
            tiers, ou (d) le contenu traité via la plateforme par le client ou
            ses utilisateurs finaux.
          </p>
        </section>

        {/* 12 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            12. Résiliation du service
          </h2>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              Le client peut annuler son abonnement à tout moment depuis le
              panneau d&apos;administration. L&apos;annulation prendra effet à
              la fin de la période de facturation en cours.
            </li>
            <li>
              Nous nous réservons le droit de suspendre ou de résilier le
              service immédiatement en cas de : (a) violation des présentes
              Conditions, (b) activité frauduleuse ou illégale, (c) défaut de
              paiement continu, ou (d) exigence légale.
            </li>
            <li>
              En cas de résiliation, le client pourra exporter ses données
              dans les 30 jours suivants. Passé ce délai, toutes les données
              seront supprimées de manière sécurisée.
            </li>
            <li>
              Les obligations de confidentialité, de propriété intellectuelle,
              de limitation de responsabilité et d&apos;indemnisation
              survivront à la résiliation.
            </li>
          </ul>
        </section>

        {/* 13 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            13. Modifications des conditions
          </h2>
          <p>
            Nous nous réservons le droit de modifier les présentes Conditions à
            tout moment. Les modifications importantes seront notifiées via un
            avis sur la plateforme ou par e-mail au moins 30 jours à
            l&apos;avance. La poursuite de l&apos;utilisation du service après
            l&apos;entrée en vigueur des modifications constitue
            l&apos;acceptation des Conditions modifiées. Si vous n&apos;êtes
            pas d&apos;accord avec les modifications, vous pouvez annuler
            votre abonnement avant la date d&apos;entrée en vigueur.
          </p>
        </section>

        {/* 14 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            14. Loi applicable et règlement des litiges
          </h2>
          <p className="mb-4">
            Les présentes Conditions sont régies et interprétées conformément
            aux lois de la République de Colombie.
          </p>
          <p className="mb-4">
            Tout litige survenant en lien avec les présentes Conditions sera
            résolu de la manière suivante :
          </p>
          <ol className="list-decimal pl-6 space-y-2">
            <li>
              <strong className="text-text-primary">
                Négociation directe :
              </strong>{" "}
              les parties tenteront de résoudre le litige de bonne foi pendant
              une période de 30 jours ouvrables.
            </li>
            <li>
              <strong className="text-text-primary">Médiation :</strong> si la
              négociation directe n&apos;aboutit pas, les parties pourront
              recourir à un médiateur désigné d&apos;un commun accord.
            </li>
            <li>
              <strong className="text-text-primary">Arbitrage :</strong> en
              dernier recours, le litige sera résolu par arbitrage administré
              par le Centro de Arbitraje y Conciliación de la Cámara de
              Comercio de Bogotá (Centre d&apos;arbitrage et de conciliation
              de la Chambre de commerce de Bogotá), conformément à son
              règlement en vigueur. La sentence arbitrale sera définitive et
              contraignante.
            </li>
          </ol>
        </section>

        {/* 15 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            15. Dispositions générales
          </h2>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong className="text-text-primary">Accord intégral :</strong>{" "}
              les présentes Conditions, conjointement avec la politique de
              confidentialité et la politique de traitement des données,
              constituent l&apos;intégralité de l&apos;accord entre les
              parties et remplacent tout accord antérieur.
            </li>
            <li>
              <strong className="text-text-primary">Divisibilité :</strong> si
              une disposition des présentes Conditions est déclarée invalide
              ou inapplicable, les autres dispositions demeureront pleinement
              en vigueur.
            </li>
            <li>
              <strong className="text-text-primary">Cession :</strong> le
              client ne pourra céder ni transférer les présentes Conditions
              sans le consentement écrit préalable d&apos;Automation AI S.A.S.
            </li>
            <li>
              <strong className="text-text-primary">Renonciation :</strong>{" "}
              l&apos;absence d&apos;exercice d&apos;un droit prévu par les
              présentes Conditions ne constituera pas une renonciation à ce
              droit.
            </li>
            <li>
              <strong className="text-text-primary">
                Force majeure :
              </strong>{" "}
              aucune des parties ne sera responsable d&apos;un manquement
              causé par des événements échappant à son contrôle raisonnable, y
              compris les catastrophes naturelles, pandémies, guerres, actes
              de gouvernement ou défaillances d&apos;infrastructures de tiers.
            </li>
            <li>
              <strong className="text-text-primary">Notifications :</strong>{" "}
              les notifications légales seront envoyées à l&apos;adresse
              e-mail enregistrée dans le compte du client. Les notifications à
              Automation AI S.A.S doivent être adressées à{" "}
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
            16. Conformité aux politiques de Meta et obligations du client
          </h2>
          <p className="mb-4">
            Lorsque le client connecte WhatsApp, Instagram ou Messenger à
            Parallly, le client devient responsable du respect des politiques
            de Meta Platforms, Inc. qui régissent ces produits. Parallly
            fournit l&apos;infrastructure technique mais ne contrôle pas le
            contenu du message, l&apos;audience ni l&apos;intention
            commerciale décidée par le client.
          </p>

          <h3 className="text-lg font-semibold text-text-primary mt-6 mb-3">
            Politiques de Meta applicables au client
          </h3>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong className="text-text-primary">
                Meta Platform Terms (DFC) :
              </strong>{" "}
              conditions générales régissant l&apos;utilisation des
              plateformes de Meta par les développeurs et les entreprises.
            </li>
            <li>
              <strong className="text-text-primary">
                Meta Developer Policies :
              </strong>{" "}
              règles de développement, de sécurité des données et
              d&apos;utilisation des API de Meta.
            </li>
            <li>
              <strong className="text-text-primary">
                WhatsApp Business Solution Provider Terms :
              </strong>{" "}
              conditions spécifiques régissant l&apos;utilisation de la
              WhatsApp Business Platform via un fournisseur de solutions.
            </li>
            <li>
              <strong className="text-text-primary">
                WhatsApp Business Messaging Policy :
              </strong>{" "}
              fenêtre de service de 24 heures, exigences d&apos;opt-in et
              catégories de message (utility / authentication / marketing /
              service).
            </li>
            <li>
              <strong className="text-text-primary">
                WhatsApp Commerce Policy :
              </strong>{" "}
              liste des biens et services interdits sur WhatsApp.
            </li>
            <li>
              <strong className="text-text-primary">
                Instagram Platform Policy :
              </strong>{" "}
              règles applicables à la messagerie et aux intégrations
              d&apos;Instagram.
            </li>
            <li>
              <strong className="text-text-primary">
                Messenger Platform Policy :
              </strong>{" "}
              règles applicables à la messagerie et aux intégrations de
              Messenger.
            </li>
          </ul>

          <h3 className="text-lg font-semibold text-text-primary mt-6 mb-3">
            Obligations spécifiques du client
          </h3>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              Obtenir un opt-in explicite de chaque utilisateur final avant
              d&apos;initier des conversations sortantes sur WhatsApp,
              Instagram ou Messenger, et conserver la preuve de cet opt-in.
            </li>
            <li>
              Respecter les mots-clés de désinscription (STOP, BAJA, CANCELAR,
              etc.). Le pipeline de conformité de Parallly les détecte, mais
              la décision finale de les honorer demeure une obligation légale
              du client.
            </li>
            <li>
              Utiliser uniquement les modèles de message (Message Templates)
              approuvés par Meta pour les messages WhatsApp sortants envoyés
              en dehors de la fenêtre de service de 24 heures.
            </li>
            <li>
              Ne pas envoyer de contenu interdit (biens illicites, drogues,
              armes, contenu sexuel, discours haineux, escroqueries
              financières, etc.).
            </li>
            <li>
              Maintenir un nom commercial, un profil d&apos;entreprise et des
              informations de contact exacts sur les canaux connectés.
            </li>
            <li>
              Déconnecter ou mettre à jour immédiatement les canaux si Meta
              dégrade la note de qualité, suspend ou notifie le compte.
            </li>
            <li>
              Maintenir publiquement sa propre politique de confidentialité et
              ses propres conditions de service, et les rendre conformes aux
              exigences de Meta pour les entreprises présentes sur ses
              plateformes.
            </li>
          </ul>

          <h3 className="text-lg font-semibold text-text-primary mt-6 mb-3">
            Indemnisation
          </h3>
          <p>
            Le client indemnise et garantit Parallly contre toute amende,
            suspension, pénalité de qualité de compte, action en justice ou
            dommage imposé par Meta Platforms ou par des tiers résultant
            directement ou indirectement de : (a) l&apos;usage abusif des
            canaux connectés par le client, (b) la violation par le client de
            l&apos;une des politiques de Meta énumérées ci-dessus, (c)
            l&apos;absence d&apos;obtention par le client de l&apos;opt-in des
            utilisateurs finaux, ou (d) le contenu publié par le client ou ses
            agents via Parallly.
          </p>

          <h3 className="text-lg font-semibold text-text-primary mt-6 mb-3">
            Suspension pour non-conformité
          </h3>
          <p>
            Parallly se réserve le droit de suspendre ou de résilier
            l&apos;accès aux canaux concernés (ou au compte dans son
            intégralité) s&apos;il reçoit une notification crédible de Meta
            faisant état de violations répétées ou graves de ses politiques,
            ou s&apos;il détecte des abus via sa surveillance interne. Nous
            notifierons le client et offrirons un délai raisonnable pour
            remédier à la situation lorsque cela sera possible ; toutefois, si
            Meta exige une action immédiate, la suspension pourra être
            immédiate.
          </p>
        </section>

        {/* Contact */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            Contact
          </h2>
          <div className="bg-surface rounded-xl border border-border p-6 space-y-3">
            <p>
              <strong className="text-text-primary">Raison sociale :</strong>{" "}
              Automation AI S.A.S
            </p>
            <p>
              <strong className="text-text-primary">NIT :</strong> 902032943-1
            </p>
            <p>
              <strong className="text-text-primary">Adresse :</strong> Bogotá,
              Colombie
            </p>
            <p>
              <strong className="text-text-primary">E-mail :</strong>{" "}
              <a
                href="mailto:cloud.manager@parallext.com"
                className="text-accent hover:underline"
              >
                cloud.manager@parallext.com
              </a>
            </p>
            <p>
              <strong className="text-text-primary">Support :</strong>{" "}
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
