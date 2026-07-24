---
id: facturacion-planes
title: "Forfaits, facturation et données fiscales"
routes: ["/admin/settings/billing", "/admin/settings/fiscal"]
roles: ["tenant_admin"]
keywords: ["forfaits", "tarifs", "prix", "facturation", "paiement", "mercadopago", "carte bancaire", "changer de forfait", "surclasser", "essai gratuit", "annuel", "mensuel", "facture", "historique des paiements", "données fiscales", "nit", "cédula", "dian", "limite du forfait", "crédits sms", "coupon"]
---

# Forfaits, facturation et données fiscales

Tout ce qui touche à votre abonnement se trouve sur une seule page : dans le menu latéral, section **Gestion**, ouvrez **Facturation**. Vous y voyez votre forfait actuel, vous changez de forfait, gérez votre carte, consultez votre historique de paiements et achetez des crédits SMS. Seul le rôle administrateur peut consulter et modifier la facturation.

## Les 5 forfaits

| Forfait | Prix mensuel | Agents IA | Messages IA/mois | Utilisateurs | Contacts | Calendriers | Canaux |
|---------|--------------|-----------|------------------|--------------|----------|-------------|--------|
| **Emprendedor** | USD $21 | 1 | 1 000 | 1 | 100 | 1 | WhatsApp uniquement |
| **Starter** | USD $49 | 1 | 5 000 | 3 | 500 | 1 | WhatsApp, Instagram, Messenger, Email et chat web |
| **Pro** | USD $129 | 3 | 25 000 | 5 | 5 000 | 3 | Tous |
| **Enterprise** | USD $349 | 10 | 100 000 | Illimités | 50 000 | 10 | Tous |
| **Custom** | Sur devis | Illimités | Illimités | Illimités | Illimités | Illimités | Tous |

Quelques détails utiles :

- **Emprendedor** est le forfait d'entrée : WhatsApp uniquement, sans automatisations ni campagnes. Idéal pour démarrer puis évoluer.
- **Starter** débloque davantage de canaux, 5 règles d'automatisation et 3 campagnes par mois.
- **Pro** ajoute Telegram, des automatisations et campagnes illimitées, et jusqu'à **2 numéros WhatsApp** connectés en même temps (chaque connexion avec son propre agent IA).
- **Enterprise** permet jusqu'à 3 numéros WhatsApp, 2 comptes Instagram et un support prioritaire.
- **Custom** est sur mesure : le prix et les limites sont convenus avec l'équipe Parallly.
- N'oubliez pas : il y a **un agent IA par connexion**. Si vous avez 2 numéros WhatsApp, chaque numéro a son agent ; le nombre de connexions du même type que vous pouvez avoir dépend de votre forfait.
- Les prix s'affichent dans votre **monnaie locale** lorsqu'elle est disponible (par exemple, en pesos colombiens) ; sinon, vous verrez l'équivalent en USD.
- Le SMS n'est pas un canal de conversation : ce sont des **notifications sortantes qui fonctionnent avec des crédits** (1 crédit = 1 segment de SMS). Voir plus bas.

## Essai gratuit

- **Emprendedor et Starter** : 7 jours d'essai, **sans carte**.
- **Pro et Enterprise** : 15 jours d'essai, **avec carte** (aucun prélèvement avant la fin de l'essai).
- Votre compte démarre avec l'essai du forfait Emprendedor dès l'inscription.
- 3 jours avant la fin de l'essai, vous recevez un e-mail de rappel. Si l'essai expire sans carte, le compte passe en état **Expiré** : vous perdez l'accès, mais **vos données sont conservées** et tout revient dès le paiement.

## Cycle mensuel ou annuel

Chaque forfait payant peut être facturé en cycle **Mensuel** ou **Annuel**. L'annuel applique une **remise d'environ 15 %** sur le total de l'année.

1. Ouvrez **Gestion → Facturation**.
2. Utilisez le sélecteur **Mensuel / Annuel** : en choisissant Annuel, les cartes de forfait affichent le prix annuel et l'économie.
3. Pour changer le cycle d'un abonnement actif, utilisez **Passer à l'annuel** (ou **Passer au mensuel**). Le changement de cycle est **immédiat** : l'abonnement actuel se ferme et un nouveau est créé avec le cycle choisi.

## Comment surclasser ou rétrograder de forfait

1. Ouvrez **Gestion → Facturation** et descendez jusqu'à **Forfaits disponibles**.
2. Sur la carte du forfait souhaité, cliquez sur **Passer à…** (surclasser) ou **Rétrograder vers…** (rétrograder).
3. Si vous **surclassez** : une carte est demandée et le prélèvement du nouveau forfait est immédiat. Les nouvelles limites s'appliquent instantanément.
4. Si vous **rétrogradez** : le changement est **programmé pour la fin de votre période en cours**, sans prélèvement supplémentaire. Vous conservez toutes vos fonctionnalités jusqu'à cette date, et vous pouvez faire marche arrière avec le bouton **Conserver mon forfait**.

## Moyen de paiement (MercadoPago)

Les prélèvements sont traités avec **MercadoPago**. Votre carte est enregistrée de manière sécurisée (Parallly ne voit jamais le numéro complet).

Pour changer de carte :

1. Dans **Gestion → Facturation**, cliquez sur **Changer de carte**.
2. Saisissez les données de la nouvelle carte dans la fenêtre sécurisée de MercadoPago.
3. Cliquez sur **Enregistrer la nouvelle carte**. Le prochain prélèvement utilisera la nouvelle carte.

### Si un prélèvement échoue

Lorsqu'un paiement est refusé, votre abonnement passe en état **Paiement en attente** et vous recevez un e-mail avec les instructions. Vous avez deux options :

- **Changer de carte** et attendre la nouvelle tentative automatique.
- Cliquer sur **Réessayer le prélèvement maintenant** pour forcer la vérification immédiatement.

Si après **7 jours** le paiement n'est pas récupéré, le compte est suspendu temporairement. Vos données sont conservées pendant 90 jours et tout est réactivé dès le paiement.

## Historique des paiements et factures

Sur la même page **Facturation**, la section **Historique des factures** affiche vos derniers paiements avec **Date**, **Montant** (dans la monnaie du prélèvement) et **État** (Réussi, Échoué, Remboursé ou En attente). Lorsqu'une facture est disponible, le bouton **Télécharger** apparaît.

## Mettre en pause ou annuler

- **Mettre l'abonnement en pause** : pour faire une pause sans annuler. Vous n'êtes pas prélevé pendant la pause et vous revenez avec **Reprendre** (le prochain prélèvement conserve votre date d'origine). Les limites du forfait continuent de s'appliquer pendant la pause.
- **Annuler à la fin de la période** : vous conservez l'accès jusqu'à la date de fin de votre cycle en cours.
- **Annuler maintenant** : l'accès prend fin immédiatement, sans remboursement de la période en cours.

## Coupons promotionnels

Si vous avez reçu un code promotionnel, dans **Facturation**, repérez la section **Code de coupon**, collez le code et cliquez sur **Appliquer**. Il existe des coupons en pourcentage de remise, en montant fixe et en mois gratuits (ils prolongent votre essai). Si le coupon n'est pas accepté, le message vous en indiquera la raison (expiré, déjà utilisé, non applicable à votre forfait, etc.).

## Crédits SMS (notifications à vos clients)

L'envoi de SMS fonctionne avec des **crédits prépayés** : 1 crédit = 1 segment de SMS. Dans **Facturation**, la section **Crédits SMS** affiche votre solde disponible et votre consommation du mois.

1. Choisissez un pack de crédits et cliquez sur **Acheter**.
2. Payez avec MercadoPago en **paiement unique** (ce n'est pas un abonnement).
3. Les crédits sont crédités automatiquement en quelques secondes.

Les packs et les prix sont définis par la plateforme et peuvent varier selon le pays. Si la fonction SMS est désactivée au niveau de la plateforme, la section ne permet ni d'acheter ni d'envoyer.

## Données fiscales pour la Colombie (NIT ou cédula) et factures DIAN

Si votre entreprise se trouve en Colombie, Parallly émet une **facture électronique DIAN** de vos prélèvements. Pour que la facture soit au nom de votre entreprise, complétez votre profil fiscal :

1. Dans le menu latéral, ouvrez **Paramètres**.
2. Dans la section **Entreprise**, ouvrez **Facturation électronique**.
3. Complétez : type d'organisation (personne morale ou physique), **type et numéro de document** (NIT ou cédula ; le chiffre de vérification du NIT est calculé automatiquement), assujettissement à la TVA, raison sociale ou noms, municipalité, adresse, e-mail et téléphone.
4. Enregistrez les modifications.

Sur cette même page, vous voyez l'**historique des factures émises** (numéro, état, montant, PDF/XML) et vous pouvez réessayer une facture restée en attente.

> **Important :** si vous ne complétez pas vos données fiscales, vos factures sont émises au nom de « Consommateur Final » et **ne vous servent pas à la déduction fiscale**. La page Facturation vous le rappelle avec les accès **Voir les données fiscales** / **Compléter les données fiscales**.

## Que se passe-t-il en atteignant une limite

La page **Facturation** affiche des barres d'utilisation de votre forfait : messages IA du mois, traitement multimédia (audios et images) et base de connaissances.

- À **80 %** d'utilisation, vous voyez un avertissement ambre ; à **95 %**, une alerte rouge avec le bouton **Surclasser le forfait**.
- Si vous atteignez la limite d'une ressource (contacts, agents, campagnes, etc.), la plateforme vous prévient avec un message du type « Vous avez atteint la limite de votre forfait actuel » et vous ne pourrez plus créer de cette ressource jusqu'à surclasser votre forfait ou libérer de l'espace.
- Si la limite **multimédia** est épuisée, votre agent continue de répondre, mais les audios et images sont enregistrés de façon générique, sans transcription ni analyse.
- Les compteurs mensuels sont réinitialisés le premier jour de chaque mois.

## Questions fréquentes

**Puis-je changer de forfait quand je veux ?**
Oui. Les surclassements s'appliquent instantanément (avec prélèvement immédiat) ; les rétrogradations sont programmées pour la fin de votre période, sans prélèvement supplémentaire.

**Qu'advient-il de mes données si je cesse de payer ou si j'annule ?**
Elles sont conservées. Le compte est bloqué, mais dès la réactivation du paiement, vous récupérez tout tel quel.

**Puis-je payer dans ma monnaie locale ?**
Le prix s'affiche dans votre monnaie lorsqu'un tarif local existe (la Colombie, par exemple). Le prélèvement est traité par MercadoPago avec la carte que vous enregistrez.

**L'essai gratuit me demande-t-il une carte ?**
Emprendedor et Starter, non. Pro et Enterprise, oui, mais rien n'est prélevé avant la fin de l'essai.

**Comment obtenir ma facture ?**
Dans **Facturation → Historique des factures**, bouton **Télécharger**. Si vous êtes en Colombie et que vous avez complété vos données fiscales, vous recevez en plus la facture électronique DIAN (PDF/XML) dans **Paramètres → Facturation électronique**.

Une question sur un prélèvement ? Écrivez-nous à https://parallly-chat.cloud/support — l'équipe Parallly vous aide avec plaisir.
