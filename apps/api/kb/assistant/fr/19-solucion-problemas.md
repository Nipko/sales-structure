---
id: solucion-problemas
title: "Résolution des problèmes fréquents"
routes: ["/admin/channels", "/admin/agent", "/admin/inbox", "/admin/broadcast", "/admin/appointments", "/admin/settings/billing"]
roles: ["tenant_admin", "tenant_supervisor", "tenant_agent"]
keywords: ["problèmes", "ne fonctionne pas", "messages non reçus", "ne répond pas", "le bot ne répond pas", "canal déconnecté", "jeton expiré", "token expiré", "reconnecter", "la campagne n'envoie pas", "modèle refusé", "limite du forfait", "limite atteinte", "rendez-vous n'apparaît pas", "calendrier ne se synchronise pas", "email de vérification", "code non reçu", "erreur", "aide", "support", "contacter le support"]
---

# Résolution des problèmes fréquents

Quelque chose ne fonctionne pas comme prévu ? Ce guide rassemble les problèmes les plus courants et la façon de les résoudre étape par étape. Si rien de tout cela ne règle votre situation, nous vous expliquons à la fin comment écrire au support.

## Les messages d'un canal n'arrivent pas

Si vos clients vous écrivent mais que les messages n'apparaissent pas dans la **Boîte de réception** :

1. Demandez à un administrateur d'ouvrir **Administration → Canaux** et de repérer la carte du canal concerné. Si vous êtes administrateur, faites-le directement.
2. L'administrateur vérifie l'état de la connexion : s'il indique **Déconnecté** ou un jeton expiré, il doit suivre les étapes de la section suivante.
3. S'il existe **plusieurs comptes du même canal**, l'administrateur confirme que le client a écrit au numéro ou au compte connecté : chaque connexion est indépendante.
4. Faites un test vous-même : envoyez un message depuis un autre téléphone ou compte et vérifiez s'il apparaît dans la **Boîte de réception** en quelques secondes.
5. Si le canal apparaît comme **Connecté** et que les messages n'arrivent toujours pas, écrivez-nous au support en indiquant le canal, l'heure approximative et un exemple du message qui n'est pas arrivé.

> **Canaux** est un écran réservé aux administrateurs. Les superviseurs et agents doivent communiquer à un administrateur le canal, l'heure approximative et un exemple ; ils ne peuvent ni consulter ni modifier l'état sur cet écran.

## Canal déconnecté ou jeton expiré : comment se reconnecter

Les autorisations de certains canaux peuvent expirer avec le temps ou devenir invalides si vous changez le mot de passe ou les permissions du compte (par exemple, sur Instagram ou Facebook).

1. Allez dans **Canaux** et ouvrez la carte du canal.
2. Cliquez sur **Reconnecter** (ou **Connecter**, s'il apparaît comme déconnecté).
3. Recommencez la connexion avec le fournisseur (Meta, Google, etc.) et approuvez les permissions.
4. C'est fait : la connexion se réactive et **vos conversations et votre historique restent intacts**.

Détails utiles :

- **Instagram** utilise une autorisation qui dure 60 jours. Parallly la renouvelle automatiquement, mais si le renouvellement échoue (mot de passe ou permissions modifiés), vous recevrez une alerte et verrez l'avertissement de jeton expiré sur la carte : il vous suffit alors d'appuyer sur **Reconnecter**.
- Se reconnecter **n'efface rien** : contacts, conversations et configuration de l'agent restent inchangés.

## L'agent IA ne répond pas (ou répond mal)

Passez cette liste en revue dans l'ordre ; la cause est presque toujours l'une des suivantes :

1. **La connexion a-t-elle un agent assigné ?** Ouvrez **Agent IA**. Si vous voyez un avertissement du type « canaux sans agent assigné », ces connexions sont prises en charge par votre agent par défaut avec une configuration générique. Ouvrez le bon agent et, dans **Affectation des connexions**, cochez le compte exact qui doit les prendre en charge. Rappel : il y a **un agent IA par connexion**.
2. **L'agent est-il actif ?** Dans la liste des agents, vérifiez qu'il n'est pas **en pause**.
3. **Est-il dans ses horaires ?** Dans l'éditeur de l'agent, consultez la carte **Horaire** : en dehors de cette plage, l'agent ne répond pas automatiquement.
4. **Le mode de réponse est-il le bon ?** Dans **Comportement**, si le mode est réglé sur « toujours humain », l'IA ne répond jamais seule. Passez-le à « toujours IA » ou « hybride » selon vos besoins.
5. **La conversation est-elle prise en charge par un humain ?** Si vous ou un membre de l'équipe avez pris la conversation dans la **Boîte de réception** (ou si le client a demandé à parler à une personne), l'IA reste en pause sur cette conversation jusqu'à ce que l'on appuie sur **Résoudre**. C'est le comportement attendu, pas une panne.
6. **La capacité de messages IA est-elle épuisée ?** Ouvrez **Forfait et facturation** et consultez la barre d'utilisation et les options actuelles.

Si l'agent **répond, mais répond mal** (invente des données, ne connaît pas vos prix ou sort du sujet) :

- Alimentez la **Base de connaissances** : l'agent répond avec ce que vous lui enseignez. Ajoutez ou corrigez des articles et des questions fréquentes avec les informations officielles de votre entreprise.
- Ajustez les **règles** et les **sujets interdits** dans la carte **Comportement** de l'éditeur de l'agent.
- Testez vos changements sans affecter de vrais clients dans **Agent IA → Tester l'agent** : c'est un simulateur où vous discutez avec votre propre agent.

## Je n'arrive pas à envoyer une campagne

Le lancement depuis l'éditeur actuel n'est pas certifié pour la production : il reste à associer de façon sûre l'identifiant et les composants du modèle approuvé à l'émetteur, et à ajouter une action d'annulation pour les campagnes programmées. Utilisez **Campagnes** uniquement pour préparer des brouillons et des audiences et consulter les métriques existantes. Ne cliquez pas sur **Envoyer maintenant** et ne programmez pas de campagne réelle ; coordonnez un test contrôlé avec le [support](https://parallly-chat.cloud/support).

## J'ai atteint la limite de mon forfait

Lorsqu'une ressource atteint son plafond (agents, contacts, campagnes, messages IA, etc.), la plateforme vous avertit par un message du type « Vous avez atteint la limite de votre forfait actuel » et vous ne pourrez plus créer davantage de cette ressource.

- **Forfait et facturation** affiche les barres d'utilisation et vous avertit lorsque vous approchez de la capacité.
- L'écran confirme quand un changement et tout prélèvement s'appliqueront avant votre acceptation.
- Chaque compteur affiche sa période et son prochain renouvellement.
- Vous pouvez aussi libérer de l'espace (par exemple, supprimer un agent ou des contacts que vous n'utilisez pas) au lieu de changer de forfait.

## Le rendez-vous n'apparaît pas dans mon calendrier

1. Confirmez d'abord que le rendez-vous existe dans Parallly : ouvrez **Agenda** et cherchez-le dans l'onglet **Calendrier**. S'il ne s'y trouve pas, la réservation n'a pas été finalisée (le client n'a peut-être pas confirmé la dernière étape).
2. Si le rendez-vous est dans Parallly mais pas dans votre Google Calendar ou Outlook, allez dans **Agenda → Paramètres → Calendriers connectés** et vérifiez que votre calendrier est toujours **connecté**. Si la connexion a expiré, appuyez sur **Reconnecter**.
3. Si vous avez **plusieurs calendriers connectés**, le rendez-vous a pu se synchroniser sur un autre : chaque rendez-vous va d'abord au calendrier assigné au **service**, sinon à celui du **professionnel** assigné, et à défaut au calendrier **général** de l'entreprise. Vérifiez ces affectations dans l'édition du service.
4. La synchronisation est rapide mais pas toujours instantanée : attendez deux minutes et actualisez votre calendrier.

## Je ne reçois pas l'email de vérification

Lors de votre inscription (ou de la récupération de votre mot de passe), Parallly vous envoie un **code à 6 chiffres** par email. S'il n'arrive pas :

1. Vérifiez le dossier **spam ou courrier indésirable**, et cherchez « Parallly » dans votre boîte.
2. Attendez 2 ou 3 minutes : certains fournisseurs de messagerie retardent la livraison.
3. Vérifiez que vous avez bien saisi votre adresse email et demandez un **nouveau code** depuis le même écran.
4. Si vous utilisez un email professionnel, il est possible qu'un filtre d'entreprise le bloque ; essayez avec une autre adresse ou demandez à votre équipe informatique de l'autoriser.
5. Si rien ne fonctionne, écrivez-nous au support en indiquant l'adresse avec laquelle vous essayez de vous inscrire.

## Comment contacter le support

Si vous avez suivi les étapes et que le problème persiste :

- Écrivez-nous sur [parallly-chat.cloud/support](https://parallly-chat.cloud/support).
- Vous pouvez aussi poser votre question au **copilote** à l'intérieur du panneau : de nombreux doutes se résolvent instantanément.

Pour vous aider plus vite, indiquez : ce que vous essayiez de faire, sur quel canal ou quelle page cela s'est produit, l'heure approximative et, si possible, une capture d'écran de l'erreur.

## Questions fréquentes

**Reconnecter un canal efface-t-il mes conversations ou mes contacts ?**
Non. Se reconnecter ne fait que renouveler l'autorisation avec le fournisseur ; tout votre historique est conservé.

**Pourquoi l'IA a-t-elle cessé de répondre uniquement sur une conversation ?**
Parce que cette conversation est assignée à une personne de votre équipe. Tant qu'elle est prise en charge, l'IA se met en pause ; elle recommence à répondre lorsqu'on appuie sur **Résoudre** dans la Boîte de réception.

**Qui peut reconnecter des canaux ou modifier la configuration de l'agent ?**
Seul le rôle **administrateur**. Si vous êtes superviseur ou agent et que vous détectez le problème, prévenez votre administrateur.

**Quand les limites de mon compte se réinitialisent-elles ?**
Chaque barre d'utilisation affiche sa période et son prochain renouvellement dans **Forfait et facturation**.

**Combien de temps Meta met-il à approuver un modèle WhatsApp ?**
Meta ne garantit aucun délai. L'état (En attente, Approuvé ou Refusé) se voit dans **Canaux → WhatsApp**.
