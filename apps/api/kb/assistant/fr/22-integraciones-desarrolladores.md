---
id: integraciones-desarrolladores
title: "Intégrations, API, webhooks et chat web"
routes: ["/admin/settings/integrations", "/admin/settings/integrations/crm", "/admin/settings/integrations/ecommerce", "/admin/settings/integrations/mcp", "/admin/settings/integrations/payments", "/admin/settings/integrations/reviews", "/admin/settings/integrations/slack", "/admin/settings/integrations/vertical", "/admin/settings/integrations/channel-manager", "/admin/settings/integrations/webhooks", "/admin/settings/api-keys", "/admin/settings/integrations/web-chat", "/admin/settings/integrations/web-chat/triggers"]
roles: ["tenant_admin"]
keywords: ["integrations", "api", "cle api", "webhook", "mcp", "crm", "ecommerce", "paiements", "avis", "slack", "chat web", "widget", "developpeurs", "identifiants", "toast", "mindbody", "cliniko", "channel manager", "google business"]
---

# Intégrations, API, webhooks et chat web

Un administrateur gère les connexions externes dans **Paramètres → Canaux et intégrations**. Il peut y connecter CRM, commerce électronique, paiements, avis, Slack, services sectoriels et serveurs MCP, ainsi que configurer le chat web.

Pour une intégration personnalisée, utilisez **Clés API** et **Webhooks**. Traitez les clés et secrets comme des mots de passe : copiez-les uniquement dans le système concerné, renouvelez tout identifiant exposé et vérifiez la signature de chaque webhook. Avant la production, testez l'événement avec des données non sensibles et confirmez les actions autorisées.

Dans **Intégrations → Paiements**, l’entreprise peut connecter son propre compte Wompi ou prestataire de paiement compatible pour encaisser ses clients. Les fonds vont directement sur ce compte et ces identifiants ne paient jamais l’abonnement Parallly. Sélectionnez un seul prestataire actif, copiez l’URL d’événements affichée et activez **Encaissements clients** sur l’agent. L’agent utilise le montant de la commande enregistré dans Parallly et ne confirme « payé » qu’après validation de l’événement et de la transaction canonique par le backend ; un lien, une redirection ou une capture d’écran ne prouve pas le paiement. Les nouveaux liens dépendent de la feature du forfait, tandis que les paiements déjà émis continuent d’être rapprochés après un downgrade.

La disponibilité de chaque connecteur dépend de la configuration du compte. L'écran de l'intégration et **Forfait et facturation** sont la source à jour ; ne vous fiez pas à des limites ou tarifs copiés dans des documents externes.

## Intégrations verticales (Toast, Mindbody, Cliniko)

Dans **Paramètres → Canaux et intégrations → Intégrations verticales**, vous connectez le système déjà utilisé dans votre secteur : **Toast** (restaurants : menu, articles et prix), **Mindbody** (fitness : cours et horaires) ou **Cliniko** (santé : types de rendez-vous et disponibilités, sans accès au dossier médical). L'écran n'affiche que les fournisseurs qui s'appliquent à votre type d'activité.

Ces intégrations sont **en lecture seule et en bêta** : elles apportent des données à l'agent, mais n'écrivent pas dans le système source et ne confirment pas la disponibilité en temps réel quand le fournisseur ne l'offre pas (Mindbody, par exemple, ne confirme ni places ni réservations). Renseignez les identifiants, cliquez sur **Tester** puis, si la connexion répond, sur **Synchroniser**. Chaque carte indique l'état, la date de la dernière donnée reçue et les permissions manquantes. Le **Mappage par ressource** relie un site, un calendrier ou une ressource Parallly à son identifiant externe ; un mappage n'autorise jamais d'écriture à lui seul.

## Channel Manager (hôtel et location saisonnière)

Si votre activité est un hôtel ou une location saisonnière, cet écran affiche aussi un accès au **Channel Manager**, qui connecte Hostaway. Vous pouvez utiliser **Tester sans synchroniser** avant d'enregistrer ; cliquez ensuite sur **Synchroniser maintenant** et reliez chaque annonce externe à exactement un logement Parallly. Hostaway reste la source de vérité : l'agent ne crée pas encore de réservations chez lui, et une annonce non mappée garde ses réservations conversationnelles bloquées et les transmet à votre équipe. Sans channel manager, vous pouvez synchroniser Airbnb ou Booking.com par iCal depuis chaque propriété (voir **Outils et modules selon votre secteur**).

## Avis Google

Dans **Paramètres → Canaux et intégrations → Avis**, cliquez sur **Connecter Google Business**, autorisez l'accès et enregistrez l'établissement. **Synchroniser** importe vos avis (ils se mettent aussi à jour seuls toutes les quelques heures) et affiche la note moyenne, le total, les avis sans réponse et les négatifs. Sur chaque avis, **Suggérer avec IA** propose une réponse dans la langue de votre compte ; relisez-la, modifiez-la si besoin et cliquez sur **Publier la réponse** pour la publier sur Google. Si vous activez **Réponse automatique IA**, Parallly publie sans relecture humaine une réponse à chaque nouvel avis sans réponse, y compris les négatifs : ne l'activez que si vous acceptez ce risque.

## Serveurs MCP externes

Connecter ou découvrir un serveur MCP externe n'autorise pas ses outils. Un administrateur examine chaque outil et déclare son effet (lecture, écriture, paiement, notification ou irréversible) et s'il exige une confirmation du client ou une approbation humaine. Un outil non examiné reste bloqué pour l'agent.
