---
id: crm-contactos
title: "Contacts et CRM"
routes: ["/admin/contacts", "/admin/contacts/segments", "/admin/identity", "/admin/settings/custom-attributes"]
roles: ["tenant_admin", "tenant_supervisor", "tenant_agent"]
keywords: ["contacts", "crm", "prospects", "leads", "clients", "score", "scoring", "étapes", "segments", "filtres", "importer", "exporter", "csv", "excel", "doublons", "fusionner", "fusion", "archiver", "actions groupées", "attributs personnalisés", "champs personnalisés", "vip"]
---

# Contacts et CRM

Le CRM de Parallly est l'endroit où vivent tous vos contacts : chaque personne qui vous écrit via WhatsApp, Instagram, Messenger, Telegram ou le chat de votre site web y est enregistrée automatiquement, avec son historique complet. Vous pouvez aussi ajouter des contacts à la main ou les importer depuis Excel.

Vous le trouvez dans la barre latérale : ouvrez **CRM** et entrez dans la première option, **CRM**. Vous arriverez sur la page **Contacts**, avec un tableau qui affiche le nom, le canal, les conversations, la valeur, la dernière interaction, le score, l'étape et les tags. En haut, vous disposez de puces rapides pour filtrer par groupe : **Tous**, **Nouveaux**, **Prospects**, **Qualifiés**, **Clients** et **Perdus**, ainsi qu'une barre de recherche.

Tous les rôles peuvent voir, créer et modifier des contacts. L'archivage et les actions groupées sont réservés aux administrateurs et aux superviseurs.

## Comment créer un contact manuellement

1. Sur **Contacts**, cliquez sur **Ajouter un contact**.
2. Remplissez le formulaire **Nouveau contact** : **Prénom**, **Nom**, **Téléphone** (obligatoire), **Email** et **Étape** initiale.
3. Cliquez sur **Créer le contact**.

> Le téléphone est nettoyé et normalisé automatiquement au format international (fonctionne avec les numéros de Colombie, d'Argentine, du Mexique, du Brésil, du Chili, du Pérou, d'Équateur et des États-Unis/Canada). Vous pouvez saisir `3001234567` ou `+573001234567` : les deux sont correctement enregistrés.

## Le détail du contact (fiche 360°)

Cliquez sur n'importe quel contact pour ouvrir sa fiche complète :

- **Modifier** : avec le bouton **Modifier**, vous changez le nom, l'email, le téléphone, l'étape, la marque **VIP** et les **Tags** directement dans la fiche. Enregistrez avec **Enregistrer**.
- **Détail du score** : cliquez sur le score pour voir les 5 facteurs qui le composent — **Récence**, **Engagement**, **Intention**, **Étape** et **Profil**.
- **AI Insights** : analyse automatique du comportement du contact (probabilité de conclusion, meilleure action suivante, signaux détectés).
- **Champs personnalisés** : les attributs supplémentaires que vous avez définis pour votre activité (voir plus bas).
- **Opportunités** : les affaires ouvertes de ce contact dans l'entonnoir.
- Onglets **Historique** (chronologie d'activité), **Notes** (annotations internes de l'équipe) et **Tâches** (suivis, appels, réunions).

### Qu'est-ce que le score ?

C'est une note qui classe vos contacts selon leur degré de « chaleur » : à quel point leur dernière interaction est récente, combien ils échangent, quels mots d'achat ils emploient, à quelle étape ils se trouvent et à quel point leur profil est complet. Les administrateurs et les superviseurs peuvent ajuster le poids de chaque facteur dans **Paramètres → Lead scoring**, y compris le déclin (le score baisse tout seul si le contact reste plusieurs jours sans activité).

### Étapes

Chaque contact a une étape de vente (nouveau, contacté, qualifié, gagné, perdu…). Les étapes sont les mêmes que celles de votre entonnoir et se personnalisent dans **Paramètres → Étapes du pipeline**. Vous pouvez la changer depuis la fiche du contact ou laisser l'agent IA la faire avancer tout seul (voir l'article sur l'Entonnoir de ventes).

## Comment utiliser les filtres avancés

1. Sur **Contacts**, ouvrez **Filtres avancés**.
2. Combinez des critères : **Plage de score** (minimum et maximum), **Plage de dates**, **Filtrer par tags**.
3. Cliquez sur **Appliquer les filtres**. Avec **Effacer les filtres**, vous revenez à la liste complète.

## Comment importer des contacts depuis Excel ou CSV

1. Sur **Contacts**, cliquez sur **Importer**.
2. Dans la fenêtre **Importer des contacts**, glissez votre fichier Excel (.xlsx, .xls) ou CSV, cliquez pour le rechercher sur votre ordinateur, ou copiez-collez les cellules directement.
3. Si vous préférez, utilisez **Télécharger le modèle CSV** pour partir d'un modèle avec les bonnes colonnes et une feuille d'instructions.
4. Cliquez sur **Importer**. À la fin, vous verrez le résumé : **Importés**, **Ignorés** et **Erreurs** (avec le détail de chaque ligne posant problème).

Détails utiles sur le format :

- La seule colonne obligatoire est le **téléphone** (c'est l'identifiant unique du contact).
- Les colonnes acceptent des synonymes en espagnol et en anglais (ex. « telefono », « celular », « phone ») et le séparateur peut être une virgule ou un point-virgule.
- Colonnes optionnelles : prénom, nom, email, étape, entreprise, source, es_vip, canal préféré et attributs de campagnes (UTM).
- Si vous incluez la colonne d'étape, les valeurs valides sont : `nuevo`, `contactado`, `respondio`, `calificado`, `tibio`, `caliente`, `listo_cierre`, `ganado`, `perdido`, `no_interesado`.

## Comment exporter vos contacts

Sur **Contacts**, cliquez sur **Exporter**. Un fichier Excel se télécharge avec tous vos contacts, prêt à ouvrir ou à partager.

## Actions groupées

Pour les administrateurs et les superviseurs :

1. Cochez les cases des contacts souhaités (vous verrez combien vous en avez **sélectionnés**).
2. Dans la barre qui apparaît en bas, choisissez l'action : **Changer l'étape**, **Ajouter un tag** ou **Archiver**.
3. Complétez la donnée (la nouvelle étape ou le nom du tag) et cliquez sur **Appliquer**.

## Comment archiver un contact

Archiver retire le contact de vos listes et de l'entonnoir (par exemple, des contacts de test ou qui ont demandé à ne pas être contactés).

1. Ouvrez la fiche du contact et cliquez sur **Archiver**.
2. Confirmez dans la fenêtre **Archiver le contact**.

Vous pouvez aussi en archiver plusieurs à la fois avec les actions groupées. Considérez-le comme une action définitive : vérifiez bien avant de confirmer.

## Segments enregistrés

Un segment est un groupe de contacts défini par des filtres qui se met à jour tout seul : « prospects chauds », « clients VIP d'Instagram », etc. Ils servent, par exemple, à choisir l'audience d'une campagne.

1. Sur **Contacts**, cliquez sur **Segments** (ou entrez sur la page Segments du CRM).
2. Cliquez sur **Nouveau segment**.
3. Donnez-lui un **Nom** (ex. « Prospects chauds ») et une **Description** optionnelle.
4. Avec **Ajouter filtre**, combinez des critères : **Étape**, **Score**, **Téléphone**, **Email**, **Source**, **VIP** ou **Date de création**, avec des opérateurs comme « égal à », « supérieur à » ou « contient ».
5. Utilisez l'**Aperçu** pour voir combien de contacts correspondent et cliquez sur **Créer segment**.

## Attributs personnalisés

Si vous devez enregistrer des données propres à votre activité (anniversaire, taille, numéro de police…), créez des champs sur mesure. Disponible pour les administrateurs et les superviseurs :

1. Allez dans **Paramètres → CRM et opérations → Attributs personnalisés**.
2. Cliquez sur **Nouvel attribut**.
3. Choisissez le **Type d'entité** (Contact, Lead, Entreprise ou Conversation), saisissez le **Libellé** (ex. « Anniversaire ») et le **Type de données** : Texte, Nombre, Date, Booléen, Liste (avec des options séparées par des virgules) ou URL. Vous pouvez le marquer comme **Champ obligatoire**.
4. Enregistrez. Le champ apparaîtra dans la section **Champs personnalisés** de la fiche de chaque contact.

## Contacts en double : fusion automatique et manuelle

Si la même personne vous écrit via deux canaux avec le même téléphone ou email, Parallly réunit les profils automatiquement. Pour les cas que le système ne peut pas résoudre seul, les administrateurs et les superviseurs disposent de la page **Identité** (saisissez `/admin/identity` à la fin de l'adresse de votre panneau) :

- **Suggestions automatiques** : des paires de contacts très similaires détectées par le système, avec leur niveau de **Confiance**. Examinez chaque paire et choisissez **Approuver** (ils sont fusionnés) ou **Rejeter**.
- **Fusion manuelle** : recherchez et sélectionnez le premier et le second contact, puis cliquez sur **Fusionner les contacts**. Ils sont réunis en un seul profil avec tout leur historique.

## Capacité du CRM

L'écran affiche l'utilisation et les limites actuelles des contacts, segments et attributs. Si vous approchez de la capacité, consultez **Forfait et facturation**.

## Questions fréquentes

**Les contacts se créent-ils tout seuls ?**
Oui. Chaque personne qui vous écrit via n'importe quel canal connecté est enregistrée automatiquement avec sa conversation. Créer à la main ou importer sert uniquement aux contacts qui ne vous ont pas encore écrit.

**Pourquoi un contact a-t-il un score bas s'il m'a acheté il y a plusieurs mois ?**
Le score récompense l'activité récente : si vous avez configuré le déclin, il baisse au fil des jours sans interaction. Vous pouvez ajuster les poids dans **Paramètres → Lead scoring**.

**Que se passe-t-il si j'importe un téléphone qui existe déjà ?**
Le téléphone est l'identifiant unique : la ligne est marquée comme ignorée ou met à jour le contact existant, aucun doublon n'est créé. Le résumé de l'importation vous en montre le détail.

**Puis-je annuler une fusion de contacts ?**
Pas depuis le panneau. Avant d'approuver une suggestion ou de fusionner manuellement, examinez bien les deux profils. Si vous avez fusionné par erreur, écrivez-nous au support.

**Qui peut archiver ou effectuer des changements groupés ?**
Uniquement les administrateurs et les superviseurs. Les agents peuvent voir, créer et modifier les contacts.

**Besoin de plus d'aide ?** Écrivez-nous sur https://parallly-chat.cloud/support
