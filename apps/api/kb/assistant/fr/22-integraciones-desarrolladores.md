---
id: integraciones-desarrolladores
title: "Intégrations, API, webhooks et chat web"
routes: ["/admin/settings/integrations", "/admin/settings/integrations/crm", "/admin/settings/integrations/ecommerce", "/admin/settings/integrations/mcp", "/admin/settings/integrations/payments", "/admin/settings/integrations/reviews", "/admin/settings/integrations/slack", "/admin/settings/integrations/vertical", "/admin/settings/integrations/webhooks", "/admin/settings/api-keys", "/admin/settings/integrations/web-chat", "/admin/settings/integrations/web-chat/triggers"]
roles: ["tenant_admin"]
keywords: ["integrations", "api", "cle api", "webhook", "mcp", "crm", "ecommerce", "paiements", "avis", "slack", "chat web", "widget", "developpeurs", "identifiants"]
---

# Intégrations, API, webhooks et chat web

Un administrateur gère les connexions externes dans **Paramètres → Canaux et intégrations**. Il peut y connecter CRM, commerce électronique, paiements, avis, Slack, services sectoriels et serveurs MCP, ainsi que configurer le chat web.

Pour une intégration personnalisée, utilisez **Clés API** et **Webhooks**. Traitez les clés et secrets comme des mots de passe : copiez-les uniquement dans le système concerné, renouvelez tout identifiant exposé et vérifiez la signature de chaque webhook. Avant la production, testez l'événement avec des données non sensibles et confirmez les actions autorisées.

Dans **Intégrations → Paiements**, l’entreprise peut connecter son propre compte Wompi ou Mercado Pago pour encaisser ses clients. Les fonds vont directement sur ce compte et ces identifiants ne paient jamais l’abonnement Parallly. Sélectionnez un seul prestataire actif, copiez l’URL d’événements affichée et activez **Encaissements clients** sur l’agent. L’agent utilise le montant de la commande enregistré dans Parallly et ne confirme « payé » qu’après validation de l’événement et de la transaction canonique par le backend ; un lien, une redirection ou une capture d’écran ne prouve pas le paiement. Les nouveaux liens dépendent de la feature du forfait, tandis que les paiements déjà émis continuent d’être rapprochés après un downgrade.

La disponibilité de chaque connecteur dépend de la configuration du compte. L'écran de l'intégration et **Forfait et facturation** sont la source à jour ; ne vous fiez pas à des limites ou tarifs copiés dans des documents externes.
