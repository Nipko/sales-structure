---
id: inbox
title: "Boîte de réception et prise en charge humaine"
routes: ["/admin/inbox", "/admin/settings/macros", "/admin/settings/integrations/sms-notifications"]
roles: ["tenant_admin", "tenant_supervisor", "tenant_agent"]
keywords: ["boîte de réception", "inbox", "transfert", "handoff", "prendre la conversation", "prendre en charge un client", "agent humain", "rendre au bot", "notes internes", "macros", "réponses rapides", "reporter", "snooze", "assigner une conversation", "résoudre une conversation", "copilote", "résumé IA", "reformuler un message", "suggestion IA", "notifications", "cloche", "escalade"]
---

# Boîte de réception et prise en charge humaine

L'**Inbox** est l'endroit où votre équipe voit toutes les conversations en temps réel et où une personne peut reprendre la main lorsque l'IA a besoin d'aide. Vous le trouvez dans la barre latérale, dans la section **Opération → Inbox**.

L'écran comporte trois zones : à gauche la liste des conversations (avec des filtres comme **Tous**, **Les miens**, **Non assignés**, **Transfert** et **Résolues**, ainsi que des filtres par canal), au centre le fil de messages et à droite le panneau du contact avec ses informations, ses notes et ses rendez-vous. C'est ici qu'arrivent les conversations de tous vos canaux connectés : WhatsApp, Instagram, Messenger, Telegram, Email et le chat de votre site web.

## Comment prendre une conversation (transfert)

Lorsqu'un client demande à parler à une personne, ou que l'IA détecte qu'elle ne peut pas résoudre le cas, la conversation passe en « attente d'agent » et l'IA se met en pause.

1. Ouvrez la conversation depuis l'Inbox (celles qui attendent une prise en charge ressortent dans la liste).
2. Vous verrez un avis orange : **Intervention humaine requise** — « L'assistant IA a été mis en pause. Le client attend une réponse humaine. »
3. Cliquez sur **Prendre la conversation**. La conversation vous est assignée et vous pouvez désormais écrire directement au client.

Vous pouvez aussi prendre n'importe quelle conversation à tout moment avec le bouton **M'attribuer** dans l'en-tête du chat, même sans qu'il y ait eu de demande d'aide. Tant que la conversation est avec vous, l'IA ne répond pas : le client échange uniquement avec vous.

## Le résumé IA au moment de prendre une conversation

Pour vous éviter de lire tout l'historique, à l'ouverture d'une conversation escaladée vous verrez un encadré avec le **Résumé de la conversation (IA)** : ce que le client a demandé, ce qui a été échangé et pourquoi la conversation a été escaladée.

De plus, à tout moment vous pouvez appuyer sur **Résumer** (au-dessus de la zone de saisie) et le copilote vous affiche un résumé instantané, avec l'**Intention du client** et les sujets **En attente** à résoudre.

## Comment rendre la conversation à l'IA

Une fois le cas résolu :

1. Cliquez sur **Résoudre** dans l'en-tête de la conversation.
2. Votre prise en charge se termine, la conversation est libérée et l'assistant IA reprend la gestion des prochains messages de ce client.

Les conversations sans activité pendant 72 heures sont marquées comme résolues automatiquement afin de garder votre boîte propre. Vous pouvez les retrouver avec le filtre **Résolues** ; là, l'historique est en lecture seule, et si vous devez la reprendre, utilisez **Rouvrir la conversation**.

## Copilote de l'agent : suggestions et reformulation

Le copilote vous aide à répondre mieux et plus vite :

- **Suggestion IA** : dans les conversations que vous prenez en charge, le copilote propose une réponse prête à l'emploi. Appuyez sur **Utiliser la suggestion** pour la placer dans la zone de saisie (vous pouvez la modifier avant l'envoi) ou sur **Régénérer** pour en demander une autre.
- **Brouillon IA** : parfois l'IA prépare un brouillon en attente de votre validation. Relisez-le et choisissez **Utiliser le brouillon** ou **Ignorer**. Rien n'est envoyé sans votre confirmation.
- **Reformuler** : écrivez votre réponse comme elle vient et laissez le copilote la peaufiner. À côté de la zone de saisie, appuyez sur **Reformuler** et choisissez le ton : **Professionnel**, **Amical**, **Empathique**, **Plus court**, **Développer** ou **Corriger la grammaire**.

## Réponses rapides et macros

- **Réponses rapides** : dans la zone de message, tapez **/** et la liste des réponses prédéfinies de votre équipe apparaît. Continuez à taper pour filtrer et sélectionnez-en une ; les données du client (comme son nom) se remplissent toutes seules.
- **Macros** : ce sont des séquences d'actions qui s'exécutent en un clic (par exemple : étiqueter, assigner, laisser une note et envoyer une réponse, le tout ensemble). Dans la conversation, ouvrez le menu d'actions (⋯) et choisissez **Macros**.

Pour créer des macros, un administrateur ou un superviseur se rend dans **Configuration → Macros** et appuie sur **Nouvelle macro**. Chaque macro combine des actions comme **Assigner à un agent**, **Ajouter une étiquette**, **Changer le statut**, **Ajouter une note** ou **Envoyer une réponse prédéfinie**, et peut avoir une visibilité **Personnelle** (uniquement la vôtre) ou d'**Équipe**.

## Notes internes

Les notes internes sont des commentaires entre collègues que le client ne voit jamais.

1. Dans la conversation, ouvrez le menu d'actions (⋯) et choisissez **Notes internes**.
2. Écrivez dans le champ **Ajouter une note interne...** et enregistrez.
3. La note reste visible pour toute l'équipe dans cette conversation, ainsi que dans l'historique du contact.

Utilisez-les pour laisser du contexte avant de passer le cas à une autre personne (« client VIP, la remise de 10 % lui a déjà été proposée »).

## Reporter une conversation (snooze)

Si un cas ne peut pas avancer maintenant (« rappelez-moi lundi »), ne le laissez pas encombrer votre boîte :

1. Ouvrez le menu d'actions (⋯) et choisissez **Reporter**.
2. Choisissez quand elle doit revenir : **1 heure**, **3 heures**, **Demain 9h** ou **Lundi prochain**.
3. La conversation est masquée de la vue active et réapparaît automatiquement à la date choisie.

## Répartition entre agents

- Chaque conversation peut avoir un responsable. Utilisez le filtre **Les miens** pour ne voir que ce qui vous concerne et **Non assignés** pour trouver les conversations orphelines.
- N'importe quel membre de l'équipe peut prendre une conversation avec **M'attribuer** ; si elle était déjà avec quelqu'un d'autre, un administrateur ou un superviseur peut la réattribuer.
- Si vous configurez des **compétences (skills)** dans les profils de votre équipe (menu **Utilisateurs**), Parallly achemine automatiquement chaque escalade vers la bonne personne — par exemple, les cas en anglais vers l'agent qui parle anglais.
- Les macros peuvent également assigner à un agent précis dans le cadre de leurs actions.
- Si une conversation escaladée reste plus de 5 minutes sans réponse, les superviseurs reçoivent une alerte pour que personne ne reste en attente.

Le nombre de personnes pouvant utiliser Parallly dépend de votre forfait : Emprendedor inclut 1 utilisateur, Starter 3, Pro 5, et Enterprise et Custom n'ont pas de limite.

## Notifications

La **cloche** dans la barre supérieure regroupe les avis et les classe par catégorie : **Messages**, **Transferts** (escalades vers un humain), **Confidentialité**, **Rendez-vous**, **Automatisation**, **Commandes** et **Système**. Les escalades directes (le client a demandé un humain) ressortent en rouge ; les escalades pour faible confiance de l'IA, en jaune ; et les alertes de superviseur arrivent avec un son.

Si votre forfait est Pro ou supérieur, vous pouvez aussi recevoir un SMS lorsque l'IA escalade une conversation : activez-le dans **Configuration → Intégrations → Alertes SMS**.

## Travailler en équipe sans se marcher dessus

Si deux personnes ouvrent la même conversation en même temps, chacune voit une étiquette de couleur avec le nom de l'autre sous l'en-tête. Vous évitez ainsi de répondre en double au même client. Cela fonctionne tout seul, sans rien configurer : l'étiquette disparaît lorsque l'autre personne ferme la conversation.

## Questions fréquentes

**L'IA continue-t-elle de répondre pendant que je prends en charge ?**
Non. Dès que vous prenez la conversation, l'IA est mise en pause et le client échange uniquement avec vous. Elle se réactive lorsque vous appuyez sur **Résoudre**.

**Le client voit-il les notes internes ou les résumés IA ?**
Non. Les notes, les résumés et les suggestions du copilote sont réservés à votre équipe. Le client ne reçoit que ce que vous envoyez depuis la zone de message.

**Que se passe-t-il si personne ne prend une conversation escaladée ?**
Elle continue d'apparaître dans le filtre des conversations en attente et, si plus de 5 minutes s'écoulent sans réponse, les superviseurs reçoivent une alerte sonore pour intervenir.

**Puis-je faire en sorte que certains cas arrivent toujours à la même personne ?**
Oui. Configurez des compétences dans les profils de l'équipe (menu **Utilisateurs**) pour l'acheminement automatique, ou créez une macro avec l'action **Assigner à un agent**.

**Une conversation reportée est-elle perdue si le client écrit avant ?**
Elle n'est pas perdue : la conversation réapparaît automatiquement à la date que vous avez choisie et l'historique complet est conservé.

Besoin d'aide supplémentaire ? Écrivez-nous sur https://parallly-chat.cloud/support
