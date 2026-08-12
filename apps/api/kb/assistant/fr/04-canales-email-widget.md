---
id: canales-email-widget
title: "Chat web et état de l'intégration Email"
routes: ["/admin/channels", "/admin/channels/email", "/admin/settings/integrations/web-chat", "/admin/settings/integrations/web-chat/triggers"]
roles: ["tenant_admin"]
keywords: ["email", "e-mail", "etat du canal email", "widget", "chat web", "chat sur mon site", "chat sur ma page", "bulle de chat", "code d'integration", "installer widget", "declencheurs", "declencheurs proactifs", "message de bienvenue", "formulaire pre-chat"]
---

# Chat web et état de l'intégration Email

Le **widget de chat web** est une surface conversationnelle opérationnelle que vous installez sur votre site afin que les visiteurs échangent avec votre assistant IA sans quitter la page.

> Seul le rôle **administrateur** peut configurer le widget de chat web.

## Disponibilité

L'écran indique si le chat web et les déclencheurs proactifs sont activés et quelle capacité reste disponible. Consultez les détails actuels dans **Forfait et facturation**.

### État de l'intégration Email

Email existe comme adaptateur technique et point d'entrée interne pour des intégrations administrées, mais **ce n'est pas encore un canal conversationnel certifié ni configurable en libre-service**. La page **Canaux → Email** ne dispose actuellement pas du contrat d'API nécessaire pour enregistrer une configuration par tenant. Ne saisissez pas d'identifiants et ne considérez pas que cet écran rend le canal opérationnel.

Si votre organisation a besoin d'une intégration e-mail, demandez une évaluation technique au support. Tant que le flux n'est pas implémenté et certifié de bout en bout, Parallly Assist ne doit promettre ni connexion, ni envoi, ni réception dans la boîte de conversations, ni réponses automatiques par Email.

---

## Comment installer le widget de chat sur votre site web

1. Ouvrez **Paramètres → Canaux et intégrations → Chat web**.
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

## Comment enregistrer des définitions de déclencheurs (sans exécution publique pour l'instant)

L'écran permet d'enregistrer des définitions de déclencheurs selon le comportement du visiteur. **Dans la version actuelle, le script public du widget n'évalue ni n'exécute encore ces définitions** : ne comptez donc pas sur des ouvertures, bulles ou bannières proactives en production. Le chat ouvert par le visiteur fonctionne bien.

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
7. Cliquez sur **Enregistrer**. La définition est stockée, mais elle n'est pas encore exécutée sur le site public.

**Exemples de configurations que l'éditeur permet de préparer (pas encore exécutées) :**

- Page tarifs + 15 secondes → bulle : « Des questions sur nos plans ? Je vous aide à choisir. »
- Intention de sortie au moment du paiement → ouvrir le widget : « Attendez ! Puis-je vous aider à finaliser votre achat ? »
- 3ᵉ visite → bannière : « Bon retour parmi nous — réservez une démo gratuite. »

> Ne publiez pas de stratégie dépendant de ces déclencheurs tant que le chargeur public ne les indique pas comme disponibles. L'écran peut afficher la capacité du forfait alors que l'exécuteur du navigateur reste en attente.

---

## Questions fréquentes

**Puis-je avoir le widget sur plusieurs sites web ?**
Vous pouvez créer plusieurs widgets via **Créer un widget**, et chacun dispose de son propre code d'intégration et de sa propre personnalisation.

**Comment retirer le chat de mon site ?**
Sur la carte du widget, cliquez sur **Supprimer** et confirmez : les visiteurs ne pourront plus discuter, même si le code reste sur votre page. Si vous préférez conserver le widget et sa configuration, demandez à la personne qui gère votre site de retirer le code de la page.

**Que deviennent les chats du widget quand mon entreprise est fermée ?**
Votre assistant IA répond 24 h/24 et 7 j/7. Si le visiteur demande à parler à une personne en dehors des horaires, ce sont vos **Horaires d'ouverture** et le message hors horaires que vous avez configuré qui s'appliquent.

**Faut-il savoir programmer pour installer le widget ?**
Non. Il suffit de copier le code avec **Copier le code** et de le coller sur votre site (ou de l'envoyer à la personne qui le gère). C'est une étape à faire une seule fois.

Encore des questions ? Écrivez-nous sur https://parallly-chat.cloud/support
