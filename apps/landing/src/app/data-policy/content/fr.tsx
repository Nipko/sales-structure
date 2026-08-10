import Link from "next/link";

export default function DataPolicyFr() {
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
        Politique de Traitement des Données Personnelles
      </h1>
      <p className="text-text-muted text-sm mb-4">
        Dernière mise à jour : 9 août 2026
      </p>
      <p className="text-text-muted text-sm mb-12">
        Conformément à la Ley Estatutaria 1581 de 2012 (loi colombienne sur la
        protection des données), au Decreto Reglamentario 1377 de 2013 (décret
        d&apos;application colombien) et aux autres normes concordantes de la
        République de Colombie.
      </p>

      <div className="space-y-12 text-text-secondary leading-relaxed">
        {/* 1 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            1. Responsable du traitement
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
              <strong className="text-text-primary">Domicile :</strong> Bogotá,
              D.C., Colombie
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
              <strong className="text-text-primary">Site web :</strong>{" "}
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
              <strong className="text-text-primary">Produit :</strong> Parallly
              (parallly-chat.cloud)
            </p>
          </div>
          <p className="mt-4">
            Automation AI S.A.S (ci-après, « la Société »), en sa qualité de
            responsable du traitement des données personnelles, se conforme à
            la Ley 1581 de 2012 (loi colombienne sur la protection des
            données), au Decreto 1377 de 2013 et aux autres normes qui les
            complètent, modifient ou ajoutent, par le biais de la présente
            Politique de Traitement des Données Personnelles.
          </p>
        </section>

        {/* 2 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            2. Traitement et finalités
          </h2>
          <p className="mb-4">
            La Société effectuera le traitement des données personnelles aux
            fins suivantes :
          </p>

          <h3 className="text-lg font-medium text-text-primary mt-6 mb-3">
            2.1 Finalités liées aux clients et utilisateurs
          </h3>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              Gérer la relation contractuelle pour la prestation des services
              de la plateforme Parallly.
            </li>
            <li>
              Créer et administrer les comptes utilisateurs et organisations
              clientes sur la plateforme.
            </li>
            <li>
              Traiter les paiements, émettre les factures et gérer la
              facturation.
            </li>
            <li>
              Fournir un support technique et un service client.
            </li>
            <li>
              Envoyer des communications transactionnelles liées au service
              (confirmations, notifications, alertes de sécurité).
            </li>
            <li>
              Envoyer des communications commerciales sur les mises à jour,
              nouvelles fonctionnalités et promotions, sous réserve de
              l&apos;autorisation préalable du titulaire.
            </li>
            <li>
              Réaliser des analyses statistiques et d&apos;utilisation pour
              améliorer la plateforme.
            </li>
          </ul>

          <h3 className="text-lg font-medium text-text-primary mt-6 mb-3">
            2.2 Finalités liées aux clients finaux (end-users)
          </h3>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              Traiter et stocker les messages WhatsApp pour le compte du
              client (responsable) conformément à l&apos;accord de traitement
              des données.
            </li>
            <li>
              Générer des réponses automatisées au moyen de l&apos;intelligence
              artificielle.
            </li>
            <li>
              Faciliter l&apos;escalade des conversations vers des agents
              humains lorsque cela est nécessaire.
            </li>
          </ul>

          <h3 className="text-lg font-medium text-text-primary mt-6 mb-3">
            2.3 Finalités liées aux fournisseurs et partenaires
          </h3>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              Gérer la relation commerciale et contractuelle avec les
              fournisseurs.
            </li>
            <li>
              Effectuer les paiements et la gestion comptable et fiscale.
            </li>
          </ul>
        </section>

        {/* 3 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            3. Droits des titulaires
          </h2>
          <p className="mb-4">
            Conformément à l&apos;article 8 de la Ley 1581 de 2012, les
            titulaires de données personnelles disposent des droits suivants :
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong className="text-text-primary">Accès :</strong> connaître
              les données personnelles faisant l&apos;objet de traitement par
              la Société. Ce droit peut être exercé gratuitement au moins une
              fois par mois calendaire.
            </li>
            <li>
              <strong className="text-text-primary">Mise à jour :</strong>{" "}
              demander la mise à jour des données personnelles lorsque
              celles-ci sont partielles, inexactes, incomplètes, fragmentées
              ou induisent en erreur.
            </li>
            <li>
              <strong className="text-text-primary">Rectification :</strong>{" "}
              demander la correction de données personnelles erronées.
            </li>
            <li>
              <strong className="text-text-primary">Suppression :</strong>{" "}
              demander l&apos;élimination des données personnelles lorsque :
              (a) elles ne sont pas nécessaires aux finalités autorisées, (b)
              l&apos;autorisation a été révoquée, ou (c) la période de
              traitement a été dépassée. Ce droit ne s&apos;applique pas
              lorsqu&apos;il existe une obligation légale ou contractuelle de
              demeurer dans la base de données.
            </li>
            <li>
              <strong className="text-text-primary">
                Révocation de l&apos;autorisation :
              </strong>{" "}
              révoquer l&apos;autorisation accordée pour le traitement des
              données personnelles, en tout ou en partie.
            </li>
            <li>
              <strong className="text-text-primary">
                Preuve de l&apos;autorisation :
              </strong>{" "}
              demander la preuve de l&apos;autorisation accordée, sauf lorsque
              la loi n&apos;exige pas d&apos;autorisation.
            </li>
            <li>
              <strong className="text-text-primary">Information :</strong>{" "}
              être informé de l&apos;utilisation faite de ses données
              personnelles.
            </li>
            <li>
              <strong className="text-text-primary">
                Plainte auprès de la SIC :
              </strong>{" "}
              déposer des plaintes auprès de la Superintendencia de Industria
              y Comercio pour les infractions à la Ley 1581 de 2012 et à ses
              normes complémentaires.
            </li>
          </ul>
        </section>

        {/* 4 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            4. Autorisation du titulaire
          </h2>
          <p className="mb-4">
            La Société obtiendra l&apos;autorisation préalable et éclairée du
            titulaire pour le traitement de ses données personnelles, laquelle
            pourra être accordée par :
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>Document physique ou électronique signé.</li>
            <li>
              Acceptation des conditions générales lors de l&apos;inscription
              sur la plateforme (case à cocher ou mécanisme équivalent).
            </li>
            <li>
              Conduite sans équivoque du titulaire permettant de conclure
              qu&apos;il a accordé son autorisation (par exemple, envoyer
              volontairement des données via des formulaires).
            </li>
            <li>
              Tout autre mécanisme garantissant la consultation ultérieure de
              l&apos;autorisation.
            </li>
          </ul>
          <p className="mt-4">
            L&apos;autorisation ne sera pas requise lorsqu&apos;il s&apos;agit
            de : (a) données requises par une entité publique dans
            l&apos;exercice de ses fonctions, (b) données de nature publique,
            (c) cas d&apos;urgence médicale ou sanitaire, ou (d) traitement
            autorisé par la loi.
          </p>
        </section>

        {/* 5 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            5. Personnes autorisées au traitement
          </h2>
          <p className="mb-4">
            Les données personnelles pourront être traitées par :
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong className="text-text-primary">
                Automation AI S.A.S :
              </strong>{" "}
              en tant que responsable du traitement.
            </li>
            <li>
              <strong className="text-text-primary">
                Employés et sous-traitants :
              </strong>{" "}
              du domaine technique et du support, qui ont besoin
              d&apos;accéder aux données pour l&apos;accomplissement de leurs
              fonctions, soumis à des accords de confidentialité.
            </li>
            <li>
              <strong className="text-text-primary">
                Sous-traitants du traitement :
              </strong>{" "}
              prestataires de services tiers agissant pour le compte et selon
              les instructions de la Société, conformément à des contrats de
              transmission de données qui garantissent une protection
              adéquate. Ceux-ci incluent : fournisseurs d&apos;hébergement et
              d&apos;infrastructure, fournisseurs de modèles d&apos;IA
              (OpenAI, Anthropic, Google), Meta/WhatsApp Business API,
              processeurs de paiement, Sentry pour le diagnostic des crashs et
              des performances, ainsi qu&apos;Expo et Google Firebase Cloud
              Messaging (FCM) pour les notifications push mobiles.
            </li>
          </ul>
        </section>

        {/* 6 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            6. Procédure pour exercer ses droits
          </h2>
          <p className="mb-4">
            Les titulaires peuvent exercer leurs droits en adressant une
            demande à la Société par les canaux suivants :
          </p>
          <div className="bg-surface rounded-xl border border-border p-6 space-y-3 mb-6">
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
              <strong className="text-text-primary">Objet du courriel :</strong>{" "}
              « Exercice de droits — Données Personnelles »
            </p>
          </div>

          <p className="mb-4">
            La demande devra contenir au minimum :
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              Nom complet et document d&apos;identification du titulaire.
            </li>
            <li>
              Description claire et précise des faits et du droit qu&apos;il
              souhaite exercer.
            </li>
            <li>
              Adresse physique et/ou électronique pour recevoir la réponse.
            </li>
            <li>
              Documents soutenant la demande, le cas échéant.
            </li>
          </ul>

          <h3 className="text-lg font-medium text-text-primary mt-6 mb-3">
            Délais de réponse
          </h3>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong className="text-text-primary">Consultations :</strong> la
              Société répondra dans un délai maximum de dix (10) jours
              ouvrables à compter de la date de réception de la demande.
            </li>
            <li>
              <strong className="text-text-primary">Réclamations :</strong> la
              Société répondra dans un délai maximum de quinze (15) jours
              ouvrables à compter de la date de réception de la réclamation.
            </li>
            <li>
              S&apos;il n&apos;est pas possible de traiter la consultation ou
              la réclamation dans les délais indiqués, le titulaire sera
              informé des motifs du retard et de la date à laquelle elle sera
              traitée, qui ne pourra dépasser cinq (5) jours ouvrables
              supplémentaires pour les consultations et huit (8) jours
              ouvrables supplémentaires pour les réclamations.
            </li>
          </ul>
        </section>

        {/* 7 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            7. Domaine responsable du traitement des pétitions, consultations
            et réclamations
          </h2>
          <div className="bg-surface rounded-xl border border-border p-6 space-y-3">
            <p>
              <strong className="text-text-primary">
                Délégué à la Protection des Données (DPO) :
              </strong>{" "}
              Andres Felipe Matallana
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
              <strong className="text-text-primary">Adresse :</strong> Bogotá,
              D.C., Colombie
            </p>
          </div>
          <p className="mt-4">
            Le Délégué à la Protection des Données est chargé de traiter les
            demandes des titulaires pour rendre effectifs leurs droits, ainsi
            que de veiller au respect de la présente politique et de la
            réglementation en vigueur en matière de protection des données
            personnelles.
          </p>
        </section>

        {/* 8 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            8. Validité des bases de données
          </h2>
          <p className="mb-4">
            Les bases de données gérées par la Société auront une validité
            tant que la finalité du traitement est maintenue et qu&apos;il
            existe une nécessité de conserver les données. Plus
            spécifiquement :
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong className="text-text-primary">
                Base de données clients :
              </strong>{" "}
              pendant la relation contractuelle. Lors d&apos;une résiliation
              ordinaire, l&apos;accès peut continuer jusqu&apos;à la fin de la
              période contractuelle. Lorsque l&apos;offboarding est exécuté,
              l&apos;accès et les canaux sont désactivés ; à compter de ce
              moment, les données opérationnelles peuvent être conservées
              jusqu&apos;à quatre-vingt-dix (90) jours pour l&apos;exportation,
              le support ou la réactivation avant leur purge.
            </li>
            <li>
              <strong className="text-text-primary">
                Base de données de facturation :
              </strong>{" "}
              pendant la période requise par la législation fiscale
              colombienne (au minimum cinq ans conformément à l&apos;Estatuto
              Tributario / Code des impôts colombien).
            </li>
            <li>
              <strong className="text-text-primary">
                Base de données de conversations :
              </strong>{" "}
              selon la configuration du client, avec un maximum de vingt-quatre
              (24) mois depuis sa création.
            </li>
            <li>
              <strong className="text-text-primary">
                Journaux de sécurité :
              </strong>{" "}
              jusqu&apos;à douze (12) mois à des fins de sécurité informatique
              et de diagnostic.
            </li>
          </ul>
          <p className="mt-4">
            Une demande vérifiée de suppression du compte et des données est
            distincte de la résiliation ordinaire. Après vérification de
            l&apos;identité et de la portée, la Société lance une purge sécurisée
            sans retard injustifié, sans promettre qu&apos;elle soit automatique
            ou instantanée. Les registres soumis à une conservation fiscale,
            légale, de sécurité ou de prévention de la fraude sont isolés pendant
            la durée applicable. Les copies résiduelles dans les sauvegardes
            chiffrées sont indisponibles pour l&apos;usage ordinaire et expirent
            selon le cycle normal de conservation des sauvegardes.
          </p>
        </section>

        {/* 9 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            9. Transfert et transmission de données
          </h2>
          <p className="mb-4">
            La Société pourra effectuer des transferts et transmissions de
            données personnelles à des tiers, tant au niveau national
            qu&apos;international, conformément aux articles 25 et 26 du
            Decreto 1377 de 2013 :
          </p>

          <h3 className="text-lg font-medium text-text-primary mt-6 mb-3">
            9.1 Transmission (Sous-traitants du traitement)
          </h3>
          <p className="mb-3">
            La transmission de données est effectuée aux sous-traitants
            suivants :
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong className="text-text-primary">
                Fournisseurs d&apos;infrastructure :
              </strong>{" "}
              pour l&apos;hébergement et le fonctionnement de la plateforme.
            </li>
            <li>
              <strong className="text-text-primary">
                Meta Platforms (WhatsApp Business API) :
              </strong>{" "}
              pour la transmission des messages WhatsApp.
            </li>
            <li>
              <strong className="text-text-primary">
                Fournisseurs de modèles d&apos;IA :
              </strong>{" "}
              OpenAI, Anthropic et Google pour le traitement des réponses
              automatiques.
            </li>
            <li>
              <strong className="text-text-primary">Sentry :</strong>{" "}
              pour recevoir des événements techniques minimisés et diagnostiquer
              les crashs, les erreurs et les performances. Les événements ne
              sont conservés que pendant la durée configurée dans le projet
              Sentry de Parallly et tant qu&apos;ils sont nécessaires au
              diagnostic.
            </li>
            <li>
              <strong className="text-text-primary">
                Expo et Google Firebase Cloud Messaging (FCM) :
              </strong>{" "}
              pour livrer les notifications mobiles à l&apos;aide de jetons
              push, d&apos;identifiants d&apos;installation/application et du
              payload de l&apos;alerte. Expo ne conserve le contenu que pendant
              la livraison et supprime les reçus après 24 heures ; FCM peut
              conserver les messages non livrés jusqu&apos;à quatre semaines et,
              lorsqu&apos;une suppression d&apos;identifiant d&apos;installation
              est demandée, Google indique le supprimer des systèmes actifs et
              des sauvegardes sous 180 jours. Les jetons stockés par Parallly
              sont supprimés lorsqu&apos;ils deviennent invalides ou lors de la
              purge vérifiée.
            </li>
            <li>
              <strong className="text-text-primary">
                Processeurs de paiement :
              </strong>{" "}
              pour la gestion des transactions financières.
            </li>
          </ul>

          <h3 className="text-lg font-medium text-text-primary mt-6 mb-3">
            9.2 Transfert international
          </h3>
          <p>
            Étant donné que certains sous-traitants du traitement sont basés à
            l&apos;étranger (États-Unis, Union européenne), la Société garantit
            que ces transferts sont effectués conformément aux dispositions
            légales applicables, en vérifiant que les pays de destination
            disposent de niveaux adéquats de protection des données ou, à
            défaut, en signant des clauses contractuelles garantissant la
            protection des données personnelles transférées, conformément à
            l&apos;article 26 de la Ley 1581 de 2012.
          </p>
        </section>

        {/* 10 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            10. Mesures de sécurité
          </h2>
          <p className="mb-4">
            La Société a adopté les mesures techniques, administratives et
            humaines suivantes pour protéger les données personnelles contre
            tout accès non autorisé, utilisation abusive, altération, perte
            ou destruction :
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong className="text-text-primary">
                Chiffrement AES-256-GCM :
              </strong>{" "}
              pour les jetons d&apos;accès et les données sensibles stockées
              au repos.
            </li>
            <li>
              <strong className="text-text-primary">
                Chiffrement en transit :
              </strong>{" "}
              toutes les communications sont effectuées via TLS 1.2+ (HTTPS).
            </li>
            <li>
              <strong className="text-text-primary">
                Isolation par entreprise :
              </strong>{" "}
              chaque organisation cliente opère dans un schéma de base de
              données PostgreSQL isolé (un schéma par entreprise), garantissant que
              les données de chaque client sont logiquement séparées.
            </li>
            <li>
              <strong className="text-text-primary">
                Contrôle d&apos;accès basé sur les rôles (RBAC) :
              </strong>{" "}
              avec quatre niveaux d&apos;accès (super_admin, tenant_admin,
              tenant_supervisor, tenant_agent).
            </li>
            <li>
              <strong className="text-text-primary">
                Authentification JWT :
              </strong>{" "}
              avec des jetons à expiration configurable.
            </li>
            <li>
              <strong className="text-text-primary">
                Idempotence des webhooks :
              </strong>{" "}
              mécanismes de déduplication pour éviter le traitement
              dupliqué des données.
            </li>
            <li>
              <strong className="text-text-primary">
                Sauvegardes :
              </strong>{" "}
              sauvegardes chiffrées avec rétention et restauration périodique
              vérifiée.
            </li>
            <li>
              <strong className="text-text-primary">
                Surveillance et audit :
              </strong>{" "}
              journalisation des événements de sécurité et d&apos;accès pour
              la détection d&apos;anomalies.
            </li>
            <li>
              <strong className="text-text-primary">
                Accords de confidentialité :
              </strong>{" "}
              tous les employés et sous-traitants ayant accès aux données
              personnelles sont soumis à des clauses de confidentialité.
            </li>
          </ul>
        </section>

        {/* 11 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            11. Cookies
          </h2>
          <p className="mb-4">
            La plateforme Parallly utilise des cookies et des technologies
            similaires pour améliorer l&apos;expérience utilisateur. Les
            catégories de cookies utilisées sont :
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong className="text-text-primary">
                Cookies strictement nécessaires :
              </strong>{" "}
              requis pour le fonctionnement du service (authentification,
              session, sécurité).
            </li>
            <li>
              <strong className="text-text-primary">
                Cookies analytiques :
              </strong>{" "}
              pour l&apos;analyse de l&apos;utilisation et l&apos;amélioration
              de la plateforme.
            </li>
            <li>
              <strong className="text-text-primary">
                Cookies de préférences :
              </strong>{" "}
              pour mémoriser les paramètres de l&apos;utilisateur.
            </li>
          </ul>
          <p className="mt-4">
            L&apos;utilisateur peut configurer son navigateur pour refuser les
            cookies non essentiels. La désactivation des cookies essentiels
            peut affecter le fonctionnement de la plateforme. Pour plus
            d&apos;informations, consultez notre{" "}
            <Link href="/privacy" className="text-accent hover:underline">
              Politique de Confidentialité
            </Link>
            .
          </p>
        </section>

        {/* 12 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            12. Modifications de cette politique
          </h2>
          <p>
            La Société se réserve le droit de modifier la présente Politique
            de Traitement des Données Personnelles à tout moment. Les
            modifications seront publiées sur le site web de la plateforme et
            notifiées aux titulaires par les canaux de communication
            disponibles. Les changements entreront en vigueur à compter de la
            date de leur publication, sauf indication d&apos;une date
            ultérieure. L&apos;utilisation continue de la plateforme après la
            publication des modifications constituera l&apos;acceptation de la
            politique mise à jour.
          </p>
        </section>

        {/* 13 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            13. Coordonnées de la Superintendencia de Industria y Comercio
            (SIC)
          </h2>
          <p className="mb-4">
            Si le titulaire estime que ses droits ont été violés ou que la
            Société n&apos;a pas respecté la réglementation en matière de
            protection des données, il peut déposer une plainte auprès de la
            Superintendencia de Industria y Comercio (autorité colombienne de
            protection des données) :
          </p>
          <div className="bg-surface rounded-xl border border-border p-6 space-y-3">
            <p>
              <strong className="text-text-primary">Entité :</strong>{" "}
              Superintendencia de Industria y Comercio (SIC)
            </p>
            <p>
              <strong className="text-text-primary">Adresse :</strong> Carrera
              13 No. 27-00, Étages 1 à 7, Bogotá, D.C., Colombie
            </p>
            <p>
              <strong className="text-text-primary">
                Ligne téléphonique :
              </strong>{" "}
              (601) 587 0000
            </p>
            <p>
              <strong className="text-text-primary">
                Ligne nationale gratuite :
              </strong>{" "}
              01 8000 910 165
            </p>
            <p>
              <strong className="text-text-primary">Site web :</strong>{" "}
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
              <strong className="text-text-primary">E-mail :</strong>{" "}
              <a
                href="mailto:contactenos@sic.gov.co"
                className="text-accent hover:underline"
              >
                contactenos@sic.gov.co
              </a>
            </p>
          </div>
          <p className="mt-4 text-text-muted text-sm">
            Avant de saisir la SIC, le titulaire doit avoir présenté sa
            demande directement à la Société et avoir épuisé la procédure de
            consultation ou de réclamation, conformément aux articles 14 et 15
            de la Ley 1581 de 2012.
          </p>
        </section>
      </div>
    </>
  );
}
