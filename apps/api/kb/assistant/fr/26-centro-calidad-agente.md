---
id: centro-calidad-agente
title: "Centre de qualité de l'agent"
routes: ["/admin/agent/quality"]
roles: ["tenant_admin", "tenant_supervisor"]
keywords: ["centre de qualite", "qualite de l agent", "preparation", "qualite testee", "preuves de production", "agent a risque", "pret pour pilote", "configuration incomplete", "revision requise", "recommandations", "faiblesses de l agent", "ameliorer agent"]
---

# Centre de qualité de l'agent

Le **Centre de qualité** indique ce qu'il reste à configurer, ce qui a été testé et ce
qui se passe dans les conversations réelles pour chaque agent IA. Il se trouve dans
**Insights → Centre de qualité**. Admin et Supervisor peuvent le consulter ; seul
Admin peut modifier les agents, connexions ou paramètres dans **IA et croissance →
Agent IA**.

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

## Questions fréquentes

**La checklist de configuration est-elle identique au Centre de qualité ?**
Non. La checklist guide l'adoption initiale. Le centre ajoute des tests reproductibles
et des preuves de production attribuées.

**Un bon score de simulation suffit-il pour publier ?**
Non. Il réduit le risque, mais doit être examiné avec les blocages critiques, la
fraîcheur de la version et les preuves réelles lorsqu'elles sont disponibles.

**Le système apprend-il et se modifie-t-il seul après chaque conversation ?**
Non. Les interactions produisent des diagnostics et recommandations ; une personne
examine et approuve tout changement avant de le tester à nouveau.
