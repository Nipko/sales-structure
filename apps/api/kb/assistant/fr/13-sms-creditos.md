---
id: sms-creditos
title: "Crédits SMS et notifications par SMS"
routes: ["/admin/settings/billing", "/admin/broadcast"]
roles: ["tenant_admin", "tenant_supervisor"]
keywords: ["sms", "credits", "credits sms", "forfait sms", "acheter des credits", "solde sms", "recharge", "messages texte", "notifications sms", "segment", "campagnes sms", "rappels sms", "solde epuise", "sms desactive", "texte aux clients"]
---

# Crédits SMS et notifications par SMS

Le SMS est une fonction de **notification sortante**, pas un canal de conversation avec l'agent IA. Sa disponibilité, sa couverture, l'identité de l'expéditeur et le provisionnement des crédits dépendent de l'intégration activée pour le compte et le pays.

## Segments et consommation

Un crédit représente un segment SMS. Le texte simple contient généralement plus de caractères qu'un message avec certains symboles ou émojis, et un message long peut être divisé en plusieurs segments. Le compteur de l'éditeur fait foi avant l'envoi : vérifiez son estimation, car l'encodage du texte peut modifier le total.

## Solde ou achat de crédits

Un administrateur peut ouvrir **Administration → Forfait et facturation**. Si la section **Crédits SMS** apparaît, elle affiche le solde, la consommation et les options actives. Lorsqu'une action d'achat ou de recharge existe, la page indique les forfaits, le prix, la devise, le prestataire, les conditions et la confirmation ; utilisez uniquement ce parcours sécurisé.

Si la section ou le bouton est absent, l'achat n'est pas activé pour ce compte. Ne supposez ni prestataire, ni type de paiement, ni crédit immédiat, ni règle d'expiration : la page et la confirmation de l'opération sont la source actuelle.

## Préparer un brouillon de campagne SMS

Un administrateur ou superviseur peut utiliser **IA et croissance → Campagnes** lorsque SMS apparaît comme option :

1. Créez la campagne et sélectionnez **SMS**.
2. Rédigez le texte et vérifiez le nombre estimé de segments.
3. Choisissez une audience autorisée et confirmez le respect des désinscriptions.
4. Relisez le récapitulatif et enregistrez le brouillon. Ne l'envoyez pas et ne le programmez pas en production depuis l'éditeur actuel : il partage le flux de campagnes non encore certifié et une campagne programmée n'a pas d'action d'annulation. Consultez **Campagnes et diffusion**.

Les rappels et automatisations peuvent aussi consommer des crédits lorsque l'action SMS est activée. Les codes de sécurité envoyés par Parallly aux utilisateurs ne font pas partie des campagnes de l'entreprise.

## Si SMS est désactivé

- Si SMS n'apparaît pas dans **Campagnes**, le service n'est pas disponible pour ce compte, ce pays ou cette configuration.
- Si le solde est insuffisant, l'envoi est bloqué ; consultez la page avant de réessayer.
- Un superviseur peut préparer ou gérer les campagnes autorisées, mais seul l'administrateur accède à la facturation ou à un achat activé.
- Si une opération confirmée n'apparaît pas, actualisez la page et contactez le support avec la date et l'état, sans partager de données de paiement sensibles.

Le numéro ou l'identité de l'expéditeur dépend de l'intégration et peut varier selon le pays. Ne promettez pas de réponses SMS entrantes sauf si la page indique elle-même que la messagerie bidirectionnelle est activée.
