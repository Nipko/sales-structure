---
id: broadcast
title: "Campagnes et diffusion (broadcast)"
routes: ["/admin/broadcast", "/admin/channels/whatsapp/templates", "/admin/contacts/segments"]
roles: ["tenant_admin", "tenant_supervisor"]
keywords: ["campagne", "campagnes", "broadcast", "diffusion", "envoi de masse", "messages de masse", "whatsapp de masse", "modèle", "modèles whatsapp", "template", "segment", "destinataires", "audience", "programmer un envoi", "promotions", "marketing", "livré", "lu", "test a/b", "numéro expéditeur"]
---

# Campagnes et diffusion (broadcast)

La section **IA et croissance → Campagnes** regroupe les brouillons, audiences, états et métriques des envois en masse. Les administrateurs et superviseurs peuvent y accéder lorsque la fonction est activée pour le compte.

## Disponibilité dans cette version

Le lancement depuis l'éditeur **n'est pas certifié de bout en bout pour la production** :

- Pour WhatsApp, l'éditeur actuel ne relie pas de manière sûre le texte saisi au nom et aux composants exacts d'un modèle approuvé par Meta. Un envoi peut échouer même si le texte semble correct.
- Une campagne programmée ne dispose d'aucune action opérationnelle d'annulation avant sa prise en charge par le processus automatique.
- L'Email de campagne ne certifie pas Email comme canal conversationnel et ne fournit pas de connexion Email en libre-service.

Pour l'instant, utilisez l'écran pour préparer des brouillons, vérifier les segments et consulter des résultats déjà enregistrés. **N'utilisez pas Envoyer maintenant et ne programmez pas de campagne de production** tant que le panneau ne propose pas un sélecteur vérifié de modèle/expéditeur et une action d'annulation. Coordonnez un test contrôlé avec le support avant tout envoi réel.

## Préparer un brouillon sûr

1. Allez dans **IA et croissance → Campagnes** et créez une campagne.
2. Donnez-lui un nom interne.
3. Choisissez **Tous les contacts** ou un **Segment** créé dans **CRM → Segments**.
4. Vérifiez le nombre de destinataires et les désabonnements.
5. Enregistrez le brouillon sans date d'envoi.

N'insérez pas de données sensibles dans le nom interne. La disponibilité, les canaux et la capacité actuels apparaissent à l'écran et dans **Administration → Forfait et facturation**.

## Modèles WhatsApp

Chemin : **Canaux → WhatsApp → Voir tous les modèles**.

- Un modèle possède un nom technique, une langue, une catégorie et des composants qui doivent correspondre exactement à ce que Meta a approuvé.
- **Synchroniser depuis Meta** actualise les états affichés dans Parallly.
- Lors de la connexion de WhatsApp, Parallly peut soumettre **4 modèles de départ** : rappel de rendez-vous, confirmation de présence, confirmation de commande et paiement reçu.
- Meta décide d'approuver ou de rejeter chaque modèle et de la durée de l'examen ; Parallly affiche uniquement l'état reçu.

La présence d'un modèle approuvé ne corrige pas à elle seule la limite de l'éditeur de campagnes décrite ci-dessus.

## États et métriques

La liste peut afficher des brouillons et des campagnes déjà traitées avec destinataires, livraisons, lectures, réponses ou échecs. Ces données dépendent des événements transmis par chaque prestataire ; les informations de livraison ou de lecture ne sont pas toujours disponibles.

Les contrôles de variantes A/B sont présents dans l'éditeur, mais leur envoi utilise le même lancement non vérifié. Utilisez-les uniquement comme configuration de brouillon jusqu'à la certification du flux.

## Questions fréquentes

**Puis-je annuler une campagne programmée ?**
Il n'existe aucune action opérationnelle d'annulation dans la version actuelle. Ne programmez donc pas de campagnes de production depuis cet éditeur.

**Puis-je saisir directement le texte du modèle WhatsApp et l'envoyer ?**
Pas de manière sûre dans cette version. WhatsApp exige l'identifiant et les composants exacts d'un modèle approuvé ; l'éditeur n'effectue pas encore cette liaison de bout en bout.

**Combien de temps Meta met-il pour approuver un modèle ?**
Aucun délai n'est garanti. Consultez l'état synchronisé dans **Canaux → WhatsApp**.

**L'Email de campagne active-t-il un canal Email ?**
Non. L'Email conversationnel en libre-service n'est pas certifié actuellement.

**Besoin de plus d'aide ?** Écrivez-nous sur https://parallly-chat.cloud/support
