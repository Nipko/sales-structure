import Link from "next/link";

export default function PrivacyFr() {
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
        Politique de confidentialité
      </h1>
      <p className="text-text-muted text-sm mb-12">
        Dernière mise à jour : 29 avril 2026
      </p>

      <div className="space-y-12 text-text-secondary leading-relaxed">
        {/* Intro */}
        <p>
          Chez <strong className="text-text-primary">Automation AI S.A.S</strong>{" "}
          (NIT : 902032943-1), opérateur de la plateforme{" "}
          <strong className="text-text-primary">Parallly</strong>{" "}
          (parallly-chat.cloud), nous nous engageons à protéger la vie privée
          de nos utilisateurs. La présente Politique de confidentialité décrit
          comment nous collectons, utilisons, partageons et protégeons vos
          informations personnelles lorsque vous utilisez nos services.
        </p>
        <p>
          La présente politique est conforme au Règlement général sur la
          protection des données (RGPD) de l&apos;Union européenne, au
          California Consumer Privacy Act (CCPA), à la Lei Geral de Proteção
          de Dados du Brésil (LGPD) et à la loi 1581 de 2012 de Colombie,
          ainsi qu&apos;aux normes complémentaires applicables dans chaque
          juridiction.
        </p>

        {/* 1 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            1. Informations que nous collectons
          </h2>

          <h3 className="text-lg font-medium text-text-primary mt-6 mb-3">
            1.1 Données personnelles fournies directement
          </h3>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              Informations d&apos;inscription : nom complet, adresse e-mail,
              numéro de téléphone, nom de l&apos;entreprise, fonction.
            </li>
            <li>
              Informations de facturation : données de carte de crédit ou
              moyen de paiement (traitées par des prestataires de paiement
              certifiés PCI DSS ; nous ne stockons pas les données de carte).
            </li>
            <li>
              Contenu des communications : messages envoyés via la plateforme
              dans le cadre du support technique.
            </li>
          </ul>

          <h3 className="text-lg font-medium text-text-primary mt-6 mb-3">
            1.2 Données d&apos;utilisation
          </h3>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              Adresse IP, type de navigateur, système d&apos;exploitation,
              pages visitées, date et heure d&apos;accès.
            </li>
            <li>
              Indicateurs d&apos;utilisation du service : nombre de
              conversations, messages traités, agents configurés.
            </li>
            <li>
              Journaux d&apos;activité (logs) à des fins de sécurité et de
              diagnostic.
            </li>
          </ul>

          <h3 className="text-lg font-medium text-text-primary mt-6 mb-3">
            1.3 Données des utilisateurs finaux (end-users)
          </h3>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              Numéro de téléphone WhatsApp, nom de profil et contenu des
              messages envoyés à l&apos;entreprise du client.
            </li>
            <li>
              Ces données sont traitées pour le compte du client (responsable
              du traitement) et Parallly agit en tant que sous-traitant
              conformément aux accords de traitement des données applicables.
            </li>
          </ul>

          <h3 className="text-lg font-medium text-text-primary mt-6 mb-3">
            1.4 Cookies et technologies similaires
          </h3>
          <p>
            Nous utilisons des cookies essentiels au fonctionnement de la
            plateforme, des cookies analytiques pour améliorer
            l&apos;expérience utilisateur et des cookies de préférences.
            Consultez la section 9 de cette politique pour plus de détails.
          </p>
        </section>

        {/* 2 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            2. Comment nous utilisons vos informations
          </h2>
          <p className="mb-4">
            Nous utilisons les informations collectées aux fins suivantes :
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              Fournir, maintenir et améliorer nos services
              d&apos;automatisation conversationnelle par IA.
            </li>
            <li>
              Traiter les paiements et gérer votre compte et votre
              abonnement.
            </li>
            <li>
              Envoyer des communications transactionnelles (confirmations,
              notifications de service, alertes de sécurité).
            </li>
            <li>
              Envoyer des communications commerciales sur les mises à jour
              et les nouvelles fonctionnalités (avec votre consentement
              préalable).
            </li>
            <li>
              Analyser les modèles d&apos;utilisation pour optimiser les
              performances de la plateforme et l&apos;expérience
              utilisateur.
            </li>
            <li>
              Entraîner et améliorer des modèles d&apos;IA internes (les
              données sont anonymisées et agrégées ; les données personnelles
              identifiables ne sont jamais utilisées pour
              l&apos;entraînement sans consentement explicite).
              <strong className="text-text-primary">
                {" "}Cette finalité NE s&apos;applique PAS aux données
                obtenues via les API Google Workspace (y compris Google
                Calendar).
              </strong>{" "}
              Ces données sont régies exclusivement par la section 12
              (Limited Use) de la présente politique.
            </li>
            <li>
              Respecter les obligations légales, résoudre les litiges et
              faire appliquer nos accords.
            </li>
            <li>
              Prévenir la fraude, les activités illégales et protéger la
              sécurité de la plateforme.
            </li>
          </ul>
        </section>

        {/* 3 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            3. Base légale du traitement
          </h2>
          <p className="mb-4">
            Conformément au RGPD (art. 6) et aux réglementations
            équivalentes, nous traitons les données personnelles sur les
            bases légales suivantes :
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong className="text-text-primary">
                Exécution d&apos;un contrat :
              </strong>{" "}
              le traitement est nécessaire à la fourniture du service
              contracté (création de compte, traitement des messages,
              facturation).
            </li>
            <li>
              <strong className="text-text-primary">
                Consentement :
              </strong>{" "}
              pour les communications commerciales, les cookies non
              essentiels et le traitement de données à des fins analytiques
              avancées.
            </li>
            <li>
              <strong className="text-text-primary">
                Intérêt légitime :
              </strong>{" "}
              pour la sécurité de la plateforme, la prévention de la fraude,
              l&apos;amélioration du service et l&apos;analyse
              d&apos;utilisation agrégée.
            </li>
            <li>
              <strong className="text-text-primary">
                Obligation légale :
              </strong>{" "}
              pour respecter les exigences fiscales, comptables et
              réglementaires applicables.
            </li>
          </ul>
          <p className="mt-4">
            Pour la LGPD (Brésil), en plus des bases ci-dessus, nous nous
            appuyons sur l&apos;intérêt légitime du contrôleur et la
            protection du crédit lorsque cela est applicable.
          </p>
          <p className="mt-2">
            Pour la loi 1581 de 2012 (Colombie), le traitement est effectué
            conformément à l&apos;autorisation accordée par la personne
            concernée.
          </p>
        </section>

        {/* 4 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            4. Partage de données avec des tiers
          </h2>
          <p className="mb-4">
            Nous ne vendons pas de données personnelles. Nous ne partageons
            d&apos;informations que dans les cas suivants :
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong className="text-text-primary">
                Meta / WhatsApp Business API :
              </strong>{" "}
              les messages sont transmis via l&apos;API WhatsApp Cloud de
              Meta. Meta agit comme un sous-traitant indépendant
              conformément à ses propres politiques de confidentialité.
            </li>
            <li>
              <strong className="text-text-primary">
                Fournisseurs de modèles d&apos;IA :
              </strong>{" "}
              OpenAI, Anthropic, Google et d&apos;autres fournisseurs de
              modèles de langage traitent le contenu des conversations pour
              générer des réponses. Les données sont envoyées de manière
              sécurisée via API et sont soumises aux accords de traitement
              des données de chaque fournisseur.
            </li>
            <li>
              <strong className="text-text-primary">
                Fournisseurs d&apos;infrastructure :
              </strong>{" "}
              services d&apos;hébergement, bases de données et CDN
              nécessaires à l&apos;exploitation de la plateforme.
            </li>
            <li>
              <strong className="text-text-primary">
                Processeurs de paiement :
              </strong>{" "}
              pour gérer les transactions de manière sécurisée
              (certification PCI DSS).
            </li>
            <li>
              <strong className="text-text-primary">
                Autorités compétentes :
              </strong>{" "}
              lorsque la loi, une décision de justice ou une procédure
              légale valide l&apos;exige.
            </li>
          </ul>
          <p className="mt-4">
            Tous les tiers sont soumis à des accords de traitement des
            données (DPA) garantissant des niveaux de protection adéquats.
          </p>
        </section>

        {/* 5 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            5. Transferts internationaux de données
          </h2>
          <p className="mb-4">
            Étant donné que nous opérons à l&apos;échelle mondiale et
            utilisons des fournisseurs de services à infrastructure
            distribuée, vos données peuvent être transférées et traitées
            dans des pays hors de votre juridiction, notamment aux
            États-Unis et dans l&apos;Union européenne.
          </p>
          <p className="mb-4">
            Pour garantir une protection adéquate des données transférées
            à l&apos;international, nous mettons en œuvre les garanties
            suivantes :
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              Clauses contractuelles types (CCT) approuvées par la
              Commission européenne.
            </li>
            <li>
              Évaluations d&apos;impact des transferts (TIA) lorsque
              applicable.
            </li>
            <li>
              Contrats avec les prestataires incluant des engagements de
              protection des données équivalents au RGPD.
            </li>
            <li>
              Pour la Colombie : autorisation du titulaire conformément à
              l&apos;article 26 du décret 1377 de 2013.
            </li>
            <li>
              Pour le Brésil : conformité à l&apos;article 33 de la LGPD
              pour les transferts internationaux.
            </li>
          </ul>
        </section>

        {/* 6 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            6. Sécurité des données
          </h2>
          <p className="mb-4">
            Nous mettons en œuvre des mesures techniques et
            organisationnelles pour protéger vos données personnelles :
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong className="text-text-primary">
                Chiffrement AES-256-GCM :
              </strong>{" "}
              les jetons d&apos;accès et les données sensibles sont
              chiffrés au repos avec AES-256-GCM.
            </li>
            <li>
              <strong className="text-text-primary">
                Isolation par entreprise :
              </strong>{" "}
              chaque client opère dans un schéma de base de données isolé
              (un schéma par entreprise), garantissant la séparation logique des
              données entre organisations.
            </li>
            <li>
              <strong className="text-text-primary">
                Chiffrement en transit :
              </strong>{" "}
              toutes les communications utilisent TLS 1.2+ (HTTPS).
            </li>
            <li>
              <strong className="text-text-primary">
                Authentification sécurisée :
              </strong>{" "}
              JWT avec expiration configurable et contrôle d&apos;accès
              basé sur les rôles (RBAC).
            </li>
            <li>
              <strong className="text-text-primary">
                Surveillance continue :
              </strong>{" "}
              journalisation des événements de sécurité, détection
              d&apos;anomalies et réponse aux incidents.
            </li>
            <li>
              <strong className="text-text-primary">
                Sauvegardes :
              </strong>{" "}
              sauvegardes chiffrées avec rétention configurable.
            </li>
          </ul>
        </section>

        {/* 7 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            7. Conservation des données
          </h2>
          <p className="mb-4">
            Nous conservons les données personnelles uniquement pendant la
            durée nécessaire à la réalisation des finalités décrites dans
            la présente politique :
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong className="text-text-primary">
                Données du compte :
              </strong>{" "}
              pendant la durée de la relation contractuelle et jusqu&apos;à
              30 jours après sa résiliation, sauf obligation légale de
              conservation plus longue.
            </li>
            <li>
              <strong className="text-text-primary">
                Données de conversations :
              </strong>{" "}
              selon la configuration du client, avec un maximum de 24 mois
              à compter de leur création.
            </li>
            <li>
              <strong className="text-text-primary">
                Données de facturation :
              </strong>{" "}
              pendant la période requise par la législation fiscale
              applicable (minimum 5 ans en Colombie).
            </li>
            <li>
              <strong className="text-text-primary">
                Journaux de sécurité :
              </strong>{" "}
              jusqu&apos;à 12 mois à des fins de sécurité et de
              diagnostic.
            </li>
            <li>
              <strong className="text-text-primary">
                Données anonymisées :
              </strong>{" "}
              les données agrégées et anonymisées peuvent être conservées
              indéfiniment à des fins analytiques.
            </li>
          </ul>
        </section>

        {/* 8 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            8. Vos droits
          </h2>

          <h3 className="text-lg font-medium text-text-primary mt-6 mb-3">
            8.1 Droits au titre du RGPD (Union européenne / EEE)
          </h3>
          <p className="mb-3">
            Si vous résidez dans l&apos;Espace économique européen, vous
            disposez des droits suivants :
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong className="text-text-primary">Accès :</strong>{" "}
              demander une copie de vos données personnelles.
            </li>
            <li>
              <strong className="text-text-primary">Rectification :</strong>{" "}
              corriger des données inexactes ou incomplètes.
            </li>
            <li>
              <strong className="text-text-primary">Effacement :</strong>{" "}
              demander la suppression de vos données («&nbsp;droit à
              l&apos;oubli&nbsp;»).
            </li>
            <li>
              <strong className="text-text-primary">Portabilité :</strong>{" "}
              recevoir vos données dans un format structuré et lisible par
              machine.
            </li>
            <li>
              <strong className="text-text-primary">Opposition :</strong>{" "}
              vous opposer au traitement fondé sur l&apos;intérêt légitime.
            </li>
            <li>
              <strong className="text-text-primary">
                Limitation du traitement :
              </strong>{" "}
              restreindre le traitement dans certaines circonstances.
            </li>
            <li>
              <strong className="text-text-primary">
                Retrait du consentement :
              </strong>{" "}
              à tout moment, sans porter atteinte à la licéité du
              traitement antérieur.
            </li>
            <li>
              <strong className="text-text-primary">
                Réclamation auprès d&apos;une autorité :
              </strong>{" "}
              déposer une plainte auprès de votre autorité de protection
              des données (en France, la CNIL).
            </li>
          </ul>

          <h3 className="text-lg font-medium text-text-primary mt-6 mb-3">
            8.2 Droits au titre de la CCPA (Californie, États-Unis)
          </h3>
          <p className="mb-3">
            Si vous résidez en Californie, vous disposez des droits
            suivants :
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong className="text-text-primary">Droit de savoir :</strong>{" "}
              demander des informations sur les catégories et les éléments
              spécifiques des données personnelles collectées.
            </li>
            <li>
              <strong className="text-text-primary">
                Droit à la suppression :
              </strong>{" "}
              demander la suppression de vos données personnelles.
            </li>
            <li>
              <strong className="text-text-primary">
                Droit d&apos;opt-out :
              </strong>{" "}
              nous ne vendons pas de données personnelles. Si cela
              changeait, nous fournirons un mécanisme d&apos;opt-out
              conforme à la CCPA.
            </li>
            <li>
              <strong className="text-text-primary">
                Non-discrimination :
              </strong>{" "}
              nous ne discriminons pas les utilisateurs qui exercent leurs
              droits au titre de la CCPA.
            </li>
          </ul>

          <h3 className="text-lg font-medium text-text-primary mt-6 mb-3">
            8.3 Droits au titre de la loi 1581 de 2012 (Colombie)
          </h3>
          <p className="mb-3">
            En tant que titulaire de données personnelles en Colombie, vous
            avez le droit de :
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              Connaître, mettre à jour et rectifier vos données
              personnelles.
            </li>
            <li>
              Demander la preuve de l&apos;autorisation accordée pour le
              traitement.
            </li>
            <li>
              Être informé de l&apos;usage fait de vos données.
            </li>
            <li>
              Déposer des plaintes auprès de la Superintendencia de
              Industria y Comercio (SIC) en cas de violation de la loi.
            </li>
            <li>
              Révoquer l&apos;autorisation et/ou demander la suppression de
              vos données lorsque les principes, droits et garanties
              constitutionnels et légaux ne sont pas respectés.
            </li>
            <li>
              Accéder gratuitement à vos données personnelles faisant
              l&apos;objet d&apos;un traitement.
            </li>
          </ul>
          <p className="mt-3">
            Pour exercer ces droits, consultez notre{" "}
            <Link
              href="/data-policy"
              className="text-accent hover:underline"
            >
              Politique de traitement des données personnelles
            </Link>
            .
          </p>

          <h3 className="text-lg font-medium text-text-primary mt-6 mb-3">
            8.4 Droits au titre de la LGPD (Brésil)
          </h3>
          <p className="mb-3">
            Si vous êtes titulaire de données au Brésil, vous avez le droit
            de :
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              Confirmer l&apos;existence du traitement de vos données.
            </li>
            <li>Accéder à vos données personnelles.</li>
            <li>
              Corriger les données incomplètes, inexactes ou périmées.
            </li>
            <li>
              Anonymisation, blocage ou suppression des données
              inutiles, excessives ou traitées en violation de la LGPD.
            </li>
            <li>
              Portabilité des données vers un autre prestataire de
              services.
            </li>
            <li>
              Suppression des données personnelles traitées sur la base du
              consentement.
            </li>
            <li>
              Informations sur les entités publiques et privées avec
              lesquelles les données ont été partagées.
            </li>
            <li>
              Retrait du consentement à tout moment.
            </li>
          </ul>
        </section>

        {/* 9 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            9. Cookies et technologies similaires
          </h2>
          <p className="mb-4">
            Nous utilisons les catégories de cookies suivantes :
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong className="text-text-primary">
                Cookies essentiels :
              </strong>{" "}
              nécessaires au fonctionnement du service (authentification,
              sécurité, préférences de session). Ils ne peuvent pas être
              désactivés.
            </li>
            <li>
              <strong className="text-text-primary">
                Cookies analytiques :
              </strong>{" "}
              nous aident à comprendre comment vous interagissez avec la
              plateforme afin d&apos;améliorer l&apos;expérience. Ils
              peuvent être désactivés.
            </li>
            <li>
              <strong className="text-text-primary">
                Cookies de préférences :
              </strong>{" "}
              mémorisent vos paramètres (langue, fuseau horaire). Ils
              peuvent être désactivés.
            </li>
          </ul>
          <p className="mt-4">
            Vous pouvez gérer vos préférences de cookies dans les
            paramètres de votre navigateur. Notez que la désactivation de
            certains cookies peut affecter la fonctionnalité du service.
          </p>
        </section>

        {/* 10 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            10. Mineurs
          </h2>
          <p>
            Parallly ne s&apos;adresse pas aux personnes de moins de 18 ans.
            Nous ne collectons pas sciemment de données personnelles de
            mineurs. Si nous apprenons que nous avons collecté des données
            d&apos;un mineur sans le consentement vérifiable d&apos;un
            parent ou tuteur, nous prendrons des mesures pour supprimer
            ces informations de nos systèmes. Si vous pensez que nous
            avons pu collecter des informations sur un mineur, contactez-nous
            à{" "}
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
            11. Modifications de cette politique
          </h2>
          <p>
            Nous nous réservons le droit de mettre à jour la présente
            Politique de confidentialité à tout moment. Nous notifierons
            les modifications importantes par un avis sur la plateforme ou
            par e-mail au moins 30 jours avant leur entrée en vigueur.
            L&apos;utilisation continue du service après la date
            d&apos;entrée en vigueur constitue l&apos;acceptation de la
            politique mise à jour.
          </p>
        </section>

        {/* 12 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            12. Services Google et conformité avec la Google API Services
            User Data Policy
          </h2>
          <p className="mb-4">
            Parallly s&apos;intègre aux services Google (Google Sign-In et
            Google Calendar) via OAuth 2.0. Cette section décrit
            spécifiquement comment nous traitons les données obtenues via
            les API Google et notre engagement vis-à-vis des restrictions
            d&apos;usage limité («&nbsp;Limited Use&nbsp;»).
          </p>

          <h3 className="text-lg font-medium text-text-primary mt-6 mb-3">
            12.1 Portées (scopes) Google que nous demandons
          </h3>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong className="text-text-primary">
                openid, email, profile
              </strong>{" "}
              — utilisés uniquement lorsque vous vous connectez avec
              Google. Ils nous permettent de vous authentifier,
              d&apos;afficher votre nom et votre photo de profil dans
              l&apos;application, et de lier votre compte Google à votre
              utilisateur Parallly.
            </li>
            <li>
              <strong className="text-text-primary">
                https://www.googleapis.com/auth/calendar
              </strong>{" "}
              — demandé uniquement si vous connectez Google Calendar comme
              fournisseur de rendez-vous. Nous l&apos;utilisons
              exclusivement pour créer, mettre à jour, déplacer et annuler
              des événements de calendrier associés aux rendez-vous que
              vous gérez dans Parallly, et pour vérifier la disponibilité
              lors de la prise de rendez-vous.
            </li>
          </ul>
          <p className="mt-3">
            Nous ne demandons ni n&apos;accédons à Gmail, Drive, Contacts
            ou tout autre service Google en dehors de ceux énumérés
            ci-dessus.
          </p>

          <h3 className="text-lg font-medium text-text-primary mt-6 mb-3">
            12.2 Comment nous utilisons les données Google
          </h3>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              Les données de profil (nom, e-mail, photo) sont utilisées
              uniquement pour l&apos;authentification, l&apos;identification
              au sein de l&apos;application et la liaison de compte.
            </li>
            <li>
              Les données Google Calendar sont utilisées uniquement pour
              créer, modifier, lire la disponibilité et supprimer des
              événements directement liés aux rendez-vous gérés par
              l&apos;utilisateur dans Parallly.
            </li>
            <li>
              Nous stockons le refresh token Google chiffré avec
              AES-256-GCM ainsi que l&apos;e-mail du compte connecté. Nous
              ne stockons pas de copies des événements du calendrier en
              dehors du contexte opérationnel nécessaire à
              l&apos;affichage de l&apos;état du rendez-vous.
            </li>
          </ul>

          <h3 className="text-lg font-medium text-text-primary mt-6 mb-3">
            12.3 Déclaration de Limited Use
          </h3>
          <p className="mb-4">
            <em>
              The use of raw or derived user data received from Workspace APIs
              will adhere to the Google User Data Policy, including the
              Limited Use requirements.
            </em>
          </p>
          <p className="mb-4">
            En conséquence, nous nous engageons à ce que les données
            obtenues via les API Google Workspace :
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong className="text-text-primary">
                Ne soient pas utilisées pour afficher de la publicité
              </strong>{" "}
              — ni dans Parallly ni dans aucun système externe.
            </li>
            <li>
              <strong className="text-text-primary">
                Ne soient ni vendues, ni cédées, ni transférées
              </strong>{" "}
              à des tiers à des fins publicitaires, marketing, de
              génération de leads, ou de constitution de bases de données.
            </li>
            <li>
              <strong className="text-text-primary">
                Ne soient pas utilisées pour entraîner des modèles
                d&apos;intelligence artificielle
              </strong>{" "}
              — ni les nôtres ni ceux de tiers (OpenAI, Anthropic, Google
              AI, DeepSeek, xAI, ni aucun autre). Les données de
              calendrier et de profil Google ne sont jamais envoyées aux
              fournisseurs de modèles LLM.
            </li>
            <li>
              <strong className="text-text-primary">
                Ne soient pas lues par des humains
              </strong>{" "}
              sauf dans les cas expressément autorisés par Google : (a)
              avec votre consentement explicite, (b) à des fins de
              sécurité (enquête sur un abus ou une violation), (c) pour
              respecter la loi applicable, ou (d) lorsque les données ont
              été agrégées et anonymisées de manière irréversible et sont
              utilisées uniquement à des fins internes
              d&apos;exploitation.
            </li>
          </ul>

          <h3 className="text-lg font-medium text-text-primary mt-6 mb-3">
            12.4 Révocation de l&apos;accès
          </h3>
          <p>
            Vous pouvez révoquer l&apos;accès de Parallly à votre compte
            Google à tout moment depuis votre{" "}
            <a
              href="https://myaccount.google.com/permissions"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:underline"
            >
              panneau d&apos;autorisations Google
            </a>
            , ou depuis la section paramètres &gt; intégrations dans
            Parallly. Lorsque vous révoquez l&apos;accès, nous supprimons
            le refresh token chiffré et désactivons l&apos;intégration.
            Pour demander la suppression complète des données associées,
            écrivez-nous à{" "}
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
            13. Plateformes Meta (WhatsApp / Instagram / Messenger)
          </h2>
          <p className="mb-4">
            Parallly s&apos;intègre aux plateformes de messagerie de Meta
            (WhatsApp Business Cloud API, Instagram Messaging et Messenger)
            via OAuth, par l&apos;intermédiaire d&apos;Embedded Signup et de
            Facebook Login. Cette section décrit spécifiquement comment nous
            traitons les données obtenues via les API Meta et les
            engagements d&apos;usage limité que nous prenons pour ces
            données.
          </p>

          <h3 className="text-lg font-medium text-text-primary mt-6 mb-3">
            13.1 Permissions / scopes que nous demandons par canal
          </h3>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong className="text-text-primary">WhatsApp :</strong>{" "}
              <code>whatsapp_business_management</code>,{" "}
              <code>whatsapp_business_messaging</code>,{" "}
              <code>business_management</code>.
            </li>
            <li>
              <strong className="text-text-primary">Instagram :</strong>{" "}
              <code>instagram_basic</code>,{" "}
              <code>instagram_manage_messages</code>,{" "}
              <code>pages_show_list</code>,{" "}
              <code>pages_manage_metadata</code>,{" "}
              <code>pages_read_engagement</code>.
            </li>
            <li>
              <strong className="text-text-primary">Messenger :</strong>{" "}
              <code>pages_messaging</code>, <code>pages_show_list</code>,{" "}
              <code>pages_read_engagement</code>,{" "}
              <code>pages_manage_metadata</code>.
            </li>
          </ul>
          <p className="mt-3">
            Chacune de ces permissions est utilisée uniquement pour : (a)
            authentifier le titulaire de l&apos;entreprise via Embedded
            Signup ou Facebook Login, (b) recevoir les messages entrants
            via webhook, et (c) envoyer des réponses au nom du compte
            professionnel connecté. Nous ne demandons ni n&apos;accédons à
            d&apos;autres permissions que celles listées.
          </p>

          <h3 className="text-lg font-medium text-text-primary mt-6 mb-3">
            13.2 Embedded Signup (WhatsApp)
          </h3>
          <p>
            Lorsque vous complétez le flux Embedded Signup, nous recevons
            un jeton d&apos;accès à longue durée associé à un System User.
            Nous chiffrons ce jeton au repos avec AES-256-GCM, stockons
            l&apos;identifiant WABA et l&apos;identifiant du numéro de
            téléphone associés à votre compte, et ne partageons jamais le
            jeton brut avec un tiers, y compris les fournisseurs de modèles
            LLM.
          </p>

          <h3 className="text-lg font-medium text-text-primary mt-6 mb-3">
            13.3 Données des utilisateurs finaux
          </h3>
          <p className="mb-4">
            Les données concernant les contacts qui écrivent à votre
            entreprise via WhatsApp, Instagram ou Messenger sont traitées
            dans le cadre suivant :
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              Le client (entreprise utilisant Parallly) est le{" "}
              <strong className="text-text-primary">
                responsable du traitement
              </strong>{" "}
              au sens du RGPD, de la LGPD, de la loi 1581 de 2012 de
              Colombie et des réglementations équivalentes.
            </li>
            <li>
              Parallly agit en tant que{" "}
              <strong className="text-text-primary">
                sous-traitant
              </strong>{" "}
              et traite les données conformément aux instructions du
              responsable du traitement, en vertu de l&apos;Accord de
              traitement des données (DPA) implicite dans les Conditions
              générales d&apos;utilisation.
            </li>
            <li>
              Nous traitons : numéro de téléphone / identifiant de profil
              Instagram ou Facebook, nom de profil, contenu des messages
              (texte, références d&apos;URL d&apos;images, localisation) et
              horodatages. Nous ne demandons ni ne recevons d&apos;adresse
              e-mail ni aucune autre donnée à caractère personnel de type
              Workspace via Meta.
            </li>
            <li>
              Le contenu des messages est transmis au fournisseur de modèle
              LLM configuré par le client (OpenAI, Anthropic, Google
              Gemini, DeepSeek ou xAI) à la seule fin de générer la
              réponse conversationnelle, dans les conditions standard de
              traitement des données de chaque fournisseur.
            </li>
            <li>
              Nous conservons le contenu des conversations pendant la
              durée configurée par le client, avec un maximum de 24 mois.
            </li>
          </ul>

          <h3 className="text-lg font-medium text-text-primary mt-6 mb-3">
            13.4 Engagements d&apos;usage
          </h3>
          <p className="mb-4">
            En ce qui concerne les données obtenues via les plateformes
            Meta, nous nous engageons à ce que ces données :
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong className="text-text-primary">
                Ne soient pas utilisées pour afficher de la publicité
              </strong>{" "}
              — ni dans Parallly ni dans aucun système externe.
            </li>
            <li>
              <strong className="text-text-primary">
                Ne soient ni vendues, ni cédées, ni transférées
              </strong>{" "}
              à des tiers à des fins publicitaires, marketing, de
              génération de leads ou de constitution de bases de données.
            </li>
            <li>
              <strong className="text-text-primary">
                Ne soient pas utilisées pour entraîner des modèles
                d&apos;intelligence artificielle
              </strong>{" "}
              — ni les nôtres ni ceux de tiers. Le contenu des
              conversations est envoyé au LLM uniquement pour générer la
              réponse immédiate du tour de parole en cours, jamais en tant
              que données d&apos;entraînement.
            </li>
            <li>
              <strong className="text-text-primary">
                Ne soient pas lues par des humains
              </strong>{" "}
              sauf dans les cas expressément autorisés par Meta : (a) avec
              votre consentement explicite, (b) à des fins de sécurité
              (enquête sur un abus ou une violation), (c) pour respecter
              la loi applicable, ou (d) lorsque les données ont été
              agrégées et anonymisées de manière irréversible.
            </li>
          </ul>

          <h3 className="text-lg font-medium text-text-primary mt-6 mb-3">
            13.5 Mécanisme de suppression
          </h3>
          <p>
            Tout utilisateur final peut demander la suppression de ses
            données via notre page de{" "}
            <Link
              href="/data-deletion"
              className="text-accent hover:underline"
            >
              demande de suppression de données
            </Link>
            . En complément, nous exposons une URL de Data Deletion
            Callback pour la plateforme Meta à l&apos;adresse{" "}
            <code>
              https://api.parallly-chat.cloud/api/v1/meta/data-deletion-callback
            </code>
            . Il s&apos;agit de l&apos;URL que le super administrateur
            doit coller dans App Dashboard &gt; Settings &gt; Advanced
            &gt; Data Deletion Callback URL. Lorsque Meta notifie un
            événement de suppression à cette URL, nous exécutons la
            suppression correspondante des données associées à
            l&apos;utilisateur notifié.
          </p>

          <h3 className="text-lg font-medium text-text-primary mt-6 mb-3">
            13.6 Fenêtre de 24 heures et modèles pré-approuvés
          </h3>
          <p>
            Conformément à la politique de WhatsApp Business, en dehors
            de la fenêtre de service de 24 heures suivant le dernier
            message du client, seuls les Message Templates pré-approuvés
            par Meta peuvent être envoyés. Le client final initie la
            conversation, et notre pipeline bloque les envois en texte
            libre en dehors de cette fenêtre. Chaque client qui utilise
            Parallly est responsable d&apos;obtenir l&apos;opt-in de ses
            contacts avant de lancer des campagnes sortantes.
          </p>

          <h3 className="text-lg font-medium text-text-primary mt-6 mb-3">
            13.7 Sous-traitants ultérieurs
          </h3>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong className="text-text-primary">
                Meta Platforms Inc.
              </strong>{" "}
              — opérateur de WhatsApp Cloud API, Instagram Messaging et
              Messenger.
            </li>
            <li>
              <strong className="text-text-primary">
                Fournisseurs de modèles LLM
              </strong>{" "}
              — OpenAI, Anthropic, Google AI, DeepSeek et xAI, utilisés
              selon la configuration de chaque client.
            </li>
            <li>
              <strong className="text-text-primary">
                Fournisseurs d&apos;hébergement / infrastructure
              </strong>{" "}
              — Hostinger (VPS) et Cloudflare (Tunnel et réseau de bord).
            </li>
            <li>
              <strong className="text-text-primary">
                Fournisseur d&apos;e-mail
              </strong>{" "}
              — service SMTP utilisé pour les e-mails transactionnels.
            </li>
          </ul>
          <p className="mt-3">
            Tous les sous-traitants ultérieurs sont liés par des accords
            de traitement des données (DPA) garantissant des niveaux de
            protection adéquats, conformément au RGPD et au contrôle de
            la CNIL.
          </p>
        </section>

        {/* 14 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            14. Contact
          </h2>
          <p className="mb-4">
            Pour exercer l&apos;un quelconque de vos droits ou pour toute
            question relative à la présente politique, vous pouvez nous
            contacter via :
          </p>
          <div className="bg-surface rounded-xl border border-border p-6 space-y-3">
            <p>
              <strong className="text-text-primary">
                Responsable du traitement :
              </strong>{" "}
              Automation AI S.A.S
            </p>
            <p>
              <strong className="text-text-primary">NIT :</strong> 902032943-1
            </p>
            <p>
              <strong className="text-text-primary">
                Délégué à la protection des données (DPO) :
              </strong>{" "}
              Andres Felipe Matallana
            </p>
            <p>
              <strong className="text-text-primary">
                E-mail confidentialité :
              </strong>{" "}
              <a
                href="mailto:cloud.manager@parallext.com"
                className="text-accent hover:underline"
              >
                cloud.manager@parallext.com
              </a>
            </p>
            <p>
              <strong className="text-text-primary">
                E-mail support :
              </strong>{" "}
              <a
                href="mailto:support@parallext.com"
                className="text-accent hover:underline"
              >
                support@parallext.com
              </a>
            </p>
            <p>
              <strong className="text-text-primary">Adresse :</strong>{" "}
              Bogotá, Colombie
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
          </div>
          <p className="mt-6 text-text-muted text-sm">
            Si vous estimez que le traitement de vos données personnelles
            enfreint la réglementation applicable, vous avez le droit de
            déposer une réclamation auprès de l&apos;autorité de
            protection des données compétente de votre juridiction. En
            France, l&apos;autorité compétente est la CNIL. En Colombie,
            l&apos;autorité compétente est la Superintendencia de
            Industria y Comercio (SIC).
          </p>
        </section>
      </div>
    </>
  );
}
