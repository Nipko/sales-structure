---
id: canales-whatsapp
title: "Connecter WhatsApp"
routes: ["/admin/channels", "/admin/channels/whatsapp", "/admin/channels/whatsapp/templates"]
roles: ["tenant_admin"]
keywords: ["whatsapp", "connecter whatsapp", "numero whatsapp", "whatsapp business", "coexistence", "application whatsapp", "migrer numero", "modeles", "templates", "modele whatsapp", "synchroniser conversations", "historique des conversations", "code qr", "verification", "meta", "facebook", "deconnecter whatsapp", "fenetre de 24 heures", "plusieurs comptes", "deuxieme numero", "nouvelle autorisation", "fenetre bloquee", "connexion avec avertissements", "entreprise non verifiee"]
---

# Connecter WhatsApp

WhatsApp est le canal principal de Parallly : une fois connecté, votre agent IA commence à recevoir et à répondre aux messages de vos clients sur ce numéro, avec votre catalogue, votre agenda et les informations de votre entreprise. La connexion est officielle, via Meta (l'entreprise propriétaire de WhatsApp), et prend entre 5 et 20 minutes selon la méthode choisie.

## Avant de commencer

- Vous devez être **administrateur** de votre compte Parallly ; l'administration des canaux n'est pas accessible aux superviseurs ni aux agents.
- Vous avez besoin d'un compte Facebook avec accès à l'entreprise dans Meta Business Suite.
- Gardez à portée de main le numéro de téléphone que vous allez utiliser : il doit pouvoir recevoir des SMS ou des appels (les numéros virtuels VoIP et les lignes premium ne fonctionnent pas).
- L'écran **Canaux** indique si WhatsApp est activé pour votre compte.

## Comment connecter votre numéro

1. Dans la barre latérale, section **Administration**, accédez à **Canaux**.
2. Sur la carte **WhatsApp**, cliquez sur **Connecter**.
3. Avant les parcours apparaît **« Avant de connecter WhatsApp »** : une courte liste avec le numéro, l'accès à son code de vérification et le compte Facebook. Cochez les trois points et cliquez sur **Continuer** ; tant que ce n'est pas fait, le bouton affiche **Confirmez les points pour continuer**. C'est un rappel, pas une validation : rien de vos données n'y est vérifié. La même étape apparaît dans l'assistant **Faites connaissance avec votre agent** et sur l'écran **WhatsApp**.
4. Vous verrez l'écran **« Choisissez votre méthode de connexion »** avec trois parcours :
   - **WhatsApp Business App** (étiquette **Coexistence**, marquée **Recommandé**, ~20 min) — si vous utilisez déjà l'application WhatsApp Business sur votre téléphone et souhaitez la conserver avec vos conversations. C'est le parcours que nous suggérons ; consultez la section suivante.
   - **Nouveau numéro** (~5 min) — pour un numéro jamais utilisé sur WhatsApp. C'est le chemin le plus rapide si vous inaugurez une ligne.
   - **Migrer depuis un autre fournisseur** (~15 min) — si vous utilisez déjà WhatsApp avec une autre plateforme (Wati, 360dialog, Twilio, etc.) et souhaitez transférer votre numéro sans interruption de service.
5. Choisissez votre méthode et cliquez sur **Se connecter avec Facebook**. Une fenêtre Meta s'ouvre.
6. Connectez-vous avec votre compte Facebook et sélectionnez (ou créez) votre portefeuille Meta Business.
7. Sélectionnez ou ajoutez votre compte WhatsApp Business et le numéro de téléphone.
8. Vérifiez le numéro avec un **code reçu par SMS ou appel vocal** et approuvez les autorisations.
9. Vous suivrez la progression à l'écran : **Autorisation → Connexion du numéro → Activation de WhatsApp**. À la fin, « Connexion réussie ! » s'affiche et votre agent répond déjà sur ce numéro.

> Astuce : dès la connexion, l'écran affiche la carte **« Testez votre agent »** avec votre numéro. Envoyez-lui un message WhatsApp depuis un autre téléphone et observez sa réponse.

### Si la fenêtre Meta n'apparaît pas

L'autorisation se déroule dans une fenêtre contextuelle Meta. Si rien ne s'ouvre au clic,
ou si le bouton reste en attente, c'est presque toujours le navigateur qui bloque les
fenêtres contextuelles :

1. Autorisez les fenêtres contextuelles pour `admin.parallly-chat.cloud` depuis l'icône de
   blocage de la barre d'adresse.
2. Cliquez de nouveau sur **Se connecter avec Facebook**.
3. Ne fermez pas la fenêtre Meta avant de voir le message de connexion terminée. Si vous
   l'avez fermée à mi-parcours, recommencez depuis **Canaux**.

Cette étape fonctionne mieux sur un ordinateur : sur un téléphone, la fenêtre Meta s'ouvre
dans un autre onglet et se perd facilement de vue.

### Connexion terminée avec des avertissements

Il arrive que la connexion aboutisse mais qu'il reste quelque chose en attente côté Meta.
L'écran n'affiche alors pas une réussite nette : une **carte ambre** liste les
avertissements. Les plus fréquents :

- **Entreprise non vérifiée sur Meta** — le numéro reste connecté, avec des limites
  d'envoi plus basses, jusqu'à ce que vous terminiez la vérification de l'entreprise dans
  Meta Business Suite.
- **Échec de l'abonnement au webhook** — Parallly n'a pas été abonné aux messages entrants
  de ce numéro, donc l'agent risque de ne rien recevoir. Réessayez la connexion et, si
  cela se répète, contactez le support.
- **Enregistrement du numéro encore en attente** — Meta a fini d'enregistrer le numéro plus
  tard que le reste de la connexion. Cela se règle généralement tout seul en quelques
  minutes ; revenez sur l'écran et confirmez que le numéro est bien actif.
- **Impossible de récupérer vos modèles** — la synchronisation des modèles a échoué. La
  connexion fonctionne quand même ; resynchronisez-les depuis **Modèles** quand vous voulez.

Lisez l'avertissement avant de considérer la mise en route comme terminée : la carte ambre
signifie « connecté, mais vérifiez ceci », pas « tout est prêt ».

## Mode coexistence : conservez votre application WhatsApp Business

Si vous servez aujourd'hui vos clients depuis l'application WhatsApp Business sur votre téléphone, vous n'avez pas à l'abandonner. Avec la méthode **WhatsApp Business App** (Coexistence), votre numéro est connecté à Parallly **et** continue de fonctionner sur votre téléphone en même temps : l'IA répond depuis la plateforme et vous pouvez continuer à discuter depuis l'application quand vous le souhaitez.

Étapes propres à cette méthode :

1. Connectez-vous avec votre compte Facebook et sélectionnez votre portefeuille Meta Business.
2. **Scannez le code QR depuis votre application WhatsApp Business** (comme lorsque vous liez WhatsApp Web).
3. **Autorisez la synchronisation de l'historique et des contacts**. Important : vous disposez de **24 heures** après la connexion pour l'autoriser ; passé ce délai, il faudra recommencer la connexion depuis le début.

Prérequis : application WhatsApp Business à jour (version 2.24.17 ou supérieure), numéro avec au moins 7 jours d'activité sur l'application et une connexion WiFi stable (la synchronisation peut prendre plusieurs heures).

**Ce qui se synchronise avec Parallly :**

- Les chats individuels des **6 derniers mois** (texte)
- Les images, vidéos et audios des 14 derniers jours
- Vos contacts enregistrés dans l'application
- Les nouveaux messages que vous envoyez depuis l'application, en temps réel

**Ce qui ne se synchronise PAS :** les conversations de groupe, les messages éphémères ou « voir une fois », les fichiers médias de plus de 14 jours et le catalogue de produits de l'application.

**Limitations du mode coexistence :**

- Vous devez **ouvrir l'application WhatsApp Business au moins tous les 14 jours** pour maintenir la connexion active.
- Les appareils liés (WhatsApp Web/Desktop) sont déconnectés à l'activation ; vous pouvez les reconnecter ensuite.
- Les listes de diffusion de l'application passent en lecture seule.
- La vitesse d'envoi est un peu plus faible (~20 messages par seconde), largement suffisante pour la grande majorité des entreprises.

## États du canal

Dans **Canaux**, chaque carte affiche l'état de la connexion :

- **Connecté** — le numéro est actif et l'agent répond.
- **Connecté** + **Reconnecter : identifiants expirés** — la carte affiche les deux
  étiquettes en même temps : la verte habituelle et, à côté, une rouge. La connexion
  existe, mais l'autorisation que Parallly utilise pour envoyer est expirée, révoquée, en
  erreur ou absente. Le numéro peut continuer à recevoir des messages et les réponses ne
  partent pas tant que vous n'avez pas réautorisé depuis **Connecter**. La **Santé des agents** le
  signale comme connexion opérationnelle affectée et la traite comme une action critique
  de l'agent.
- **Déconnecté** — il n'y a pas encore de connexion, ou elle a été interrompue.

En ouvrant **WhatsApp** avec un numéro connecté, vous verrez la carte **Canal Actif** avec le **Numéro**, le **Nom vérifié** et la **Qualité** (la note que Meta attribue à votre numéro selon la manière dont vos clients reçoivent vos messages ; la maintenir « élevée » vous donne de meilleures limites d'envoi). Vous trouverez également la carte **Profil commercial** avec le bouton **Gérer le profil** pour modifier les informations que vos clients voient sur WhatsApp.

## Modèles WhatsApp

WhatsApp permet de répondre librement pendant les **24 heures** qui suivent le dernier message du client. Pour lui écrire **en dehors** de cette fenêtre — par exemple un rappel de rendez-vous ou une campagne — vous avez besoin d'un **modèle approuvé par Meta**.

Pour les gérer : **Canaux → WhatsApp → Voir tous les modèles** (la page **Modèles WhatsApp**).

- **Synchroniser depuis Meta** — importe dans Parallly les modèles déjà approuvés sur votre compte.
- **Créer un modèle** — créez-en un nouveau sans quitter Parallly : nom, langue, catégorie, corps avec variables (par exemple `{{1}}` pour le nom du client), en-tête, pied de page et jusqu'à 3 boutons, avec aperçu en direct. Une fois terminé, cliquez sur **Envoyer à Meta** ; Meta détermine le statut et le délai d'examen.
- Chaque modèle affiche son statut : **Approuvé**, **En attente** ou **Rejeté** (avec le motif du rejet pour que vous puissiez le corriger et le renvoyer).
- Lors de la connexion de WhatsApp, Parallly soumet automatiquement **4 modèles de départ** déjà validés (rappel de rendez-vous, confirmation de présence, confirmation de commande et paiement reçu) pour que vous ayez de quoi commencer.

## Plus d'un numéro WhatsApp ?

Vous pouvez connecter plusieurs numéros si votre compte dispose de la capacité nécessaire. La carte WhatsApp affiche l'utilisation actuelle et le bouton **Ajouter un autre** tant qu'une place reste disponible. Consultez la limite actuelle dans **Forfait et facturation**.

Chaque connexion est indépendante : elle a son propre agent IA (vous l'attribuez dans l'éditeur d'agent) et ses conversations ne se mélangent pas. Un brouillon de campagne peut enregistrer le numéro émetteur prévu, mais ne lancez pas de campagne réelle depuis l'éditeur actuel : l'association exacte modèle/émetteur et l'annulation ne sont pas encore certifiées de bout en bout. Si vous avez besoin de plus de numéros que ne le permet la configuration actuelle de votre compte, écrivez-nous au [support](https://parallly-chat.cloud/support).

## Comment déconnecter un numéro

1. Accédez à **Canaux**, ouvrez **WhatsApp** et choisissez la connexion à retirer.
2. Cliquez sur **Déconnecter** et confirmez. Si vous avez plusieurs numéros, les autres restent actifs.
3. Le résultat s'affiche avec une couleur :
   - **Vert** — déconnexion complète.
   - **Jaune** — déconnecté dans Parallly, mais il est recommandé de vérifier aussi dans Meta Business Suite que l'intégration a bien été fermée.
   - **Rouge** — une erreur réseau s'est produite ; réessayez.

## Questions fréquentes

**Puis-je continuer à utiliser WhatsApp Business sur mon téléphone ?**
Oui, avec le mode **Coexistence** : l'IA répond depuis Parallly et vous conservez l'application. Pensez simplement à l'ouvrir au moins tous les 14 jours.

**Est-ce que je perds mes anciennes conversations en me connectant ?**
Non, si vous vous connectez en coexistence : jusqu'à 6 mois de conversations texte et vos contacts sont synchronisés. Si vous migrez depuis un autre fournisseur, l'historique de ce fournisseur n'est pas transféré.

**Ai-je besoin de modèles pour que l'agent réponde ?**
Non. L'agent répond librement dans la fenêtre de 24 heures qui suit le dernier message du client. Les modèles ne sont nécessaires que pour engager vous-même la conversation en dehors de cette fenêtre.

**Pourquoi mon modèle a-t-il été rejeté ?**
Meta examine le contenu. Sur la page des modèles, vous verrez le **motif du rejet** ; corrigez le texte (évitez un langage promotionnel agressif dans les modèles utilitaires) et renvoyez-le.

**Qui peut connecter ou déconnecter WhatsApp ?**
Uniquement l'**administrateur** du compte. Les superviseurs et les agents peuvent voir l'état, mais pas le modifier.

**Puis-je avoir un agent différent sur chaque numéro ?**
Oui. La règle est d'un agent IA par connexion : par exemple, un agent commercial sur un numéro et un agent support sur un autre. L'attribution se fait dans l'éditeur d'agent.

Une question qui reste en suspens ? Écrivez-nous au [support](https://parallly-chat.cloud/support).
