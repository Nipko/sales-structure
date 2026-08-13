---
id: centro-calidad-agente
title: "Santé des agents et Centre de qualité"
routes: ["/admin/agent/quality", "/admin"]
roles: ["tenant_admin", "tenant_supervisor"]
keywords: ["sante des agents", "centre de qualite", "qualite de l agent", "preparation", "qualite testee", "preuves de production", "agent a risque", "configuration incomplete", "actions critiques", "badge", "reporter", "Parallly Assist", "ameliorer agent"]
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
