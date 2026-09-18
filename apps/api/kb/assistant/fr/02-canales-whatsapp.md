---
id: canales-whatsapp
title: "Connecter WhatsApp"
routes: ["/admin/channels", "/admin/channels/whatsapp", "/admin/channels/whatsapp/templates"]
roles: ["tenant_admin"]
keywords: ["whatsapp", "connecter whatsapp", "numero whatsapp", "whatsapp business", "coexistence", "application whatsapp", "migrer numero", "modeles", "templates", "modele whatsapp", "synchroniser conversations", "historique des conversations", "code qr", "verification", "meta", "facebook", "deconnecter whatsapp", "fenetre de 24 heures", "plusieurs comptes", "deuxieme numero", "nouvelle autorisation", "fenetre bloquee", "connexion avec avertissements", "entreprise non verifiee", "facturation meta", "meta facture", "cout de whatsapp", "moyen de paiement", "carte chez meta", "messages de service", "messages gratuits", "plafond de depense", "envoi en pause", "ne repond plus", "1er octobre", "facture meta", "ou vit votre numero", "quelle option est la mienne", "numero chez un autre fournisseur", "fuseau horaire de facturation", "testez votre agent", "connecte mais ne repond pas", "moyen de paiement chez meta", "verifier chez meta"]
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
3. Avant d'ouvrir la moindre fenêtre, nous vous posons une seule question : **« Où se trouve aujourd'hui votre numéro ? »**. Chaque réponse demande ce qui lui est propre :
   - **Dans l'application WhatsApp Business d'un téléphone** — coexistence : le numéro reste sur votre téléphone, vous scannez un code QR depuis l'application et vous devez l'ouvrir au moins tous les 14 jours pour garder la connexion active.
   - **Dans le WhatsApp ordinaire de mon téléphone** — vous le passez d'abord sur WhatsApp Business (gratuit, vous gardez votre numéro et vos conversations), puis vous revenez sur cet écran.
   - **C'est un numéro neuf, ou sans WhatsApp** — inscription directe auprès de Meta : il faut le numéro, son code de vérification et un compte Facebook.
   - **Un autre fournisseur l'utilise déjà** — un numéro ne peut être que chez un seul fournisseur à la fois : demandez à votre fournisseur actuel de désactiver la validation en deux étapes du numéro ; cela dépend de lui et prend en général de quelques heures à quelques jours.
   - **Je ne l'ai pas sous la main maintenant** — c'est noté, et nous vous le rappelons sur l'**Accueil**.

   La première réponse est le parcours de coexistence, détaillé dans la section suivante. Avec les deux dernières, aucune fenêtre Meta ne s'ouvre encore : en attendant, votre agent continue de répondre sur le lien de votre agent.
4. Une fois votre réponse donnée, vous voyez le temps qu'il **vous** faut pour terminer ce parcours et, quand la réponse ouvre un parcours, son résumé : l'essentiel d'abord, avec le détail complet sous **« Voir plus de détails »**. Les avertissements qui comptent — la fenêtre de 24 heures pour autoriser l'historique, le code PIN à deux étapes avant de migrer — restent toujours visibles, jamais cachés là. Cliquez sur **Se connecter avec Facebook** pour ouvrir la fenêtre Meta.
5. Pendant que la fenêtre est ouverte, un texte à l'écran vous dit quoi y faire ; si vous êtes bloqué ou changez d'avis, le lien **Annuler et revenir** vous ramène à cet écran sans perdre ce que vous avez déjà répondu.
6. Connectez-vous avec votre compte Facebook et sélectionnez (ou créez) votre portefeuille Meta Business.
7. Sélectionnez ou ajoutez votre compte WhatsApp Business et le numéro de téléphone.
8. Vérifiez le numéro avec un **code reçu par SMS ou appel vocal** et approuvez les autorisations.
9. Vous suivrez la progression à l'écran : **Autorisation → Connexion du numéro → Activation de WhatsApp**, jusqu'à « Connexion réussie ! ». Être connecté ne veut pas encore dire répondre : vérifiez d'abord le fuseau horaire et le moyen de paiement (voir **Avant que votre agent réponde**, plus bas).

> Astuce : après la connexion apparaît la carte **Testez votre agent** avec votre numéro : écrivez-lui depuis un autre téléphone et regardez-le répondre. Si le fuseau horaire reste à confirmer, l'assistant vous le rappelle sur cette carte au lieu de proposer **Ouvrir WhatsApp**. S'il ne répond pas, vérifiez trois choses : que le fuseau horaire de facturation est confirmé, que votre compte WhatsApp a un moyen de paiement chez Meta et que votre agent n'est pas en pause.

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
- **Enregistrement du numéro encore en attente** — Meta n'a pas terminé d'enregistrer le
  numéro pour envoyer des messages. Tant que ce n'est pas terminé, aucun message ne peut
  partir de ce numéro, donc votre agent ne peut pas y répondre, et cela ne se règle pas
  tout seul : écrivez au [support](https://parallly-chat.cloud/support) et nous le
  terminerons avec vous.
- **Impossible de récupérer vos modèles** — la synchronisation des modèles a échoué. La
  connexion fonctionne quand même ; resynchronisez-les depuis **Modèles** quand vous voulez.

Lisez l'avertissement avant de considérer la mise en route comme terminée : la carte ambre
signifie « connecté, mais vérifiez ceci », pas « tout est prêt ». S'il s'agit de votre premier
canal, l'agent par défaut lui est affecté et y répond dès que rien ne l'en empêche (voir la section suivante).

### Avant que votre agent réponde : fuseau horaire et moyen de paiement

Que le numéro soit connecté ne veut pas dire que votre agent peut déjà y répondre. Deux choses qui ne dépendent pas de la connexion décident si ses réponses partent, et en connectant depuis l'assistant **Faites connaissance avec votre agent**, l'écran vous les montre dans cet ordre :

1. **Le fuseau horaire de facturation du numéro.** Meta date chaque facturation dans le fuseau horaire de votre compte WhatsApp et, tant que le numéro n'en a pas, aucune réponse de votre agent ne part par là. S'il manque, l'écran vous le demande avec celui de votre entreprise déjà sélectionné : si c'est le même, confirmez-le en un geste. Pour le confirmer, votre e-mail doit être vérifié.
2. **Le moyen de paiement chez Meta.** La carte **Moyen de paiement chez Meta** le vérifie auprès de Meta et indique s'il est prêt, s'il manque, si Meta refuse de facturer votre compte ou si cela n'a pas pu être confirmé. Si besoin, **Ajouter un moyen de paiement chez Meta** ouvre les outils de Meta et, une fois ajouté, **Je l'ai ajouté : vérifier** pose à nouveau la question.

Ce n'est que lorsque le fuseau horaire est confirmé et que le moyen de paiement ne bloque pas la livraison que l'écran affiche **Connecté !** et indique que votre agent y répond déjà. Rien de tout cela ne vous arrête : vous pouvez appuyer sur **Continuer** et terminer plus tard dans **Canaux → WhatsApp**, où chaque numéro affiche son **Fuseau horaire de facturation WhatsApp** et la carte **Financement de votre compte WhatsApp** propose **Vérifier chez Meta**. Si l'un de ces points bloque les réponses, **Santé des agents** vous le signale aussi.

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

- **Connecté** — le numéro est actif. Pour que l'agent réponde, il faut aussi un fuseau horaire de facturation confirmé et, à partir du 1er octobre 2026, un moyen de paiement sur votre compte WhatsApp Business chez Meta.
- **Connecté** + **Reconnecter : identifiants expirés** — la carte affiche les deux
  étiquettes en même temps : la verte habituelle et, à côté, une rouge. La connexion
  existe, mais l'autorisation que Parallly utilise pour envoyer est expirée, révoquée, en
  erreur ou absente. Le numéro peut continuer à recevoir des messages et les réponses ne
  partent pas tant que vous n'avez pas réautorisé depuis **Connecter**. La **Santé des agents** le
  signale comme connexion opérationnelle affectée et la traite comme une action critique
  de l'agent.
- **Déconnecté** — il n'y a pas encore de connexion, ou elle a été interrompue.

En ouvrant **WhatsApp** avec un numéro connecté, vous verrez la carte **Canal Actif** avec le **Numéro**, le **Nom vérifié** et la **Qualité** (la note que Meta attribue à votre numéro selon la manière dont vos clients reçoivent vos messages ; la maintenir « élevée » vous donne de meilleures limites d'envoi). Vous trouverez également la carte **Profil commercial** avec le bouton **Gérer le profil** pour modifier les informations que vos clients voient sur WhatsApp.

## Ce que Meta facture à votre compte WhatsApp

À partir du **1er octobre 2026**, Meta facture à **votre propre compte WhatsApp Business** chaque **message de service livré** : les réponses de votre agent et celles de votre équipe dans la fenêtre de 24 heures. Ce que vos clients vous écrivent reste gratuit.

Cette facturation **n'est pas celle de Parallly**. Vis-à-vis de Meta, Parallly est fournisseur de technologie : elle ne vous facture pas ces messages, ne les paie pas à Meta à votre place et ne les inclut pas dans votre abonnement. Ce sont deux paiements distincts et aucun ne remplace l'autre :

- **Votre abonnement Parallly** — le logiciel. Il se gère dans **Administration → Forfait et facturation**.
- **Les messages livrés par WhatsApp** — payés par votre entreprise à Meta, avec le moyen de paiement enregistré sur **votre** compte WhatsApp Business.

Changer de forfait chez Parallly ne change pas ce que Meta facture.

### Le moyen de paiement s'enregistre chez Meta, pas chez Parallly

Il s'ajoute depuis les outils de Meta (WhatsApp Manager → paramètres du compte → **Facturation et paiements**), avec un utilisateur qui administre ce compte WhatsApp Business. Si votre portefeuille Meta possède déjà un moyen de paiement — pour les publicités, par exemple —, vous pouvez le choisir pour ce compte sans le saisir à nouveau.

**Parallly ne demande jamais un numéro de carte par chat** : ni l'agent, ni Parallly Assist, ni le support. Si quelqu'un vous le demande dans une conversation, ce n'est pas nous.

### Sans moyen de paiement, le numéro cesse de livrer

Il ne se dégrade pas : à partir du 1er octobre 2026, un compte WhatsApp Business sans moyen de paiement **cesse de livrer les messages de service**, même si vous n'avez rien dépensé ce mois-là. Vu de l'extérieur, c'est un agent qui a cessé de répondre.

Ce qui continue de fonctionner : les messages entrants sont toujours reçus, enregistrés et affichés dans l'**Inbox**. La conversation n'est pas perdue ; c'est la réponse qui ne sort pas.

### Comment savoir si votre numéro est prêt

1. Ouvrez **Canaux → WhatsApp** et regardez la carte **Facturation WhatsApp (Meta)** : elle indique si l'envoi d'un numéro a été mis en pause.
2. Vérifiez dans les outils de Meta que **ce** compte WhatsApp Business a un moyen de paiement, une devise et un fuseau horaire définis. Les trois sont nécessaires : s'il en manque un, la facturation ne peut pas se faire.
3. **Une carte enregistrée ne garantit pas que le paiement sera accepté.** Meta peut indiquer qu'un moyen de paiement existe et la banque le refuser quand même : carte expirée, achats internationaux non activés, plafond atteint, données fiscales incomplètes. « Enregistrée » signifie seulement que ce n'est pas cela qui manque.

### Les 1 000 messages de service gratuits

Chaque **numéro** reçoit **1 000 messages de service gratuits par mois civil**. Meta facture à partir du 1 001e.

Ce que le quota **n'est pas** :

- **Ce n'est pas par pays.** Un numéro qui répond dans neuf pays a mille gratuits au total, pas mille par pays.
- **Ce n'est pas par contact ni par conversation.** On compte des messages livrés, pas des personnes.
- **Cela ne couvre pas les modèles.** Les modèles marketing, utilitaires et d'authentification sont facturés à part et ne consomment pas le quota.
- **Cela ne se cumule pas.** Ce que vous n'utilisez pas ce mois-ci ne se reporte pas.
- **Ce n'est pas par compte ni par forfait.** C'est par numéro : avec deux numéros connectés, chacun apporte son propre quota.

Le mois se clôt dans le **fuseau horaire de votre compte WhatsApp Business**, qui n'est pas forcément le vôtre. Si Parallly affiche une période de 30 jours et Meta un mois civil, ce sont deux périodes différentes.

### Ce que vous voyez dans Parallly, et ce que vous ne voyez pas

Dans **Canaux → WhatsApp**, la carte **Facturation WhatsApp (Meta)** montre où en est le quota gratuit, la dépense de la période séparée par devise, où elle est partie et quels numéros sont en pause. Seul l'**administrateur** la lit : **Canaux** est un écran d'administration, il n'apparaît pas dans le menu des superviseurs ni des agents et, s'ils saisissent l'adresse, le panneau les redirige. Qui n'est pas administrateur et a besoin du chiffre doit le demander. Reprendre un numéro lui appartient aussi.

C'est la mesure de **ce que Parallly a envoyé** sur cette connexion, pas une copie de la facture de Meta. Cette facture est émise par Meta et se consulte dans les outils de Meta.

### Ce qu'un plafond de dépense peut et ne peut pas promettre

Un plafond de dépense borne **ce que Parallly envoie** sur cette connexion pendant la période. Le compteur démarre en **Observation seulement** : il compte, il alerte et **n'arrête aucun envoi**. Parallly crée chaque mois des valeurs initiales de **2 000 livraisons par numéro** et **60 par contact**. Un administrateur peut activer la **Protection des dépenses** dans **Canaux → WhatsApp** après avoir examiné la mesure ; les envois proactifs sont alors suspendus près du plafond et la portée qui l'épuise s'arrête.

Et même actif, il y a trois choses qu'un plafond **ne peut pas** promettre :

- **Il ne limite pas ce qu'un autre outil facture au même compte.** Si un autre système — ou votre équipe depuis l'application WhatsApp Business — envoie via ce même compte WhatsApp Business, cette consommation arrive sur la même facture Meta, et Parallly ne la voit pas et ne peut pas l'arrêter.
- **Ce n'est pas une limite appliquée par Meta.** Meta ne connaît pas votre plafond : elle continue de livrer et de facturer ce qui lui parvient, d'où que cela vienne.
- **Il ne baisse pas le tarif.** Il coupe le volume, pas le prix par message.

### Si l'envoi d'un numéro est mis en pause

Quand Meta répond que ce compte **ne peut pas être facturé**, Parallly met en pause les envois facturables **de ce numéro** — celui-là seulement, pas les autres — et ne réessaie pas : chaque tentative serait identique et échouerait de la même façon tant que personne n'agit du côté de Meta.

1. Dans **Canaux → WhatsApp**, vous verrez **Envoi en pause**, avec le motif et depuis quand.
2. Corrigez le moyen de paiement dans les outils de Meta.
3. Revenez dans Parallly et appuyez sur **Reprendre les envois** (administrateur uniquement). C'est votre déclaration que c'est réglé, pas une vérification : si Meta refuse de nouveau la facturation, le numéro se remet en pause tout seul à la tentative suivante et le motif réapparaît au même endroit.

Pendant la pause, les messages entrants continuent d'être reçus.

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

**Comment savoir laquelle des cinq options est la mienne ?**
Regardez où vous répondez aujourd'hui à vos clients : si c'est l'application verte WhatsApp Business sur votre téléphone, c'est la première option, et si c'est votre WhatsApp habituel, c'est la deuxième. Si le numéro est neuf ou n'a pas encore WhatsApp, ou si une autre plateforme y répond aujourd'hui, ce sont respectivement la troisième et la quatrième option ; et si vous n'avez tout simplement pas le numéro sous la main maintenant, la cinquième vous permet de le reprendre plus tard. En cas de doute, choisissez ce qui décrit où vit le numéro **aujourd'hui**, pas où vous comptez l'emmener : l'écran suivant vous montre exactement ce qu'il vous faut avant de trancher tout à fait.

**Est-ce que je perds mes anciennes conversations en me connectant ?**
Non, si vous vous connectez en coexistence : jusqu'à 6 mois de conversations texte et vos contacts sont synchronisés. Si vous migrez depuis un autre fournisseur, l'historique de ce fournisseur n'est pas transféré.

**Ai-je besoin de modèles pour que l'agent réponde ?**
Non. L'agent répond librement dans la fenêtre de 24 heures qui suit le dernier message du client. Les modèles ne sont nécessaires que pour engager vous-même la conversation en dehors de cette fenêtre.

**Pourquoi mon modèle a-t-il été rejeté ?**
Meta examine le contenu. Sur la page des modèles, vous verrez le **motif du rejet** ; corrigez le texte (évitez un langage promotionnel agressif dans les modèles utilitaires) et renvoyez-le.

**Qui peut connecter ou déconnecter WhatsApp ?**
Uniquement l'**administrateur** du compte. Les superviseurs et les agents n'entrent pas dans **Canaux** : ils n'y voient pas l'état de la connexion et ne peuvent pas le modifier. Ce qu'un superviseur voit, c'est si un canal assigné à l'agent est resté sans connexion, dans **Santé des agents**.

**Puis-je avoir un agent différent sur chaque numéro ?**
Oui. La règle est d'un agent IA par connexion : par exemple, un agent commercial sur un numéro et un agent support sur un autre. L'attribution se fait dans l'éditeur d'agent.

**Est-ce que Parallly me facture les messages WhatsApp ?**
Non. À partir du 1er octobre 2026, Meta facture à votre compte WhatsApp Business chaque message de service livré, avec le moyen de paiement que vous avez enregistré chez Meta. Votre abonnement Parallly est un paiement séparé et ne change pas pour autant.

**Dois-je donner ma carte à Parallly pour payer WhatsApp ?**
Non, et personne chez Parallly ne vous la demandera par chat. Le moyen de paiement WhatsApp s'enregistre dans les outils de Meta, sur votre propre compte WhatsApp Business.

**Les 1 000 messages gratuits sont-ils par compte ou par numéro ?**
Par numéro et par mois civil, sans report. Pas par pays, pas par contact, et ils ne couvrent pas les modèles.

**Instagram et Messenger sont-ils aussi facturés au message ?**
Pas aujourd'hui. La facturation par message de service qui commence le 1er octobre 2026 est celle de WhatsApp ; Instagram, Messenger et Telegram n'ont pas de facturation par message de service de la part de leur fournisseur.

Une question qui reste en suspens ? Écrivez-nous au [support](https://parallly-chat.cloud/support).


Pour les comptes existants : ouvrez https://business.facebook.com/wa/manage/home/, sélectionnez la WABA indiquée dans Canaux → WhatsApp et ajoutez un moyen de paiement dans Vue d’ensemble / paiements. Ne reconnectez pas les numéros. Revenez au tableau de bord et choisissez Vérifier chez Meta. Inconnu ne signifie pas absence de carte ; un moyen associé ne garantit pas de fonds. Meta indique que si le compte n’a pas de moyen de paiement au 30 septembre 2026, il cesse de livrer les messages de service à partir du 1er octobre. Meta ne publie pas que les 1 000 messages gratuits du mois continuent de partir sans carte : n’y comptez pas et ajoutez le moyen de paiement avant le 30 septembre.
