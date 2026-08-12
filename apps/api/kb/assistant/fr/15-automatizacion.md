---
id: automatizacion
title: "Automatisations et suivi"
routes: ["/admin/automation", "/admin/automation/drip-sequences", "/admin/automation/templates"]
roles: ["tenant_admin", "tenant_supervisor"]
keywords: ["automatisation", "automatisations", "règles", "règle automatique", "déclencheur", "trigger", "conditions", "actions", "séquence", "drip", "nurturing", "suivi", "suivi automatique", "flux", "constructeur visuel", "modèles d'automatisation", "messages automatiques", "rappel", "réactivation", "panier abandonné", "bienvenue"]
---

# Automatisations et suivi

Les automatisations font en sorte que Parallly travaille pour vous : lorsqu'il se passe quelque chose dans votre entreprise (un lead arrive, un client cesse de répondre, quelqu'un change d'étape), la plateforme exécute des actions automatiques. Dans **IA et croissance**, vous trouverez **Automatisation**, **Séquences Drip** et **Modèles** :

- **Règles** : « quand X se produit, fais Y » (une seule fois par événement).
- **Séquences Drip** : séries de messages de suivi avec des délais d'attente entre chacun.
- **Modèles** : automatisations prêtes à installer, organisées par secteur d'activité.

> Les rôles **administrateur** et **superviseur** peuvent les configurer. Les agents ne gèrent pas les automatisations, mais ils en voient les effets (par exemple, des tâches ou des conversations assignées).

## Comment créer une règle d'automatisation

1. Allez dans **Automatisation** dans la barre latérale et cliquez sur **Nouvelle règle**.
2. **Déclencheur** — choisissez quel événement active la règle :
   - **Lead capturé** : lorsqu'un nouveau lead entre dans le système.
   - **Nouveau message** : lorsqu'un message du client est reçu.
   - **Conversation assignée** : lorsqu'une conversation est assignée à un agent.
   - **SLA dépassé** : lorsque le temps de réponse est dépassé.
   - **Inactivité** : lorsque le client ne répond pas.
   - **Changement d'étape** : lorsqu'un lead change d'étape dans l'entonnoir.
3. **Conditions** — filtres optionnels avec **Ajouter une condition**. Vous pouvez filtrer par **Canal**, **Étape**, **Score**, **Étiquette**, **Source** ou **ID de campagne**, avec des opérateurs comme « est égal à », « contient », « supérieur à ». Toutes les conditions doivent être remplies en même temps ; si vous n'en ajoutez aucune, la règle s'exécute chaque fois que le déclencheur se produit.
4. **Actions** — avec **Ajouter une action**, définissez ce que fait la règle :
   - **Envoyer un modèle WhatsApp**
   - **Créer une tâche de suivi**
   - **Changer l'étape du pipeline**
   - **Ajouter une étiquette**
   - **Assigner à un agent**
   Chaque action dispose d'un champ **Délai (secondes)** au cas où vous voudriez qu'elle s'exécute après un temps d'attente plutôt qu'immédiatement.
5. À l'étape **Résumé**, donnez-lui un nom clair (ex. « Auto-assigner les nouveaux leads »), activez **Activer la règle immédiatement** si vous voulez qu'elle commence à fonctionner tout de suite, puis cliquez sur **Enregistrer la règle**.

Vous pouvez activer ou désactiver n'importe quelle règle depuis la liste sans la supprimer, et consulter l'**Historique des exécutions** pour voir quand elle s'est déclenchée et si une action a échoué (les envois échoués sont réessayés automatiquement).

## Comment utiliser le constructeur visuel

Si vous préférez voir votre automatisation sous forme de diagramme plutôt qu'avec l'assistant étape par étape :

1. Dans **Automatisation**, cliquez sur **Constructeur visuel**.
2. Construisez le flux sur le canevas en reliant des blocs **Déclencheur**, **Condition**, **Action** et **Attente**. Les conditions divisent le flux en branches **Oui** / **Non**.
3. Enregistrez avec **Enregistrer**. Une règle créée dans le constructeur visuel peut continuer à être modifiée avec **Modifier avec l'assistant**, et vice versa : c'est la même règle vue de deux façons.

> Si **HTTP Request** est activé pour votre compte, une règle peut avertir un autre système de l'entreprise. Traitez-le comme une intégration technique et testez-le avec des données non sensibles.

## Comment créer une séquence de suivi (Drip)

Les **Séquences Drip** envoient plusieurs messages espacés dans le temps : idéales pour relancer des leads qui n'ont pas répondu, accueillir de nouveaux clients ou assurer un suivi après-vente.

1. Allez dans **Automatisation → Séquences Drip** et cliquez sur **Nouvelle séquence**.
2. Saisissez un **Nom** (ex. « Bienvenue nouveaux leads ») et choisissez le **Déclencheur** qui inscrit le contact :
   - **Lead capturé**
   - **Changement d'étape**
   - **Étiquette ajoutée**
   - **Inscription manuelle** (vous ajoutez des contacts avec **Inscrire un contact**)
3. Avec **Ajouter une étape**, créez chaque message. Chaque étape comporte :
   - **Attente** : combien de temps attendre avant de l'envoyer (**Minutes**, **Heures** ou **Jours**).
   - **Type de message** : **Modèle WhatsApp**, **Message personnalisé** ou **Généré par l'IA** (l'agent rédige le message selon le contexte de ce lead).
4. Dans **Arrêter si**, utilisez **Le contact répond** pour ne pas insister auprès de quelqu'un qui vous parle déjà. Si le client demande à ne plus recevoir de messages (opt-out), la plateforme arrête également les envois. L'option visible **Le contact convertit** n'est pas encore appliquée automatiquement dans cette version : désinscrivez manuellement le contact après sa conversion.
5. Activez la séquence avec l'interrupteur **Active**.

Sur chaque carte, vous verrez le compteur **Inscrits** : combien de contacts se trouvent dans ce flux en ce moment.

**Exemple de séquence courte (3-4 étapes fonctionne mieux que 8) :**

- Jour 0 — « Bonjour {{nombre}}, merci pour votre intérêt… »
- Jour 2 — message de valeur (avantage, financement, nouveauté)
- Jour 5 — invitation concrète (« On planifie un appel ? Répondez OUI »)

## Comment installer un modèle prêt à l'emploi

1. Allez dans **Automatisation → Modèles**.
2. Utilisez le moteur de recherche et les filtres **Catégorie** et **Secteur** pour trouver le plus adapté. Il existe des modèles de **Nutrition de leads**, **Rappels de rendez-vous**, **Panier abandonné**, **Séquence de bienvenue**, **Réactivation**, **Collecte de feedback**, **Traitement VIP** et **Hors horaires**. Si votre activité relève de la santé, de l'immobilier, de la restauration, etc., vous verrez d'abord ceux de votre secteur.
3. Cliquez sur **Installer** : une fenêtre vous montre le déclencheur, les actions et les **Variables** que vous pouvez ajuster (textes, délais) avant de confirmer avec **Installer le modèle**.
4. Une fois terminé, utilisez **Voir les règles** pour accéder directement à vos règles. La règle installée reste **inactive** par défaut : vérifiez les textes et activez-la lorsque vous êtes prêt.

## Disponibilité et capacité

L'écran indique si les règles, séquences et **HTTP Request** sont activés, ainsi que l'utilisation actuelle. Consultez les limites en vigueur dans **Forfait et facturation**.

## Questions fréquentes

**Quelle est la différence entre une règle et une séquence drip ?**
Une règle réagit une fois à un événement (« nouveau lead → assigner un agent »). Une séquence drip envoie plusieurs messages sur plusieurs jours, avec des délais entre chacun, et peut s'arrêter si le contact répond ou demande à ne plus recevoir de messages.

**J'ai créé une règle et rien ne se passe, que dois-je vérifier ?**
Vérifiez d'abord qu'elle est **Active** (les modèles s'installent inactifs par défaut). Ensuite, examinez les conditions : elles doivent toutes être remplies en même temps, et une condition mal définie (par exemple, un canal que vous n'utilisez pas) bloque la règle. L'**Historique des exécutions** vous indique si la règle s'est déclenchée et quel résultat elle a eu.

**Puis-je mettre en pause une séquence sans la supprimer ?**
L'interrupteur **Active/Inactive** empêche les nouvelles inscriptions, mais des étapes déjà planifiées peuvent continuer pour les contacts inscrits dans cette version. Utilisez **Désinscrire** pour ces contacts avant de désactiver la séquence.

**Les automatisations peuvent-elles écrire à n'importe quel contact à n'importe quelle heure ?**
Elles envoient selon les délais que vous configurez, en respectant toujours les opt-outs. Sur WhatsApp, les messages en dehors de la fenêtre de conversation requièrent des modèles approuvés, c'est pourquoi le type d'étape **Modèle WhatsApp** est le plus sûr pour les suivis sur plusieurs jours.

**Je ne vois pas ces options.**
Vérifiez votre rôle et consultez **Forfait et facturation** pour confirmer que la fonction est activée pour votre compte.

Des questions ? Écrivez-nous sur https://parallly-chat.cloud/support
