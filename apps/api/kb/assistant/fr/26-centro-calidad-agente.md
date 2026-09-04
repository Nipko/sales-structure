---
id: centro-calidad-agente
title: "Santé des agents et Centre de qualité"
routes: ["/admin/agent/quality", "/admin"]
roles: ["tenant_admin", "tenant_supervisor"]
keywords: ["sante des agents", "centre de qualite", "qualite de l agent", "preparation", "qualite testee", "preuves de production", "agent a risque", "configuration incomplete", "actions critiques", "badge", "reporter", "Parallly Assist", "ameliorer agent", "couverture des canaux", "connexion operationnelle du canal", "montrez-moi ou", "parcours guide", "barre de contexte", "nouvelle autorisation"]
---

# Santé des agents et Centre de qualité

La **Santé des agents** indique ce qu'il reste à configurer, ce qui a été testé et ce
qui se passe dans les conversations réelles pour chaque agent IA. Le détail se trouve
dans **Insights → Santé des agents**. Admin et Supervisor peuvent le consulter ; seul
Admin peut modifier les agents, connexions ou paramètres dans **IA et croissance →
Agent IA**.

## Où elle apparaît et ce qu'elle signifie

- La carte **Santé de vos agents** de l'Accueil résume toujours le pire état et les
  actions ouvertes pour Admin/Supervisor.
- Le badge **Insights → Santé des agents** compte uniquement les signaux **Critiques
  et Élevés ouverts**. C'est un compteur d'attention, pas un score.
- La bannière globale apparaît seulement pour un signal Critique ouvert ou un état
  **Agent à risque**. Vous pouvez **Examiner**, **Demander à Assist** ou **Reporter de
  24 h**.
- Reporter masque temporairement ce signal, sans le corriger. Ces alertes restent dans
  le dashboard et n'envoient ni e-mail ni notification push.

## Les trois niveaux de preuve

- **Préparation :** vérifie l'entreprise et le périmètre, les connaissances, la
  conversation et la marque, les actions, la sécurité et le transfert, ainsi que la
  robustesse opérationnelle. Une capacité hors périmètre peut être **Non applicable**
  et ne réduit pas le résultat.
- **Qualité testée :** affiche la dernière évaluation critique et la dernière
  simulation, avec version, date, seuil et scénarios. Les preuves antérieures peuvent
  devenir obsolètes lorsque l'agent change. Il s'agit d'une preuve automatisée, pas
  d'une certification.
- **Production :** utilise les interactions réelles attribuées à l'agent et à sa
  version. La résolution vérifiée, la qualité conversationnelle observée, les
  transferts, les échecs d'outils et les lacunes de connaissances restent séparés.
  Si l'échantillon est encore trop faible, l'état est **Preuves insuffisantes**, pas zéro.

Les preuves historiques qui n'identifient pas l'agent sans ambiguïté ne sont pas
attribuées rétroactivement. Une version récemment publiée peut donc avoir besoin de
nouvelles interactions avant de produire un signal utile.

## Ce que vérifie « Connexion opérationnelle du canal »

Ce contrôle de **Préparation** distingue trois choses souvent confondues :

- **Affectation** — dans l'éditeur de l'agent, ces canaux sont cochés pour cet agent.
- **Connexion** — ce compte existe et est actif dans **Administration → Canaux**.
- **Identifiant** — l'autorisation est toujours valide, donc le canal peut encore envoyer
  des réponses.

Un canal coché sur l'agent mais non connecté **ne bloque plus** l'agent lorsqu'un autre
canal affecté fonctionne : il apparaît comme **Couverture des canaux assignés**, une
action Élevée et non critique, avec le nombre d'affectations de l'agent, combien sont
connectées et lesquelles n'ont aucune connexion.

**Connexion opérationnelle du canal** bloque en critique dans deux cas seulement :

- aucun canal affecté ne peut **recevoir** de messages (aucune connexion active), ou
- un identifiant **exige une nouvelle autorisation** (expiré, révoqué, en erreur ou
  absent), donc l'agent ne peut pas **envoyer** la réponse.

Un troisième contrôle critique, à part, vise les affectations qui ne correspondent pas à un
canal conversationnel certifié : **Portée opérationnelle du canal** rejette un agent
affecté à un type de canal qui ne porte pas de conversations (par exemple le SMS, qui
n'envoie que des notifications, ou l'e-mail, qui n'a pas aujourd'hui de configuration en
libre-service certifiée). Le déconnecter ne suffit pas : décochez ce type dans l'éditeur de
l'agent et ne laissez que des canaux certifiés — WhatsApp, Instagram, Messenger, Telegram
ou le chat web.

Un lien qui pointe vers un compte qui n'existe plus (par exemple, le numéro a été
reconnecté et son identifiant a changé) compte comme une affectation sans connexion : il
suffit de recocher le compte actuel dans l'éditeur de l'agent.

## Ce qui se passe quand vous cliquez sur Examiner

**Examiner** ouvre l'écran où la modification se fait et, en haut de cet écran, une
**barre de contexte** explique pourquoi vous êtes là. Elle affiche l'action en attente,
l'agent concerné, une explication en langage clair avec les preuves du contrôle (par
exemple, « affecté à 2 canaux, 1 connecté, sans connexion : instagram ») et jusqu'à quatre
boutons : **Montrez-moi où**, **Demander à Assist**, **Reporter de 24 h** et fermer.
**Montrez-moi où** n'apparaît que lorsqu'un parcours couvre ce signal et que votre rôle
peut le lancer ; sinon la barre affiche les trois autres. Elle
fait partie de l'écran, ce n'est pas une notification : rien n'est envoyé nulle part et
elle disparaît quand vous la fermez ou revenez sur cet écran sans ce lien.

**Revoir** ne vous laisse plus sur le pas de la porte : le lien transporte l'onglet et le
champ, donc l'éditeur ouvre cet onglet, fait défiler jusqu'au champ et le met en évidence.
Si le signal porte sur le message de repli, vous arrivez avec ce champ encadré ; idem pour
les règles ou les canaux affectés. Vous n'avez pas à parcourir un long formulaire pour
trouver ce qui manquait.

## Montrez-moi où (parcours guidé)

**Montrez-moi où** ouvre le bon écran et met en évidence, étape par étape, où se fait la
modification : quel champ, quel onglet, quel bouton. Le parcours **ne modifie** aucun
paramètre ; il indique seulement l'endroit, et la personne décide quoi écrire et quand
enregistrer. Il fonctionne sur ordinateur, où se trouvent ces éléments du panneau. Admin
voit les parcours d'édition (connecter un canal, affecter des canaux à l'agent, règles de
transfert) ; Supervisor voit ceux de révision (Centre de qualité, preuves de production).
Deux parcours atteignent aussi le rôle **agent** : celui du système d'aide (où se trouve
l'aide de chaque écran) et celui de la première conversation de la boîte de réception.
Vous pouvez aussi le demander dans le chat : quand vous demandez à Assist où ou comment
faire quelque chose qui dispose d'un parcours, la réponse contient ce bouton.

## Comment interpréter l'état

- **Pas encore évalué :** les preuves sont encore insuffisantes.
- **Configuration incomplète :** une exigence manque ou la préparation comporte un avertissement.
- **Agent à risque :** un test critique ou un signal réel important exige une révision.
- **Prêt pour un pilote contrôlé :** préparation et tests permettent un usage limité,
  mais les preuves réelles restent insuffisantes.
- **Opérationnel avec des preuves :** configuration, tests à jour et échantillon utile
  de production sont disponibles.
- **Révision requise :** les preuves sont devenues obsolètes ou les performances
  récentes se sont dégradées.

Aucun état ne signifie que l'agent est parfait, ne certifie son fonctionnement et ne
garantit des résultats commerciaux.

## Ce qu'il faut améliorer en premier

Parallly conserve des snapshots d'état et des signaux par agent, version et cause. Les
modifications de l'agent, résultats QA, évaluations et simulations actualisent les
preuves. Les récurrences sont regroupées pour éviter les doublons, et un passage
périodique limité récupère les événements manqués. Un signal peut être ouvert,
reconnu, reporté, résolu ou remplacé. Reconnaître ou reporter gère l'attention ; seules
de nouvelles preuves résolvent le signal.

Ouvrez d'abord les recommandations Critiques et Élevées. Chacune identifie le niveau
et la dimension concernés et, lorsque l'information existe, le nombre de scénarios ou
d'interactions à l'origine du signal. Utilisez-les pour distinguer :

- **Renforcer les connaissances :** une information manque ou la source n'a pas été retrouvée.
- **Ajuster le comportement :** l'information existait, mais l'agent a mal interrogé,
  expliqué, refusé ou transféré.
- **Réparer une capacité :** un outil, une connexion, une politique, une approbation
  ou un parcours humain a échoué.

Le Centre de qualité ne réécrit pas automatiquement les prompts, politiques ou
contenus. Admin effectue la modification, relance les tests et vérifie si de nouvelles
preuves confirment l'amélioration ; Supervisor peut examiner les résultats et
coordonner le suivi.

## Demander à Parallly Assist

Depuis l'Accueil ou la bannière globale, **Demander à Assist** ouvre le chat sur
l'agent et le signal choisis. Le serveur valide tenant, rôle, agent et signal, puis
Assist explique une priorité selon l'état actuel. Admin peut recevoir une route de
correction ; Supervisor reçoit la route d'examen sans obtenir de droit de modification.

Le contexte contient seulement l'état, la version, le jalon, les codes de blocage, la
fraîcheur des tests, l'échantillon, la gravité, le pilier, la dimension et les
compteurs. Il exclut transcriptions, texte des clients, IDs de conversation, prompts,
requêtes de recherche, texte libre de l'évaluateur et secrets. Assist n'applique pas
de changement et ne lance aucune communication externe.

Au-delà de l'état de l'agent, Assist reçoit aussi la **liste des canaux connectés de
l'entreprise** (type de canal, nombre de comptes et état de l'identifiant) ainsi que les
preuves bornées du contrôle : compteurs et types de canaux, jamais de noms, de numéros ni
d'identifiants. C'est pourquoi il peut dire quel canal fonctionne et lequel manque, au
lieu d'affirmer que vous n'avez aucun canal connecté.

## Questions fréquentes

**La checklist de configuration est-elle identique au Centre de qualité ?**
Non. La carte **Mise en route** de l'Accueil affiche uniquement les étapes essentielles
disponibles pour votre forfait, rôle et secteur, puis disparaît une fois terminée.
Elle remplace l'ancienne pastille flottante `8/9`. La Santé des agents ajoute tests et
preuves réelles.

**Un bon score de simulation suffit-il pour publier ?**
Non. Il réduit le risque, mais doit être examiné avec les blocages critiques, la
fraîcheur de la version et les preuves réelles lorsqu'elles sont disponibles.

**Le système apprend-il et se modifie-t-il seul après chaque conversation ?**
Non. Les interactions produisent des diagnostics et recommandations ; une personne
examine et approuve tout changement avant de le tester à nouveau.
