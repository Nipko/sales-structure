---
id: configuracion-gobierno
title: "Paramètres de l'entreprise, politiques et gouvernance"
routes: ["/admin/settings/business-info", "/admin/settings/localization", "/admin/settings/fiscal", "/admin/settings/business-hours", "/admin/settings/policies", "/admin/settings/alerts", "/admin/compliance", "/admin/settings/media", "/admin/settings/prechat", "/admin/settings/email-templates", "/admin/settings/macros", "/admin/settings/recall", "/admin/settings/public-booking"]
roles: ["tenant_admin", "tenant_supervisor"]
keywords: ["parametres", "entreprise", "informations", "langue", "fuseau horaire", "fiscal", "horaires", "politiques", "alertes", "conformite", "medias", "prechat", "emails", "macros", "memoire", "reservation", "recall", "reengagement"]
---

# Paramètres de l'entreprise, politiques et gouvernance

**Paramètres** regroupe des données qui touchent plusieurs domaines. Les administrateurs contrôlent l'identité, la localisation, les données fiscales, les politiques et les fonctions sensibles. Les superviseurs peuvent utiliser les écrans autorisés pour leur rôle, comme les alertes ou les médias, sans présumer des droits administrateur.

- **Compte et entreprise** : profil, informations de l'entreprise, langue, fuseau horaire, données fiscales et horaires.
- **CRM et conversations** : attributs, pipeline, formulaires pré-chat, macros, mémoire et modèles d'email.
- **Gouvernance et alertes** : politiques consultables par l'agent, conformité, notifications et règles d'alerte.
- **Expérience publique** : médiathèque et configuration de la page publique de réservation.

L'écran fait autorité : si une action n'apparaît pas, votre rôle ou la configuration du compte peut ne pas l'activer. Avant d'enregistrer, vérifiez quels canaux, agents ou automatisations utilisent le réglage. Modifier le fuseau horaire, les horaires, les politiques ou l'identité peut changer les réponses et programmations ; consignez le motif et testez l'agent avant tout changement sensible.

## Réengagement automatique (recall)

Seul un administrateur le configure, dans **Paramètres → Recall automatique** (l'écran s'intitule **Réengagement automatique**), et il apparaît si votre forfait inclut la fonction. Il sert à réécrire aux clients qui ne sont pas revenus : détartrages semestriels, contrôles vétérinaires ou renouvellements.

- **Jours d'inactivité avant réengagement** : délai depuis le dernier rendez-vous terminé (par exemple 180 pour un détartrage semestriel).
- **Jours d'attente entre réengagements** : délai minimum avant de réécrire à la même personne.
- **Canal d'envoi** et **Message** : le canal doit être connecté et actif ; le message accepte les variables `{name}` et `{months}`.

La vérification s'exécute tous les jours à 9 h (heure du serveur) et n'écrit qu'aux contacts qui ont un téléphone, sans désinscription enregistrée, et dont le dernier rendez-vous **marqué comme terminé** dépasse le seuil ; c'est pourquoi il faut terminer les rendez-vous dans **Rendez-vous**. **Envoyer maintenant (test)** lance la même vérification immédiatement et envoie de vrais messages aux contacts éligibles. Si vous avez plusieurs numéros sur le même canal et que Parallly ne peut pas savoir lequel utiliser, il n'envoie rien : il vous laisse une tâche pour choisir le numéro.
