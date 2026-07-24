---
id: base-conocimiento
title: "Base de connaissances de l'agent"
routes: ["/admin/knowledge", "/admin/knowledge/faqs"]
roles: ["tenant_admin", "tenant_supervisor"]
keywords: ["base de connaissances", "connaissance", "knowledge base", "téléverser des documents", "pdf", "faq", "questions fréquentes", "importer une url", "page web", "crawl", "articles", "catégories", "modifier un document", "versions", "qualité", "suggestions", "lacunes", "portail public", "aide aux clients", "l'agent ne sait pas répondre"]
---

# Base de connaissances de l'agent

La base de connaissances est la « mémoire » de votre agent IA : les documents, questions fréquentes et pages que vous ajoutez ici sont les informations avec lesquelles il répond à vos clients. Plus elle est complète et à jour, plus ses réponses sont précises.

Vous la trouvez dans le menu latéral, section **Croissance → Automatisation → Base de connaissances**. À l'intérieur, vous verrez les onglets **Bibliothèque**, **FAQ**, **Rechercher dans le contexte**, **Qualité**, **Analytique** et **Lacunes**.

> Cette section est administrée par les rôles **administrateur** et **superviseur**.

## Ce que votre forfait inclut

| Forfait | Articles / documents | Importation de pages web | Taille max. par document | Analytique des connaissances |
|------|:---:|:---:|:---:|:---:|
| Emprendedor | 5 | Non incluse | 25 000 caractères | Non |
| Starter | 20 | 50 pages | 100 000 caractères | Oui |
| Pro | Illimités | 500 pages | 250 000 caractères | Oui |
| Enterprise | Illimités | Illimitées | 500 000 caractères | Oui |
| Custom | Illimités | Illimitées | Sans limite | Oui |

Si vous atteignez la limite, vous verrez l'avis **Limite de documents atteinte** avec l'option d'améliorer votre forfait.

## Comment ajouter des documents (PDF, Word et plus)

1. Dans l'onglet **Bibliothèque**, cliquez sur **Import en masse**.
2. Cliquez sur **Sélectionner les fichiers**. Formats supportés : **PDF, DOCX, TXT, MD, CSV** (maximum 20 fichiers par lot).
3. Si vous le souhaitez, saisissez une **catégorie** pour tous les fichiers (par exemple, « Tarifs » ou « Politiques »).
4. Cliquez sur **Tout envoyer**.

À la fin, vous verrez un résumé du nombre de fichiers importés avec succès. Chaque document est traité et passe au statut **Prêt** pour que l'agent l'utilise dans ses réponses.

## Comment créer un article en saisissant le texte

1. Dans **Bibliothèque**, cliquez sur **Créer**.
2. Dans la fenêtre **Nouvelle ressource**, saisissez le **Titre de la ressource** et collez ou rédigez le **Contenu texte** (politiques, promotions, manuel interne, ce dont vous avez besoin).
3. Enregistrez et c'est prêt : l'agent peut déjà l'utiliser.

## Comment importer une page web (avec mise à jour automatique)

Disponible à partir du forfait **Starter** :

1. Dans **Bibliothèque**, cliquez sur **Importer URL**.
2. Saisissez l'**URL de la page** (par exemple, la page des questions fréquentes de votre site). Le **Titre** est optionnel : il est détecté automatiquement.
3. Cliquez sur importer. Parallly lit la page et la convertit en un article de votre base de connaissances.

Les pages importées restent à jour toutes seules : **une fois par semaine, la plateforme les vérifie automatiquement** et, si le contenu a changé, met à jour l'article. Vous pouvez aussi le forcer quand vous voulez avec le bouton **Actualiser le contenu** du document — s'il n'y a eu aucun changement, vous verrez « Aucun changement détecté ».

## Comment créer des questions fréquentes (FAQ)

Les FAQ sont des paires question-réponse que l'agent utilise pour donner des réponses exactes, mot pour mot si nécessaire.

1. Ouvrez l'onglet **FAQ**.
2. Cliquez sur **Nouvelle FAQ**.
3. Remplissez **Question** et **Réponse** (obligatoires). Vous pouvez ajouter une **Catégorie**, des **Tags** et l'**Ordre** d'affichage.
4. Laissez activée l'option **Publiée (visible à l'agent)** pour que l'agent l'utilise.
5. Cliquez sur **Enregistrer**.

> Astuce : utilisez les FAQ pour ce qui doit toujours être répondu de la même façon (tarifs, horaires, politiques de retour) et les documents pour des informations plus longues.

## Organiser avec des catégories et des langues

- En créant ou modifiant n'importe quel document, vous pouvez lui attribuer une **catégorie**. Dans **Bibliothèque**, elles apparaissent comme des filtres en un clic pour tout retrouver plus vite.
- La langue de chaque document est **détectée automatiquement**. Si vous avez du contenu en plusieurs langues, un filtre par langue apparaît ; l'agent priorise le contenu de la langue dans laquelle écrit le client.

## Modifier un article et récupérer des versions antérieures

- Pour modifier : dans **Bibliothèque**, cliquez sur le bouton **modifier** (crayon) du document et changez le nom, le contenu ou la catégorie. Enregistrez avec **Enregistrer les modifications**.
- Chaque modification crée une nouvelle version. Avec le bouton **Historique des versions** (icône d'horloge), vous pouvez voir les versions antérieures et cliquer sur **Restaurer** pour revenir à l'une d'elles.

## Qualité et suggestions de l'IA

- Dans l'onglet **Qualité**, chaque document reçoit un score de 0 à 100 selon son contenu, s'il a une catégorie, la fréquence à laquelle il est consulté et sa pertinence dans les réponses. Commencez par améliorer ceux qui sont en rouge.
- Dans l'onglet **Analytique**, la section **Suggestions d'articles (IA)** analyse les questions que vos clients ont posées et auxquelles l'agent n'a pas pu répondre, et vous propose de nouveaux articles avec leur schéma. Cliquez sur **Générer des suggestions**, puis sur **Créer** sur celle que vous voulez rédiger.

## Analytique : ce qui est consulté et ce qui manque

À partir du forfait **Starter**, l'onglet **Analytique** vous montre :

- **Requêtes uniques**, **taux de réussite** et volume quotidien de recherches de l'agent dans votre base de connaissances.
- **Documents les plus consultés** — votre contenu vedette.
- **Questions sans réponse** — ce que les clients ont demandé et que l'agent n'a pas trouvé. De là, vous pouvez **créer un article** en un clic ou les marquer avec **Résoudre**.

## Lacunes : trouvez les trous de votre contenu

L'onglet **Lacunes** organise ce qui nécessite votre attention :

- **Requêtes sans réponse** — créez un article ou une FAQ qui les couvre.
- **Docs à faible satisfaction** — articles ayant reçu des réactions négatives de votre équipe dans l'inbox ; révisez-les et améliorez-les.
- **Docs obsolètes** — contenu qui n'a pas changé depuis longtemps (les tarifs et politiques ont tendance à expirer).

De plus, la section **Santé du KB — Contradictions** détecte les informations qui se contredisent entre vos documents (deux tarifs différents pour la même chose, politiques en conflit). Cliquez sur **Analyser maintenant** et résolvez ce qu'elle trouve.

> Astuce : passez en revue les Lacunes une fois par semaine. Chaque lacune comblée, c'est un client mieux servi.

## Portail public : un centre d'aide pour vos clients

Vous pouvez publier une partie de votre base de connaissances comme un centre d'aide en ligne, sans mot de passe, pour que vos clients consultent par eux-mêmes :

1. Dans **Bibliothèque**, cliquez sur le bouton **Public/Privé** (icône de globe avec cadenas) du document que vous voulez publier. Les documents publiés affichent l'étiquette **Public**.
2. Partagez le lien de votre portail : `https://admin.parallly-chat.cloud/kb/votre-identifiant` (l'identifiant de votre entreprise dans Parallly). Idéal pour le lier depuis votre site web ou sur vos réseaux.

Seuls les documents que vous avez marqués comme publics sont affichés ; tout le reste demeure privé.

## Comment l'agent utilise votre base de connaissances

Quand un client demande quelque chose, l'agent cherche dans vos documents et FAQ les fragments les plus pertinents et construit sa réponse à partir de ces informations — il n'invente pas de données que vous ne lui avez pas fournies. Pour que cela fonctionne :

- Dans **Agent IA**, ouvrez votre agent et, dans ses outils, vérifiez que la carte **Base de connaissances** est activée. Là, vous pouvez aussi ajuster combien de fragments il utilise par réponse et son niveau d'exigence quant à la pertinence.
- Testez ce que l'agent trouverait avec l'onglet **Rechercher dans le contexte** : saisissez une question comme le ferait un client et vous verrez les fragments que l'IA utiliserait, avec leur pourcentage de pertinence. Si rien d'utile n'apparaît, vous tenez là votre prochain article.

## Questions fréquentes

**L'agent répond « je n'ai pas cette information », que faire ?**
C'est le signe qu'il manque du contenu. Saisissez la même question dans **Rechercher dans le contexte** : s'il n'y a aucun résultat, créez un article ou une FAQ qui la couvre. Consultez aussi **Analytique → Questions sans réponse**, où cette requête a été enregistrée.

**Puis-je importer tout mon site web ?**
Vous pouvez importer page par page avec **Importer URL**, jusqu'à la limite de votre forfait (50 pages en Starter, 500 en Pro, sans limite en Enterprise et Custom). Commencez par les pages à plus forte valeur : questions fréquentes, tarifs, politiques.

**Les changements de mon site web se reflètent-ils tout seuls ?**
Oui. Les pages importées sont vérifiées automatiquement chaque semaine et mises à jour si elles ont changé. Si vous avez besoin du changement immédiatement, utilisez **Actualiser le contenu** sur le document.

**Mes clients peuvent-ils voir mes documents internes ?**
Non. Tout est privé sauf ce que vous marquez comme **Public** pour le portail d'aide. L'agent utilise bien tout le contenu (public et privé) pour répondre, mais il ne montre jamais les documents eux-mêmes.

**J'ai modifié un document et c'est devenu pire, puis-je revenir en arrière ?**
Oui. Ouvrez l'**Historique des versions** du document et cliquez sur **Restaurer** sur la version antérieure.

**Pourquoi ne vois-je pas l'onglet Analytique avec des données ?**
L'analytique des connaissances nécessite le forfait **Starter ou supérieur**, et elle commence à se remplir avec les conversations réelles de vos clients. Si vous venez de démarrer, laissez-lui quelques jours.

Besoin de plus d'aide ? Écrivez-nous sur https://parallly-chat.cloud/support
