---
id: analytics-reportes
title: "Analyses et rapports"
routes: ["/admin", "/admin/analytics-v2", "/admin/crm-analytics", "/admin/agent-analytics", "/admin/report-builder", "/admin/settings/alerts"]
roles: ["tenant_admin", "tenant_supervisor"]
keywords: ["analyses", "analytique", "métriques", "rapports", "statistiques", "kpi", "tableau de bord", "csat", "satisfaction", "enquête", "entonnoir", "vélocité", "gagnés perdus", "gains pertes", "rapport personnalisé", "rapport programmé", "exporter csv", "performance des agents", "taux de résolution", "pipeline"]
---

# Analyses et rapports

Parallly mesure les conversations et les ventes pour vous aider à décider avec des données. Dans **Insights**, vous trouverez **Analyses**, **Analytiques CRM**, **Performance des agents**, **Attribution** et **Rapports personnalisés**.

Les analyses sont réservées aux administrateurs et aux superviseurs. Les utilisateurs ayant le rôle d'agent n'accèdent pas à ces vues ; ils doivent demander les informations nécessaires à un superviseur ou à un administrateur.

## Le tableau de bord principal (Dashboard)

Dès votre connexion, vous arrivez sur le **Dashboard** : votre vue d'ensemble de la journée. Il s'adapte à votre secteur — un cabinet médical voit « Rendez-vous du jour » et « Nouveaux patients » ; un restaurant voit « Commandes du jour » et « Revenus du jour » ; une activité générale voit « Conversations du jour », « Nouveaux leads » et « Taux de réponse ». Si votre compte est récent, vous verrez aussi une liste de contrôle avec les étapes qu'il reste à accomplir pour l'activer (connecter un canal, personnaliser votre agent, etc.).

## Comment consulter les métriques générales de l'entreprise

1. Dans la barre latérale, ouvrez **Insights → Analytique**.
2. Choisissez l'une des périodes disponibles ou définissez une plage personnalisée.
3. Parcourez les onglets : **Vue d'ensemble** (conversations, messages, résolution IA, temps de réponse, CSAT moyen), **IA & Bot**, **Résolution IA**, **Qualité (QA)**, **CRM & Ventes**, **Agents**, **Automatisation**, **Campagnes**, **Canaux**, **CSAT**, **Anomalies** et **Cohortes**.
4. Utilisez **Exporter CSV** pour télécharger les données et les retravailler dans votre tableur.

### Le taux de résolution IA

Dans l'onglet **Résolution IA**, vous voyez quel pourcentage de conversations votre agent IA a résolu seul, sans qu'un humain ait besoin d'intervenir, avec sa tendance dans le temps et la répartition par canal. Il s'agit d'un signal opérationnel, pas d'une note de qualité : un taux élevé peut coexister avec des réponses incorrectes, tandis qu'un taux faible peut refléter des transferts sûrs. S'il varie fortement selon le canal, examinez les demandes, l'agent attribué et les lacunes de connaissances.

## Comment examiner la performance de vos agents et de vos canaux

1. Allez dans **Insights → Performance des agents**.
2. En haut, vous voyez quatre indicateurs de la période : **Conversations**, **Temps de réponse moyen**, **Taux de résolution** et **CSAT moyen**.
3. Parcourez les onglets :
   - **Résumé** — volume quotidien de conversations.
   - **Agents** — tableau comparatif par agent (conversations, résolues, temps de réponse et CSAT), avec un badge **IA** ou **Humain**.
   - **Canaux** — combien de conversations arrivent par chaque canal et quel pourcentage du total elles représentent.
   - **CSAT** — la satisfaction de vos clients (voir plus bas).

## Comment fonctionne la mesure de la satisfaction (CSAT)

L'onglet **CSAT** de **Performance des agents** affiche les évaluations déjà enregistrées dans le compte :

- **CSAT moyen** de la période, avec le nombre total de réponses.
- **Répartition par étoiles** — combien de clients ont noté 5, combien ont noté 4, etc.
- **Commentaires récents** — ce que vos clients ont écrit, tel quel.

Dans la version actuelle, la fermeture d'une conversation n'envoie ni ne recueille automatiquement une enquête sur le canal et ne crée pas d'alerte dans la cloche. Pour collecter le CSAT, utilisez un processus ou une intégration activée pour votre compte et vérifiez que les réponses apparaissent avant de vous appuyer sur cette vue.

## Comment analyser votre entonnoir de ventes (Analytiques CRM)

1. Allez dans **Insights → Analytiques CRM**.
2. En haut, vous voyez les indicateurs clés : **Total des leads**, **Opportunités actives**, **Valeur du pipeline**, **Score moyen** et **Taux de conversion**.
3. Explorez les onglets :
   - **Résumé** — leads par étape, sources des leads et le bloc **Gagnés vs Perdus** : combien d'affaires vous avez gagnées, combien vous avez perdues, votre **Taux de réussite**, la valeur totale gagnée et les **Motifs de perte** les plus fréquents.
   - **Entonnoir** — comment vos contacts progressent étape par étape et où ils décrochent.
   - **Vélocité** — combien de jours une opportunité passe en moyenne à chaque étape. Si une étape accumule beaucoup de jours, c'est là que se situe votre goulot d'étranglement.
   - **Agents** — classement de l'équipe par affaires conclues et valeur vendue.

La vue **Attribution** (dans **Insights**) complète cela en mesurant le parcours complet de vos annonces : clics → conversations → leads → ventes, avec le retour de chaque campagne publicitaire.

## Comment créer un rapport personnalisé

Si vous avez besoin d'un rapport avec exactement les métriques qui vous intéressent :

1. Allez dans **Insights → Rapports personnalisés**.
2. Cliquez sur **Nouveau rapport**.
3. Saisissez le **Nom du rapport** (ex. « Performance hebdomadaire ») et une **Description** facultative.
4. Choisissez le **Type de graphique** : **Barres**, **Lignes**, **Aires** ou **Camembert**.
5. Dans **Sélectionner les métriques**, cochez celles que vous souhaitez combiner. Elles sont regroupées en **Conversations** (conversations, messages, transferts), **Intelligence artificielle** (résolution IA, contention), **Performance** (temps de réponse et de résolution), **CRM** (leads, taux de conversion, valeur du pipeline) et **Opérations** (rendez-vous, absences, campagnes, CSAT).
6. Ajustez la **Plage de dates** et vérifiez l'**Aperçu**.
7. Cliquez sur **Enregistrer**.

Vos rapports enregistrés restent sur la même page, prêts à être consultés quand vous le souhaitez. Chacun dispose d'options pour **Modifier**, **Dupliquer** (utile pour créer des variantes) et **Supprimer**.

## Comment recevoir des rapports automatiques par e-mail

Vous pouvez recevoir un résumé de vos indicateurs dans votre boîte mail, sans entrer dans le panneau :

1. Allez dans **Paramètres → Gouvernance et alertes → Alertes système**.
2. Descendez jusqu'à **Rapports programmés**.
3. Choisissez l'une des fréquences et heures d'envoi disponibles pour votre compte.
4. Dans **Destinataires**, saisissez les adresses e-mail séparées par des virgules.
5. Cochez la case **Activé** et cliquez sur **Enregistrer les modifications**.

En dessous, vous verrez la date du dernier envoi. Si l'option manque, vérifiez sa disponibilité dans **Forfait et facturation**.

Sur cette même page, vous pouvez créer des **alertes système** : des notifications par e-mail lorsqu'une métrique dépasse un seuil que vous définissez (conversations actives, messages du jour, escalades, entre autres). La plateforme les évalue automatiquement.

## Questions fréquentes

**Qui peut voir les analyses ?**
Les administrateurs et les superviseurs peuvent accéder à ces vues. Les agents n'ont pas d'accès direct aux pages d'analyse.

**Pourquoi un onglet affiche-t-il « aucune donnée » ?**
La période choisie ne comporte aucune activité. Élargissez la plage de dates (par exemple, de 7 à 30 jours) ou vérifiez que vos canaux sont connectés et reçoivent bien des conversations.

**Puis-je télécharger les données ?**
Oui : utilisez **Exporter CSV** dans la Vue d'ensemble des Analyses, ou configurez les **Rapports programmés** pour les recevoir par e-mail.

**Les rapports programmés sont-ils disponibles pour mon compte ?**
L'écran et **Forfait et facturation** indiquent la disponibilité actuelle. Les vues consultables restent visibles selon votre rôle et votre configuration.

**Comment améliorer mon CSAT ?**
Lisez les **Commentaires récents** de l'onglet CSAT : c'est là que vos clients vous disent quoi ajuster. Il est souvent utile d'affiner le ton de l'agent IA, de compléter votre base de connaissances et de répondre rapidement aux conversations escaladées.

Besoin de plus d'aide ? Écrivez-nous sur https://parallly-chat.cloud/support
