---
id: sms-creditos
title: "Crédits SMS et notifications par SMS"
routes: ["/admin/settings/billing", "/admin/broadcast"]
roles: ["tenant_admin"]
keywords: ["sms", "crédits", "crédits sms", "forfait sms", "acheter des crédits", "solde sms", "recharge", "messages texte", "notifications sms", "segment", "mercadopago", "paiement unique", "campagnes sms", "rappels sms", "solde épuisé", "alertes par texto", "sms désactivé", "texto aux clients"]
---

# Crédits SMS et notifications par SMS

Avec Parallly, vous pouvez envoyer des **notifications par SMS** à vos clients : des rappels, des alertes et des promotions qui arrivent sous forme de message texte sur leur téléphone. Le SMS fonctionne avec un système de **crédits prépayés** que vous achetez par forfait.

Important : le SMS **n'est pas un canal de conversation**. Il s'agit d'un envoi à **sens unique** : votre client reçoit le message, mais ne peut pas y répondre par SMS. Les conversations avec votre agent IA se déroulent via WhatsApp, Instagram, Messenger, Telegram, Email ou le chat web.

## Qu'est-ce qu'un crédit

- **1 crédit = 1 segment de SMS** (environ **160 caractères** de texte simple).
- Si votre message contient des **accents, des caractères spéciaux ou des emojis**, chaque segment se réduit à environ **70 caractères**, car le texte est transmis dans un format différent.
- Un message plus long qu'un segment est divisé en plusieurs et **consomme un crédit par segment**. Par exemple, un rappel d'environ 120 caractères avec des accents utilise 2 segments, soit 2 crédits.

Conseil : rédigez des messages courts et directs. Si vous pouvez éviter les accents et les emojis, chaque crédit rend davantage.

## Comment acheter un forfait de crédits

Les forfaits se paient avec **MercadoPago** en **paiement unique** : ce n'est pas un abonnement et cela ne génère aucun prélèvement récurrent.

1. Dans le menu latéral, sous **Gestion**, ouvrez **Facturation**.
2. Descendez jusqu'à la section **Crédits SMS**. Vous y verrez les forfaits disponibles avec leur nombre de messages et leur prix (certains sont marqués comme **Le plus populaire**).
3. Choisissez le forfait dont vous avez besoin et appuyez sur **Acheter**.
4. Le paiement MercadoPago s'ouvre. Effectuez le paiement comme pour n'importe quel achat en ligne.
5. De retour sur Parallly, vous verrez le message « Traitement de votre achat… » : les crédits sont **crédités automatiquement en quelques secondes** après la confirmation du paiement.

Seul l'**administrateur** du compte peut acheter des crédits, car l'achat se fait depuis la page Facturation.

## Comment consulter votre solde et votre consommation

Dans la même section **Crédits SMS** de **Facturation**, vous trouverez :

- Votre **solde actuel** (« crédits disponibles »), toujours visible en haut de la section.
- Les **SMS consommés ce mois-ci**.
- Des alertes automatiques : lorsque votre solde **descend en dessous de 50 crédits**, une alerte apparaît pour vous suggérer de recharger, et lorsqu'il atteint **0**, un message bien visible vous invite à acheter un forfait.

Chaque envoi est enregistré en interne avec sa date et son nombre de crédits, afin que le solde reflète toujours exactement ce qui a été acheté moins ce qui a été consommé.

## Comment envoyer des notifications SMS à vos clients

Les SMS partent depuis **Campagnes** (menu latéral, section **Croissance**) :

1. Ouvrez **Campagnes** et créez une nouvelle campagne.
2. Au moment de choisir les canaux d'envoi, sélectionnez **SMS** (si l'option est disponible sur votre compte).
3. Rédigez le texte du message. L'éditeur affiche le compteur de caractères pour que vous sachiez combien de segments seront utilisés.
4. Choisissez l'audience, puis envoyez ou programmez la campagne.

Outre les campagnes, les envois automatiques que vous avez configurés par SMS **consomment également des crédits**, comme les **rappels de rendez-vous** et les **séquences de suivi**.

Ce qui **ne** consomme **pas** de crédits : les SMS que la plateforme vous envoie à vous pour des raisons de sécurité (par exemple, les codes de vérification). Vos crédits servent uniquement aux messages que votre entreprise envoie à **vos clients**.

## Pourquoi cela peut apparaître désactivé

Il existe trois situations distinctes :

- **Vous ne voyez pas la section « Crédits SMS » dans Facturation, ou le SMS n'apparaît pas comme canal dans Campagnes** : le service SMS s'active au niveau de la plateforme et peut être temporairement désactivé (par exemple, pendant l'ajustement de la couverture dans votre pays). Tant qu'il est désactivé, il n'est pas possible d'acheter des crédits ni d'envoyer des SMS. Votre **solde reste intact** et redevient disponible lorsque le service est réactivé.
- **Vous n'avez plus de solde** : les envois par SMS ne partent tout simplement **pas** et **rien ne vous est facturé**. Achetez un forfait et les prochains envois partiront normalement (les messages qui ne sont pas partis faute de solde ne sont pas renvoyés automatiquement).
- **Vous n'êtes pas administrateur** : l'achat de forfaits se trouve dans Facturation, que seul l'administrateur du compte peut voir. Demandez à votre administrateur d'effectuer la recharge.

## Questions fréquentes

**Les crédits expirent-ils ?**
Ils n'ont pas de date d'expiration : votre solde est conservé jusqu'à ce que vous le consommiez, même si le service SMS est mis en pause temporairement.

**L'achat de crédits est-il un abonnement ?**
Non. C'est un **paiement unique** via MercadoPago. Vous achetez quand vous le souhaitez et vous rechargez uniquement lorsque vous en avez besoin.

**Mes clients peuvent-ils répondre au SMS ?**
Non. Le SMS est à sens unique. Si vous souhaitez échanger avec vos clients, utilisez les canaux conversationnels (WhatsApp, Instagram, Messenger, Telegram, Email ou le chat web).

**Pourquoi un seul message m'a-t-il décompté plusieurs crédits ?**
Parce qu'il a dépassé un segment. Le texte simple rend environ 160 caractères par segment ; avec des accents ou des emojis, environ 70. Un message long est divisé en plusieurs segments et chacun coûte 1 crédit.

**J'ai payé et je ne vois pas les crédits ?**
Le crédit est automatique et prend généralement quelques secondes après la confirmation du paiement. Actualisez la page **Facturation** ; si après quelques minutes le solde n'apparaît toujours pas, écrivez-nous au support : https://parallly-chat.cloud/support

**Depuis quel numéro les SMS partent-ils ?**
Ils sont envoyés par Parallly avec un numéro émetteur de la plateforme ; vous n'avez besoin de souscrire ni de connecter aucun fournisseur de SMS personnel.
