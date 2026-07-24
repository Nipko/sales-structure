---
id: citas-calendarios
title: "Rendez-vous et calendriers"
routes: ["/admin/appointments", "/admin/settings/public-booking"]
roles: ["tenant_admin", "tenant_supervisor", "tenant_agent"]
keywords: ["rendez-vous", "agenda", "calendrier", "planifier", "réservations", "réserver", "services", "disponibilité", "horaires", "google calendar", "outlook", "rappels", "confirmation de présence", "reprogrammer", "annuler un rendez-vous", "dates bloquées", "lien de réunion", "meet", "teams", "réservation publique", "page de réservation", "rendez-vous récurrent"]
---

# Rendez-vous et calendriers

Parallly intègre un agenda complet : vous définissez vos services et vos horaires une seule fois, et à partir de là votre agent IA prend les rendez-vous tout seul au fil de la conversation, votre équipe les voit dans un calendrier partagé et tout peut se synchroniser avec Google Calendar ou Outlook.

Tout se trouve dans la barre latérale, sous **Rendez-vous**. En entrant, vous verrez la page **Rendez-vous et planification** avec cinq onglets : **Calendrier** (vue par semaine ou par jour), **Agenda** (liste des rendez-vous), **Services** (services disponibles), **Configuration** et **Analytiques**. La configuration est réservée aux administrateurs et aux superviseurs ; les agents peuvent consulter le calendrier, créer des rendez-vous et s'en occuper.

## Comment créer vos services

Les services correspondent à ce que vos clients peuvent réserver (une consultation, une coupe, un conseil…).

1. Allez dans **Rendez-vous** → onglet **Services**.
2. Cliquez sur **Nouveau service**.
3. Renseignez le **Nom du service**, la **Durée** en minutes et, si vous le souhaitez, le **Prix**.
4. Dans **Temps tampon (min)**, vous pouvez laisser un intervalle entre un rendez-vous et le suivant (par exemple, 10 minutes pour préparer l'espace).
5. Choisissez la **Modalité** : **Présentiel**, **En ligne** ou **Hybride**.
   - Si c'est en présentiel, indiquez l'**Adresse**.
   - Si c'est en ligne ou hybride, vous pouvez laisser le champ **Lien de réunion** vide : un lien Meet ou Teams est généré automatiquement pour chaque rendez-vous.
6. Enregistrez avec **Créer service**. Vous pouvez activer ou désactiver des services à tout moment.

Le nombre de services que vous pouvez créer dépend de votre plan : Emprendedor 1, Starter 2, et à partir de Pro sans limite.

## Comment définir votre disponibilité

1. Allez dans **Rendez-vous** → onglet **Configuration** → section **Horaires d'ouverture**.
2. Choisissez **Disponible 24/7** ou **Horaire personnalisé** et cochez, jour par jour, les heures pendant lesquelles vous êtes disponible.
3. Enregistrez les modifications. Important : si vous n'enregistrez pas vos horaires, l'agent IA n'aura aucune disponibilité réelle à proposer dans les conversations.

### Dates bloquées (vacances, jours fériés)

Dans le même onglet **Configuration**, section **Dates bloquées** :

1. Cliquez sur **Bloquer une date**.
2. Choisissez le jour et indiquez la raison (par exemple, « Jour férié »).

L'agent IA ne proposera jamais de créneaux sur un jour bloqué, et ceux-ci ne seront pas non plus disponibles sur la page publique de réservation.

## Comment connecter Google Calendar ou Outlook

Connecter votre calendrier évite les conflits d'horaires : les rendez-vous de Parallly apparaissent dans votre calendrier personnel, et ainsi toute votre équipe a l'agenda à jour.

1. Allez dans **Rendez-vous** → onglet **Configuration** → section **Calendriers connectés**.
2. Cliquez sur **Connecter Google Calendar** ou **Connecter Outlook**.
3. Autorisez l'accès avec votre compte Google ou Microsoft.
4. C'est fait : les nouveaux rendez-vous se créent aussi automatiquement dans votre calendrier externe.

Le nombre de calendriers que vous pouvez connecter dépend de votre plan :

| Plan | Calendriers connectés |
|------|------------------------|
| Emprendedor | 1 |
| Starter | 1 |
| Pro | 3 |
| Enterprise | 10 |
| Custom | Sans limite |

### Avec plusieurs calendriers, où va chaque rendez-vous ?

À chaque calendrier connecté, vous attribuez une étiquette : **Général**, **Membre de l'équipe** ou **Service**. Lorsqu'un rendez-vous est créé, il est envoyé selon cet ordre :

1. Le calendrier associé au **service** du rendez-vous.
2. À défaut, le calendrier du **membre de l'équipe** assigné.
3. Sinon, le calendrier **général** de l'entreprise.

### Déconnecter un calendrier qui contient des rendez-vous à venir

Si vous essayez de déconnecter un calendrier comportant des rendez-vous en attente, le panneau vous propose deux options : **Réassigner les rendez-vous à un autre calendrier** (vous choisissez la destination, les rendez-vous sont déplacés et la déconnexion n'a lieu qu'ensuite) ou **Annuler tous les rendez-vous et déconnecter**. Ainsi, aucune réservation ne reste en suspens sans que vous en décidiez.

## Liens de réunion automatiques

Pour les services en modalité **En ligne** ou **Hybride**, chaque rendez-vous génère automatiquement son lien de visioconférence (Meet avec Google Calendar, Teams avec Outlook). Le client le reçoit dans sa confirmation, sans que vous ayez à créer la réunion à la main. Si vous préférez utiliser votre propre lien fixe, collez-le dans le champ **Lien de réunion** du service.

## Rappels et confirmation de présence

Dans **Rendez-vous** → **Configuration** → section **Rappels et suivi**, vous pouvez activer :

- **Rappel 24 heures avant** — envoyé la veille du rendez-vous.
- **Rappel 2 heures avant** — un dernier avis le jour même.
- **Confirmation de présence** — après le rendez-vous, on demande au client s'il s'est présenté.
- **Compléter automatiquement** — les rendez-vous sont marqués comme terminés 2 heures après leur heure de fin, sans travail manuel.

Les rappels par WhatsApp utilisent des modèles de notification approuvés par Meta, ils arrivent donc toujours, même si le client n'a pas écrit depuis plus de 24 heures.

## L'IA prend les rendez-vous seule dans la conversation

Lorsqu'un client demande un rendez-vous par WhatsApp, Instagram ou n'importe quel canal connecté, l'agent IA le guide étape par étape : d'abord le service, puis une date avec disponibilité réelle, ensuite l'heure, et enfin une confirmation. À cette dernière étape, le système vérifie de nouveau l'horaire, de sorte que deux personnes ne peuvent pas se retrouver avec le même créneau.

Au moment de la confirmation, tout se fait tout seul : le rendez-vous s'inscrit dans votre **Calendrier**, se synchronise avec votre Google Calendar ou Outlook, le client reçoit un e-mail de confirmation, le membre de l'équipe assigné reçoit un avis et, si le service est en ligne, le lien de réunion est inclus.

Sur WhatsApp, vous pouvez également activer les **WhatsApp Flows (Bêta)** depuis l'onglet **Configuration** : au lieu de répondre question par question, le client prend rendez-vous en une seule étape grâce à un formulaire interactif. En cas de problème, l'agent revient automatiquement au flux par texte.

## Page publique de réservation

En plus du chat, vous pouvez disposer d'une page web où vos clients prennent rendez-vous eux-mêmes :

1. Allez dans **Paramètres** (barre latérale) → **Booking public**.
2. Activez l'interrupteur **Activer le booking public**.
3. Copiez votre lien avec le bouton **Copier** (il a la forme `parallly-chat.cloud/book/votre-entreprise`) ou cliquez sur **Afficher le code QR** pour l'imprimer ou le partager.
4. Dans **Personnalisation**, vous pouvez définir le **Message de bienvenue** et la **Couleur de marque** de la page.

Partagez le lien dans votre bio Instagram, votre profil WhatsApp Business, votre signature d'e-mail ou votre site web. Les rendez-vous qui arrivent par ce biais apparaissent dans votre calendrier avec l'origine « Réservation publique », aux côtés de ceux créés par l'Agent IA ou par votre équipe depuis le panneau.

## Questions fréquentes

**Que se passe-t-il si deux personnes veulent le même créneau ?**
Le système vérifie la disponibilité à l'instant exact de la confirmation et rejette la seconde tentative, en proposant un autre horaire. Il n'y a pas de double réservation.

**Puis-je reprogrammer ou annuler un rendez-vous ?**
Oui. Dans l'onglet **Calendrier**, vous pouvez reprogrammer en faisant glisser le rendez-vous vers un autre créneau, ou l'ouvrir pour le modifier ou l'annuler en indiquant le motif.

**Puis-je créer des rendez-vous récurrents ?**
Oui. Lors de la création d'un rendez-vous depuis le panneau, cochez **Répéter ce rendez-vous** et choisissez la fréquence (chaque jour, chaque semaine, toutes les 2 semaines ou chaque mois) ainsi que le nombre de répétitions. Toute la série est créée en une seule fois.

**Dois-je connecter un calendrier pour utiliser l'agenda ?**
Non, l'agenda fonctionne seul au sein de Parallly. Connecter Google Calendar ou Outlook est facultatif, mais fortement recommandé si votre équipe planifie aussi des choses en dehors de la plateforme.

**Qui peut modifier la configuration de l'agenda ?**
Les administrateurs et les superviseurs. Les agents peuvent consulter le calendrier, créer des rendez-vous et s'occuper des clients, mais pas modifier les services, les horaires ni les calendriers connectés.

Besoin d'aide supplémentaire ? Écrivez-nous sur https://parallly-chat.cloud/support
