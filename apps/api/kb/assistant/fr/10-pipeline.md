---
id: pipeline
title: "Entonnoir de ventes (pipeline)"
routes: ["/admin/pipeline", "/admin/settings/pipeline"]
roles: ["tenant_admin", "tenant_supervisor", "tenant_agent"]
keywords: ["entonnoir", "pipeline", "tunnel de vente", "kanban", "étapes", "opportunités", "affaires", "deals", "avancement automatique", "avancement auto", "approbation", "approuver affaire", "probabilité", "couleur d'étape", "glisser carte", "gagné", "perdu", "resynchroniser", "conditions de transition"]
---

# Entonnoir de ventes (pipeline)

L'entonnoir de ventes est votre tableau kanban d'opportunités : chaque carte est une affaire en cours liée à un contact, et les colonnes sont les étapes de votre processus de vente. Vous le trouvez dans la barre latérale, sous **Entonnoir de ventes**.

Pour éviter de dupliquer l'information, le tableau affiche **une carte par contact**, même si cette personne a plusieurs conversations avec vous.

## Ce que vous voyez sur le tableau

- **Indicateurs en haut** : **Valeur totale** (somme de toutes les opportunités ouvertes), **Pondéré** (valeur ajustée par la probabilité de clôture de chaque étape), **Opportunités** et **Moyen**.
- **Colonnes** : vos étapes, chacune avec sa couleur et ses cartes.
- **Cartes** : en cliquant sur une carte, son détail s'ouvre, avec la valeur, la probabilité, les jours passés dans l'étape, l'historique des étapes, le responsable assigné et des raccourcis vers **Voir la conversation** et **Voir le contact**.

## Comment déplacer une opportunité d'étape

1. Ouvrez **Entonnoir de ventes**.
2. Faites glisser la carte vers la colonne de destination et déposez-la.
3. Vous verrez la confirmation « Opportunité déplacée vers… ». Tout membre de l'équipe peut déplacer des cartes.

Si l'étape de destination a des conditions configurées (par exemple, que le contact ait une adresse e-mail enregistrée), le système ne laissera pas passer la carte tant qu'elles ne sont pas remplies et vous indiquera exactement ce qu'il manque.

## Comment créer une opportunité manuellement

La plupart des opportunités se créent d'elles-mêmes à partir de vos conversations, mais vous pouvez aussi les ajouter à la main :

1. Dans **Entonnoir de ventes**, cliquez sur **Nouvelle opportunité**.
2. Remplissez le formulaire : **Contact**, **Titre**, **Valeur ($)**, **Étape** et **Notes**.
3. Enregistrez. La carte apparaît dans l'étape que vous avez choisie.

## Comment personnaliser les étapes (ordre, couleur et probabilité)

Seuls les administrateurs et les superviseurs peuvent le faire :

1. Dans **Entonnoir de ventes**, cliquez sur **Personnaliser les étapes** (ou allez dans **Paramètres → Étapes du pipeline**).
2. **Réordonner** : faites glisser les étapes à la position souhaitée.
3. Pour chaque étape, vous pouvez modifier le **Nom**, la **Couleur** et la **Probabilité** de clôture (ce pourcentage alimente l'indicateur **Pondéré** du tableau).
4. Marquez les étapes de clôture comme **Étape finale (fermée)** — par exemple, Gagné ou Perdu — et laissez les autres en **Étape active**.
5. Utilisez **Ajouter une étape** pour en créer de nouvelles (le maximum dépend de votre plan) ou l'icône de suppression pour les retirer.
6. Enregistrez les modifications.

Vous préférez partir d'une base pensée pour votre secteur ? Cliquez sur **Charger les préréglages du secteur** : cela remplace vos étapes par celles standard de votre vertical (pensez à enregistrer ensuite). Vous avez aussi **Restaurer les valeurs par défaut** pour revenir à la configuration initiale.

### Conditions de transition (facultatif)

Dans **Paramètres → Étapes du pipeline**, chaque étape dispose d'une section **Conditions de transition** : les prérequis que le contact doit remplir pour pouvoir entrer dans cette étape. Vous pouvez exiger, par exemple :

- E-mail, téléphone ou nom complet enregistrés.
- Un score minimum du lead.
- Un conseiller humain assigné.
- Un rendez-vous planifié ou un devis commercial actif.
- Une donnée personnalisée avec une certaine valeur (par exemple, « ville = Bogota »).

Ces conditions s'appliquent aussi bien aux déplacements manuels qu'à l'avancement automatique.

## Avancement automatique selon les signaux de la conversation

Parallly peut faire avancer les opportunités dans l'entonnoir sans que personne ne touche au tableau : le système analyse les signaux de chaque conversation (intérêt, questions sur le prix, intention d'achat) et fait avancer la carte vers l'étape qui correspond.

- **Activer ou désactiver** : en haut de **Entonnoir de ventes** se trouve l'interrupteur **Avancement auto** (visible pour les administrateurs et les superviseurs ; il apparaît aussi dans **Paramètres → Étapes du pipeline** sous **Avancement automatique des étapes**). Désactivez-le si vous préférez gérer les étapes 100 % à la main ; vous pouvez le réactiver quand vous le souhaitez.
- **Resynchroniser** : le bouton **Resynchroniser** (à côté de l'interrupteur) réaligne les opportunités existantes sur leur étape correcte. Utilisez-le après avoir modifié vos étapes ou activé l'avancement auto, et vous verrez combien d'opportunités ont été ajustées.

L'avancement automatique respecte vos conditions de transition : s'il manque un prérequis, la carte n'avance pas.

## État de l'approbation des affaires

L'interface contient des éléments d'approbation, mais **le circuit de demande, révision et blocage des étapes finales n'est pas certifié de bout en bout dans la version actuelle**. Ne l'utilisez pas comme contrôle financier ou d'audit : un déplacement direct peut changer l'étape sans terminer cette révision. Tant que le panneau n'indique pas que ce flux est disponible, réservez opérationnellement les clôtures aux administrateurs/superviseurs et vérifiez l'historique de chaque opportunité.

## Foire aux questions

**Qui peut déplacer les cartes et qui peut modifier les étapes ?**
Déplacer les cartes : toute l'équipe (administrateur, superviseur et agents). Personnaliser les étapes, les conditions et l'interrupteur d'avancement auto : uniquement les administrateurs et les superviseurs.

**J'ai activé l'avancement auto mais mes opportunités restent au même endroit. Que faire ?**
Cliquez sur **Resynchroniser** dans l'en-tête de l'entonnoir : l'avancement auto agit sur les nouvelles conversations, et la resynchronisation replace les opportunités qui existaient déjà.

**Puis-je supprimer une opportunité ?**
Depuis son détail, vous pouvez utiliser **Archiver** : l'opportunité est marquée comme perdue et cesse d'apparaître sur le tableau.

**Pourquoi ne puis-je pas faire glisser une carte vers une certaine étape ?**
Cette étape a des conditions de transition non remplies (e-mail, téléphone, score minimum, rendez-vous, etc.). Le message d'erreur vous indique exactement ce qu'il manque ; complétez cette donnée dans la fiche du contact et réessayez.

**Que signifie la valeur « Pondéré » ?**
C'est la somme de chaque opportunité multipliée par la probabilité de son étape. C'est pourquoi il vaut mieux attribuer des probabilités réalistes lorsque vous personnalisez vos étapes.

**Où configure-t-on le score de mes leads ?**
Dans **Paramètres → Lead Scoring**, vous pouvez ajuster les pondérations, les mots-clés d'achat et la décroissance liée à l'inactivité.

Besoin d'aide ? Écrivez-nous sur https://parallly-chat.cloud/support
