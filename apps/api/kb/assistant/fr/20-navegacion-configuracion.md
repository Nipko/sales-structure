---
id: navegacion-configuracion
title: "Navigation, menu et Paramètres"
routes: ["/admin", "/admin/settings"]
roles: ["tenant_admin", "tenant_supervisor", "tenant_agent"]
keywords: ["menu", "navigation", "barre laterale", "sections", "replier", "deplier", "favoris", "recents", "rechercher", "commandes", "parametres", "retour", "visite guidee", "essentiels pour votre agent", "assistant de configuration", "montrez-moi comment", "aide de l ecran"]
---

# Navigation, menu et Paramètres

La barre latérale organise Parallly par objectif en ces sections : **Essentiels**, **Clients**, **Commercial**, **Travail quotidien**, **Catalogue et ressources**, **IA et croissance**, **Insights** et **Administration**. **Paramètres** reste en bas afin de conserver un emplacement stable. Les options visibles peuvent varier selon votre rôle, votre forfait et votre type d'activité. Il n'existe pas de section « Opérations » dans la barre de l'entreprise.

## Ce que vous trouvez dans chaque section

- **Essentiels** — Accueil et Conversations (la boîte de réception).
- **Clients** — CRM (vos contacts) et Organisations.
- **Commercial** — l'Entonnoir de ventes et les Offres.
- **Travail quotidien** — les enregistrements que vous traitez chaque jour : Rendez-vous et, selon votre type d'activité, séjours, commandes, ordres d'atelier, dossiers, cours, séances photo, adhésions et similaires.
- **Catalogue et ressources** — ce qui configure ces enregistrements (biens, annonces, véhicules, menu, programmes, forfaits et services, inventaire…). C'est un travail pour les administrateurs et superviseurs.
- **IA et croissance** — Agent IA, Procédures, Base de connaissances, Automatisation et Campagnes.
- **Insights** — Analyses, Ventes, Santé des agents et Performance des agents.
- **Administration** — Canaux, Utilisateurs, Conformité, Facturation et Améliorations.

## Le nom de certaines options change selon votre type d'activité

Parallly adapte certains libellés du menu au vocabulaire de votre métier. L'écran est le même ; seul le nom change :

- L'**Entonnoir de ventes** peut s'appeler **Opportunités**, **Négociations**, **Suivi** ou **Ventes**.
- **Rendez-vous** peut apparaître comme **Agenda** ou **Réservations**, et dans certains métiers il n'apparaît pas parce que l'entreprise ne prend pas de rendez-vous.
- Les écrans propres à un métier (Ordres d’atelier, Dossiers, Réservations de tours, Forfaits et services, Véhicules…) n'apparaissent que si votre type d'activité les utilise.

Si vous ne trouvez pas quelque chose sous son nom générique, cherchez par fonction avec la recherche de commandes (`Ctrl+K`) ou ouvrez **Travail quotidien**.

## Se déplacer sans perdre le contexte

- Cliquez sur le nom d'une section pour la replier ou la déplier.
- Utilisez la recherche de commandes avec `Ctrl+K` ou `⌘K` pour ouvrir un écran par son nom.
- Ajoutez les pages fréquentes aux favoris ; les éléments récents permettent de reprendre votre travail.
- Dans **Paramètres**, utilisez le contrôle de retour ou le chemin visible pour revenir à l'index. Le bouton Retour du navigateur doit également revenir à l'écran précédent, pas au tableau de bord.

Si une option manque, vérifiez d'abord votre rôle, le type d'activité de l'entreprise et les fonctions activées dans **Administration → Facturation** (l'écran s'intitule **Forfait et facturation**). Ne modifiez pas un réglage uniquement pour faire apparaître une option sans l'accord d'un administrateur.

## Paramètres : « Essentiels pour votre agent »

L'écran **Paramètres** commence par un bandeau **Essentiels pour votre agent** : les réglages qui changent vraiment la façon dont l'agent répond, en haut et sans les chercher.

- **Informations de l'entreprise** — ce que fait votre entreprise, adresse, téléphone et e-mail de contact.
- **Horaires** — quand l'entreprise est ouverte (la disponibilité pour les rendez-vous se définit à part, dans Rendez-vous).
- **Équipe** — qui reçoit les conversations quand l'agent les transfère à une personne. Ce lien mène à l'écran **Utilisateurs** de la barre latérale.
- **Assistant de configuration** — rouvre l'assistant **Faites connaissance avec votre agent** à l'étape où vous vous êtes arrêté, sans rien perdre.

Les autres sections suivent en dessous. Ce qui est technique (webhooks, MCP, clés d'API) reste replié dans **Pour les développeurs** : si vous ne l'avez jamais ouvert, vous n'en avez pas besoin.

## Aide sur chaque écran et « Montrez-moi comment »

Presque tous les écrans disposent d'un panneau d'**Aide** : ce qu'est cet écran, en deux phrases, et les étapes dans l'ordre réel des clics. Lorsqu'un parcours existe pour cet écran, le panneau affiche en plus un bouton **Montrez-moi comment** qui lance le parcours guidé : il met en évidence, étape par étape, où chaque chose se fait. Le parcours **ne modifie** aucun réglage ; il vous amène seulement à l'endroit exact et vous décidez.

La visite de configuration s'ancre sur les éléments visibles du menu. Si la barre est repliée, ouvrez-la avant de relancer la visite afin que chaque étape reste alignée.
