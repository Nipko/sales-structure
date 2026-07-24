---
id: broadcast
title: "Campagnes et diffusion (broadcast)"
routes: ["/admin/broadcast", "/admin/channels/whatsapp/templates", "/admin/contacts/segments"]
roles: ["tenant_admin", "tenant_supervisor"]
keywords: ["campagne", "campagnes", "broadcast", "diffusion", "envoi de masse", "messages de masse", "whatsapp de masse", "modèle", "modèles whatsapp", "template", "segment", "destinataires", "audience", "programmer un envoi", "promotions", "marketing", "livré", "lu", "test a/b", "numéro expéditeur"]
---

# Campagnes et diffusion (broadcast)

Une **campagne** (ou broadcast) est un message que vous envoyez en une seule fois à un grand nombre de vos contacts : une promotion, une annonce, un rappel général. Il part par **WhatsApp** et/ou **Email**, vers l'ensemble de vos contacts ou vers un segment précis.

Vous trouvez les campagnes dans la barre latérale, section **Croissance → Campagnes**. Elles peuvent être créées par les utilisateurs ayant le rôle **administrateur** ou **superviseur** (pas les agents).

## Avant de commencer

- **WhatsApp utilise des modèles approuvés par Meta.** Pour écrire à un client qui ne vous a pas parlé au cours des dernières 24 heures, WhatsApp exige que le message soit un modèle vérifié et approuvé par Meta. Consultez vos modèles dans **Canaux → WhatsApp** (vous y verrez le résumé des modèles et le bouton **Voir tous les modèles**).
- **Préparez votre audience.** Vous pouvez envoyer à **Tous les contacts** ou à un **Segment** (groupe enregistré de contacts avec des filtres, par exemple « clients VIP »). Les segments se créent dans **CRM → Segments**.
- **Vérifiez votre offre.** L'offre Emprendedor n'inclut pas les campagnes, et Starter en autorise jusqu'à 3 par mois (voir le tableau des limites plus bas).

## Comment créer et envoyer une campagne

1. Allez dans **Croissance → Campagnes** et cliquez sur **Nouvelle campagne**.
2. Saisissez le **Nom de la campagne** (par exemple, « Promo été 2026 »). Il sert uniquement à un usage interne.
3. Dans **Canaux d'envoi**, choisissez **WhatsApp**, **Email** ou les deux.
4. Rédigez le contenu de chaque canal :
   - **Modèle WhatsApp** : écrivez le texte du message. Utilisez `{{name}}` pour insérer automatiquement le nom de chaque contact. N'oubliez pas qu'il doit correspondre à un modèle approuvé par Meta si vous contactez des clients en dehors de la fenêtre de 24 heures.
   - **Contenu de l'email** : objet et corps du message.
5. Si vous avez **plus d'un numéro WhatsApp connecté**, le sélecteur **Envoyer depuis le numéro** apparaît : choisissez depuis quel numéro part la campagne, ou laissez **Numéro principal (par défaut)**.
6. Dans **Audience**, choisissez **Tous les contacts** ou **Segment** (et sélectionnez lequel ; vous verrez combien de contacts il contient).
7. Dans **Date d'envoi (optionnel)** :
   - Si vous choisissez une date et une heure, le bouton affichera **Programmer** et la campagne partira toute seule à ce moment-là.
   - Si vous la laissez vide, le bouton affichera **Enregistrer brouillon** et la campagne reste enregistrée sans être envoyée.
8. Pour envoyer un brouillon immédiatement, ouvrez-le dans la liste et utilisez **Envoyer maintenant**.

> Astuce : les envois de masse partent à un rythme contrôlé pour protéger votre numéro WhatsApp. Si la campagne est volumineuse, il est normal qu'elle prenne plusieurs minutes à se terminer.

## États d'une campagne

Chaque campagne affiche son état dans la liste : **Brouillon** (enregistrée, non programmée), **Programmée**, **En envoi**, **Envoyée**, **Terminée** ou **Échouée**.

## Métriques : comment lire les résultats

En haut de **Campagnes**, vous voyez les totaux : **Campagnes**, **Envoyées**, **Programmées** et **Réponses**. De plus, chaque campagne affiche son entonnoir :

- **Destinataires** — à combien de contacts elle a été adressée.
- **Livré** — combien de messages sont arrivés sur le téléphone ou dans la boîte du client.
- **Lu** — combien l'ont ouvert (WhatsApp signale les lectures lorsque le client les a activées).
- **Ont répondu** — combien ont répondu au message.

Si vous voulez en plus savoir combien de **ventes** chaque campagne a générées, consultez **Revenus par campagnes** dans la section d'attribution des Analytiques.

## Tests A/B (offres Pro et supérieures)

Avec l'interrupteur **Tester deux variantes (A/B)** lors de la création de la campagne, vous pouvez envoyer deux versions du message et découvrir laquelle fonctionne le mieux :

1. Activez **Tester deux variantes (A/B)** et rédigez la **Variante A** et la **Variante B**.
2. Ajustez la **Répartition de l'envoi** (quel pourcentage de l'audience reçoit chaque variante).
3. Optionnel : activez l'**Auto-sélection** pour que le système détecte la variante gagnante et l'utilise automatiquement avec le reste de l'audience.
4. Après l'envoi, la campagne affiche les résultats par variante (envoyés, livrés, taux de lecture) et vous pouvez utiliser **Sélectionner gagnante**.

> Conseil : ne changez qu'un seul élément entre les variantes (le texte, l'offre ou l'appel à l'action). Vous saurez ainsi exactement ce qui a fait la différence.

## Modèles WhatsApp : créer et faire approuver

Chemin : **Canaux → WhatsApp → Voir tous les modèles**.

- **Créer un modèle** : donnez-lui un nom (minuscules et tirets bas, ex. `recordatorio_pago`), choisissez la langue et la catégorie, écrivez l'en-tête, le corps (avec des variables comme `{{1}}`), le pied de page et jusqu'à 3 boutons. Une fois terminé, **Envoyer à Meta**.
- Meta l'examine normalement entre quelques minutes et 72 heures. Les états sont **Approuvés**, **En attente** et **Rejetés** (avec le motif du rejet visible).
- **Synchroniser depuis Meta** récupère les modèles déjà approuvés dans votre compte.
- En connectant WhatsApp, Parallly envoie automatiquement 3 **modèles de départ** utilitaires (rappel de rendez-vous, confirmation de commande et paiement reçu) que Meta approuve généralement en quelques minutes.
- Si vous avez plusieurs numéros, lors de la création du modèle vous choisissez le **Numéro / compte** auquel il appartient.

## Limites par offre

| Offre | Campagnes par mois | Tests A/B | Segments | Contacts |
|------|-----------------|-------------|-----------|-----------|
| Emprendedor | Non inclus | — | — | 100 |
| Starter | 3 | Non | 3 | 500 |
| Pro | Illimitées | Oui | 15 | 5.000 |
| Enterprise | Illimitées | Oui | Illimités | 50.000 |
| Custom | Illimitées | Oui | Illimités | Illimités |

Autres limites associées : le canal **Email** est disponible à partir de l'offre Starter, et le nombre de **numéros WhatsApp** que vous pouvez connecter dépend de l'offre (Pro : 2, Enterprise : 3, Custom : sans limite). Vous pouvez changer d'offre dans **Configuration → Facturation**.

## Et le SMS ?

Le SMS dans Parallly **n'est pas un canal de conversation** : c'est une notification à sens unique qui fonctionne avec des **crédits** (1 crédit = 1 segment de SMS) et qui part via l'infrastructure de la plateforme, sans que vous ayez besoin de souscrire à quoi que ce soit à part. L'achat de packs et votre solde se gèrent dans **Configuration → Facturation**. Si l'option SMS n'apparaît pas lors de la création de votre campagne, c'est qu'elle n'est pas encore activée pour votre compte.

## Questions fréquentes

**Pourquoi je ne vois pas la section Campagnes ?**
Votre rôle doit être administrateur ou superviseur, et votre offre doit inclure les campagnes (l'offre Emprendedor ne les inclut pas).

**Puis-je annuler une campagne programmée ?**
Tant qu'elle est à l'état **Programmée**, vous pouvez la gérer depuis la liste avant l'heure d'envoi. Une fois à l'état **En envoi**, les messages sont déjà en train de partir.

**Pourquoi ma campagne WhatsApp n'arrive-t-elle pas à certains contacts ?**
Les causes les plus fréquentes : le modèle n'est pas **Approuvé** par Meta, le contact s'est désabonné (on ne lui envoie plus de diffusions) ou le numéro n'existe plus. Vérifiez l'état du modèle dans **Canaux → WhatsApp**.

**Puis-je personnaliser le message avec le nom de chaque client ?**
Oui : écrivez `{{name}}` dans le texte et chaque contact recevra son propre nom.

**Combien de temps Meta met-il pour approuver un modèle ?**
Normalement entre quelques minutes et 72 heures. Vous verrez l'état (En attente/Approuvé/Rejeté) dans la liste des modèles.

**Est-ce que l'IA répond à la campagne ?**
Si un client répond à votre campagne WhatsApp, la réponse entre comme une conversation normale et est prise en charge par l'agent IA de cette connexion.

Besoin de plus d'aide ? Écrivez-nous sur https://parallly-chat.cloud/support
