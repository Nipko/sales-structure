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

1. Ouvrez **Canaux** dans la barre latérale et repérez la carte du canal concerné.
2. Vérifiez l'état de la connexion : s'il indique **Déconnecté** ou si vous voyez un avertissement du type « **Token expiré. Veuillez reconnecter votre compte** », c'est la cause du problème. Suivez les étapes de la section suivante pour vous reconnecter.
3. Si vous avez **plusieurs comptes du même canal** (par exemple, deux numéros WhatsApp), confirmez que le client a écrit au numéro ou au compte qui est connecté : chaque connexion est indépendante.
4. Faites un test vous-même : envoyez un message depuis un autre téléphone ou compte et vérifiez s'il apparaît dans la **Boîte de réception** en quelques secondes.
5. Si le canal apparaît comme **Connecté** et que les messages n'arrivent toujours pas, écrivez-nous au support en indiquant le canal, l'heure approximative et un exemple du message qui n'est pas arrivé.

> Seul le rôle **administrateur** peut connecter, reconnecter ou déconnecter des canaux. Les superviseurs et les agents voient l'état, mais ne peuvent pas le modifier.

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
6. **Les messages IA du mois sont-ils épuisés ?** Ouvrez **Paramètres → Facturation** et regardez la barre d'utilisation des messages IA. Chaque forfait inclut une quantité mensuelle (par exemple, Emprendedor 1 000 et Starter 5 000) ; si elle est épuisée, améliorez votre forfait ou attendez la réinitialisation du mois.

Si l'agent **répond, mais répond mal** (invente des données, ne connaît pas vos prix ou sort du sujet) :

- Alimentez la **Base de connaissances** : l'agent répond avec ce que vous lui enseignez. Ajoutez ou corrigez des articles et des questions fréquentes avec les informations officielles de votre entreprise.
- Ajustez les **règles** et les **sujets interdits** dans la carte **Comportement** de l'éditeur de l'agent.
- Testez vos changements sans affecter de vrais clients dans **Agent IA → Tester l'agent** : c'est un simulateur où vous discutez avec votre propre agent.

## Je n'arrive pas à envoyer une campagne

Les causes les plus fréquentes lors de la création ou de l'envoi d'une campagne dans **Campagnes** :

- **Votre forfait n'inclut pas les campagnes ou vous avez atteint le plafond du mois.** Emprendedor n'inclut pas de campagnes ; Starter en inclut 3 par mois ; Pro, Enterprise et Custom les ont illimitées. Si vous avez atteint le plafond, vous verrez l'avertissement de limite avec l'option **Mettre à niveau le forfait**.
- **Le modèle WhatsApp n'est pas approuvé.** Pour écrire à des clients qui ne vous ont pas parlé au cours des dernières 24 heures, WhatsApp exige un modèle vérifié et approuvé par Meta. Vérifiez l'état dans **Canaux → WhatsApp → Voir tous les modèles** : il doit apparaître comme **Approuvé** (la révision de Meta prend généralement de quelques minutes à 72 heures). S'il a été **Refusé**, vous en verrez la raison ; corrigez le texte et renvoyez-le.
- **Certains destinataires ne reçoivent rien.** Il est normal que quelques envois échouent : contacts qui se sont désabonnés (on ne leur envoie plus de diffusions) ou numéros qui n'existent plus. Vous le voyez dans les métriques de la campagne.
- **Plusieurs numéros connectés** : vérifiez que vous avez choisi le bon **numéro émetteur** lors de la création de la campagne.

## J'ai atteint la limite de mon forfait

Lorsqu'une ressource atteint son plafond (agents, contacts, campagnes, messages IA, etc.), la plateforme vous avertit par un message du type « Vous avez atteint la limite de votre forfait actuel » et vous ne pourrez plus créer davantage de cette ressource.

- Dans **Paramètres → Facturation**, vous voyez les barres d'utilisation : avertissement ambre à **80 %** et alerte rouge à **95 %** avec le bouton **Mettre à niveau le forfait**.
- Le passage à un forfait supérieur s'applique **immédiatement** : vous payez le nouveau forfait et les limites s'étendent aussitôt.
- Les compteurs mensuels (messages IA, campagnes, multimédia) **se réinitialisent le premier jour de chaque mois**.
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

**Quand les limites mensuelles de mon forfait se réinitialisent-elles ?**
Le premier jour de chaque mois. Les limites fixes (agents, contacts, calendriers) ne changent qu'en changeant de forfait.

**Combien de temps Meta met-il à approuver un modèle WhatsApp ?**
Normalement de quelques minutes à 72 heures. L'état (En attente, Approuvé ou Refusé) se voit dans **Canaux → WhatsApp**.
