---
id: canales-email-widget
title: "Canal Email et widget de chat pour votre site web"
routes: ["/admin/channels", "/admin/channels/email", "/admin/settings/integrations/web-chat", "/admin/settings/integrations/web-chat/triggers"]
roles: ["tenant_admin"]
keywords: ["email", "e-mail", "canal email", "connecter email", "smtp", "sendgrid", "gmail", "outlook", "widget", "chat web", "chat sur mon site", "chat sur ma page", "bulle de chat", "code d'integration", "installer widget", "declencheurs", "declencheurs proactifs", "message de bienvenue", "formulaire pre-chat"]
---

En plus de WhatsApp et des réseaux sociaux, votre entreprise peut servir ses clients par **Email** (les e-mails arrivent dans votre boîte de réception comme n'importe quelle conversation) et via un **widget de chat web** que vous installez sur votre propre site pour que les visiteurs échangent avec votre assistant IA sans quitter la page. Voici comment configurer les deux.

> Seul le rôle **administrateur** peut connecter le canal Email et configurer le widget de chat web.

## Disponibilité selon votre plan

| Plan | Canal Email | Widget de chat web | Déclencheurs proactifs du widget |
|------|----------------|--------------------|--------------------------------|
| Emprendedor | Non inclus | Non inclus | — |
| Starter | Oui | Oui | Jusqu'à 3 |
| Pro | Oui | Oui | Jusqu'à 10 |
| Enterprise | Oui | Oui | Illimités |
| Custom | Oui | Oui | Illimités |

Si votre plan n'inclut pas l'un des deux, vous pouvez passer à un plan supérieur dans **Paramètres** → **Facturation**.

---

## Comment connecter le canal Email

1. Dans la barre latérale, ouvrez **Canaux** et cliquez sur la carte **Email**.
2. Dans **Configuration de l'expéditeur**, renseignez :
   - **E-mail d'envoi** : l'adresse depuis laquelle partiront vos e-mails (ex. `ventas@tuempresa.com`).
   - **Nom de l'expéditeur** : le nom que verront vos clients (ex. « Équipe Commerciale — MonEntreprise »).
   - **Répondre à** : adresse facultative où arrivent les réponses, si vous souhaitez qu'elle diffère de l'adresse d'envoi.
3. Choisissez le **Fournisseur** d'envoi :
   - **SMTP** : fonctionne avec n'importe quel service de messagerie (Gmail, Outlook, votre hébergeur). Renseignez **Hôte**, **Port**, **Utilisateur**, **Mot de passe** et **Chiffrement**. Recommandé : TLS sur le port 587.
   - **SendGrid** : si votre entreprise gère un volume élevé d'e-mails, collez votre **API Key SendGrid**.
4. Activez l'interrupteur **Canal actif**.
5. Cliquez sur **Enregistrer la configuration**. Parallly envoie un e-mail de test pour vérifier que tout est en ordre.

C'est fait : les e-mails reçus à cette adresse apparaîtront comme des conversations dans votre boîte de réception, aux côtés de WhatsApp, Instagram et de vos autres canaux.

> **Si vous utilisez Gmail ou Outlook avec la validation en deux étapes** : n'utilisez pas votre mot de passe habituel. Créez un « Mot de passe d'application » de 16 caractères depuis les paramètres de sécurité de votre compte de messagerie et utilisez-le dans le champ **Mot de passe**.

### Réception des e-mails avec SendGrid

Si vous avez choisi SendGrid, la page affiche une adresse de réception avec le bouton **Copier l'URL du Webhook**. Copiez-la et collez-la dans votre compte SendGrid (dans Settings → Inbound Parse) afin que les e-mails entrants arrivent dans votre boîte Parallly. C'est une étape à faire une seule fois.

### Comment fonctionne l'e-mail dans votre boîte de réception

- Chaque e-mail reçu crée une nouvelle conversation, ou rejoint une conversation existante si le contact est déjà enregistré.
- Votre assistant IA peut répondre aux e-mails de la même façon qu'il répond aux messages WhatsApp ou Instagram.
- Les réponses partent comme un e-mail classique depuis l'adresse que vous avez configurée.
- Vous verrez l'objet, le corps et les pièces jointes de chaque e-mail dans la conversation.

### Attribuer un assistant IA au canal Email

Rappelez-vous la règle générale : **un assistant IA par connexion**. Dans l'éditeur de votre assistant (section **Agent IA**), reliez la connexion Email pour qu'il réponde aux e-mails entrants. Si vous préférez que seule votre équipe humaine réponde aux e-mails, il vous suffit de ne pas lui attribuer d'assistant.

---

## Comment installer le widget de chat sur votre site web

1. Dans la barre latérale, ouvrez **Paramètres** → section **Intégrations** → **Chat web**.
2. Cliquez sur **Créer un widget**. Votre widget est créé avec la configuration initiale.
3. Sur la carte du widget, vous verrez le **Code d'intégration**. Cliquez sur le bouton **Copier le code**.
4. Collez ce code sur votre site web, idéalement juste avant la fermeture de la page (si une autre personne gère votre site, envoyez-lui le code tel quel : elle saura où le placer). Cela fonctionne sur n'importe quel site : WordPress, Shopify, Wix, pages sur mesure, etc.
5. Enregistrez les modifications sur votre site et rechargez la page : la bulle de chat apparaîtra dans le coin que vous avez choisi.

Les visiteurs qui écrivent via le widget apparaissent comme des conversations dans votre boîte de réception, et votre assistant IA s'en occupe automatiquement.

### Comment personnaliser le widget

Sur la même page, cliquez sur l'icône **Configurer** (engrenage) de votre widget et ajustez :

| Option | Ce qu'elle contrôle |
|--------|--------------|
| **Nom du widget** | Nom interne pour l'identifier (vos visiteurs ne le voient pas) |
| **Nom de l'assistant** | Le nom que voit le visiteur dans la fenêtre de chat |
| **Couleur principale** | La couleur de la bulle et de l'en-tête du chat, en harmonie avec votre marque |
| **Position** | **En bas à droite** ou **En bas à gauche** de l'écran |
| **Message de bienvenue** | Le premier message que voit le visiteur en ouvrant le chat |
| **Formulaire pré-chat** | S'il est actif, le visiteur laisse ses coordonnées (nom, contact) avant de discuter |

Une fois terminé, cliquez sur **Enregistrer**. Les modifications s'appliquent sur votre site sans retoucher le code.

> Les champs demandés dans le formulaire pré-chat se définissent dans **Paramètres** → **Formulaire pré-chat**. Demander le téléphone ou l'e-mail vous permet de reconnaître le visiteur s'il vous écrit ensuite via WhatsApp ou un autre canal.

---

## Comment créer des déclencheurs proactifs (pour que le chat engage la conversation)

Les déclencheurs font que le widget s'active de lui-même selon le comportement du visiteur, sans attendre un clic. Bien utilisés, ils augmentent nettement le nombre de conversations engagées.

1. Ouvrez **Paramètres** → **Chat web** et cliquez sur le bouton **Déclencheurs proactifs**.
2. Cliquez sur **Nouveau déclencheur** et donnez-lui un **Nom** (ex. « Offre d'aide sur la page tarifs »).
3. Dans **Conditions**, cliquez sur **Ajouter une condition** et choisissez quand il se déclenche :

| Condition | Se déclenche lorsque… |
|-----------|--------------------|
| **Temps sur la page** | Le visiteur est sur la page depuis X secondes |
| **Défilement (%)** | Il a fait défiler plus d'un certain pourcentage de la page |
| **Intention de sortie** | Il déplace le curseur pour fermer l'onglet |
| **URL de la page** | Il se trouve sur une page précise (ex. `/precios`) |
| **Nombre de visites** | Il a visité votre site N fois ou plus |

4. Si vous ajoutez plusieurs conditions, choisissez l'**Opérateur** : **Toutes doivent être remplies (AND)** ou **Au moins une (OR)**.
5. Choisissez le **Type d'action** : **Ouvrir le widget** (le chat s'ouvre tout seul), **Afficher la bulle** (un petit message apparaît à côté de l'icône) ou **Afficher la bannière** (bandeau avec message et bouton).
6. Rédigez le **Message** que verra le visiteur et, si vous le souhaitez, ajustez la **Fréquence (min)** (0 = affiché une seule fois par visite).
7. Cliquez sur **Enregistrer**. Le déclencheur est **Actif** immédiatement.

**Exemples qui fonctionnent bien :**

- Page tarifs + 15 secondes → bulle : « Des questions sur nos plans ? Je vous aide à choisir. »
- Intention de sortie au moment du paiement → ouvrir le widget : « Attendez ! Puis-je vous aider à finaliser votre achat ? »
- 3ᵉ visite → bannière : « Bon retour parmi nous — réservez une démo gratuite. »

> **Conseil** : un ou deux déclencheurs bien placés convertissent mieux que de solliciter le visiteur sur chaque page. Si vous voyez l'avis « Vous avez atteint la limite de déclencheurs de votre plan », désactivez-en un ou passez à un plan supérieur.

---

## Questions fréquentes

**Le canal Email remplace-t-il ma messagerie habituelle ?**
Non. Votre boîte mail continue de fonctionner normalement ; Parallly se connecte à votre service de messagerie pour envoyer les réponses et rapatrier les e-mails entrants dans votre boîte de conversations. Rien n'est supprimé de votre compte de messagerie.

**J'ai enregistré la configuration Email mais aucun e-mail n'arrive dans la boîte de réception.**
Vérifiez que l'interrupteur **Canal actif** est allumé et que l'e-mail de test est bien arrivé. Si vous utilisez Gmail/Outlook avec la validation en deux étapes, assurez-vous d'utiliser un mot de passe d'application. Si vous utilisez SendGrid, confirmez que vous avez bien collé l'URL de réception dans votre compte SendGrid.

**Puis-je avoir le widget sur plusieurs sites web ?**
Vous pouvez créer plusieurs widgets via **Créer un widget**, et chacun dispose de son propre code d'intégration et de sa propre personnalisation.

**Comment retirer le chat de mon site ?**
Sur la carte du widget, cliquez sur **Supprimer** et confirmez : les visiteurs ne pourront plus discuter, même si le code reste sur votre page. Si vous préférez conserver le widget et sa configuration, demandez à la personne qui gère votre site de retirer le code de la page.

**Que deviennent les chats du widget quand mon entreprise est fermée ?**
Votre assistant IA répond 24 h/24 et 7 j/7. Si le visiteur demande à parler à une personne en dehors des horaires, ce sont vos **Horaires d'ouverture** et le message hors horaires que vous avez configuré qui s'appliquent.

**Faut-il savoir programmer pour installer le widget ?**
Non. Il suffit de copier le code avec **Copier le code** et de le coller sur votre site (ou de l'envoyer à la personne qui le gère). C'est une étape à faire une seule fois.

Encore des questions ? Écrivez-nous sur https://parallly-chat.cloud/support
