---
id: probar-agente
title: "Tester votre agent avant de le publier"
routes: ["/admin/agent", "/admin/agent/simulation", "/admin/procedures"]
roles: ["tenant_admin"]
keywords: ["tester agent", "simulation", "simuler conversation", "chat de test", "scenarios", "synthetiques", "historiques", "reference", "regression", "score", "qualite de l'agent", "evaluer agent", "procedures", "sop", "procedure operationnelle", "compiler etapes", "mots declencheurs", "flux etape par etape", "tester le bot", "avant publication"]
---

# Tester votre agent avant de le publier

Avant de laisser votre agent IA discuter avec de vrais clients, il vaut mieux vérifier comment il répond. Parallly met à votre disposition trois outils pour cela :

- **Chat de test** — discutez vous-même avec l'agent, comme si vous étiez un client.
- **Simulations** — des dizaines de « clients simulés » conversent avec votre agent, et une IA évaluatrice note chaque conversation.
- **Procédures (SOP)** — rédigez vos processus en langage naturel pour que l'agent les suive étape par étape, sans improviser.

> Ces outils sont réservés au rôle **administrateur**. **Agent IA** et **Procédures** se trouvent dans **IA et croissance**.

## Comment discuter avec votre agent (chat de test)

C'est la façon la plus rapide de voir votre agent en action :

1. Dans la barre latérale, allez dans **IA et croissance** → **Agent IA**.
2. Ouvrez l'agent que vous souhaitez vérifier.
3. Cliquez sur le bouton **Tester l'agent**.
4. Écrivez comme si vous étiez un client (« Quels sont vos tarifs ? », « Avez-vous des disponibilités samedi ? ») et cliquez sur **Envoyer**.
5. Avec **Réinitialiser**, vous effacez la conversation et repartez de zéro.

Le chat de test est un espace sûr : il ne crée aucun contact, n'apparaît pas dans votre boîte de réception et ne touche à aucune conversation réelle. Utilisez-le chaque fois que vous modifiez la personnalité, les règles ou les informations de l'entreprise, afin de confirmer que l'agent répond comme prévu.

## Comment lancer une simulation

Lorsque vous voulez une évaluation plus complète que quelques messages saisis à la main, utilisez les simulations. Voyez-les comme un « contrôle qualité » automatique de votre agent.

1. Ouvrez **Agent IA**, choisissez l'agent, puis sélectionnez **Tester l'agent**.
2. Dans le panneau **Nouvelle simulation**, choisissez l'**Agent** que vous voulez évaluer.
3. Dans **Source des scénarios**, choisissez comment les clients de test sont générés :
   - **Synthétiques** — l'IA génère des clients variés et réalistes de votre secteur : faciles, sceptiques, agacés, comparateurs de prix, etc.
   - **Historiques** — rejouez de vraies conversations que vos clients ont déjà eues, pour voir comment l'agent les gérerait avec sa configuration actuelle.
4. Définissez le **Nombre de scénarios** à exécuter (50 par défaut ; vous pouvez l'ajuster).
5. (Facultatif) Dans **Comparer avec (référence)**, choisissez une simulation antérieure : ses mêmes scénarios sont réutilisés pour détecter si quelque chose s'est dégradé après vos changements.
6. Cliquez sur **Lancer la simulation**.

La simulation s'exécute en arrière-plan : vous pouvez continuer à travailler et revenir plus tard. Dans le panneau **Historique**, vous voyez chaque exécution avec son statut — **En file**, **En cours**, **Terminée** ou **Échouée** — et l'avancement des scénarios évalués.

> **C'est 100 % sûr :** la simulation ne crée jamais de rendez-vous, de commandes ni de remises réels. Les actions de l'agent sont désactivées pendant le test ; rien ne parvient à vos clients.

## Comment lire les résultats

En ouvrant une simulation terminée, vous verrez :

- **Score moyen** (0 à 10) — la qualité générale des réponses de l'agent.
- **Taux de résolution** — le pourcentage de conversations que l'agent a réussi à résoudre.
- **Sous-scores par dimension** — **Résolution**, **Ton**, **Précision** et **Empathie**, pour savoir exactement où il est solide et où il faiblit.
- **Régressions** — si vous avez choisi une référence, vous verrez **Régression détectée** lorsqu'une réponse s'est dégradée par rapport à l'exécution précédente, ou **Aucune régression** si tout s'est maintenu ou amélioré.
- **Tableau des scénarios** — cliquez sur n'importe quel scénario pour voir la **transcription** complète (client vs. agent) et les **problèmes** que l'évaluateur a détectés dans cette conversation.

**Recommandation :** lancez une simulation chaque fois que vous modifiez la personnalité, les règles, la base de connaissances ou les procédures de votre agent, et comparez-la à la référence précédente. Ainsi, vous publiez vos changements avec des preuves, pas avec de l'intuition.

## Comment créer une procédure (SOP)

Les procédures apprennent à votre agent à exécuter les processus de votre entreprise **étape par étape** : remboursements, garanties, réclamations, qualification de leads… L'agent décide comment rédiger chaque message avec naturel, mais le flux est contrôlé par la procédure — c'est pourquoi il ne saute ni n'invente jamais d'étapes.

1. Dans la barre latérale, allez dans **IA et croissance** → **Procédures**.
2. Choisissez comment la créer :
   - **Rédiger un SOP** (recommandé) — décrivez la procédure en langage naturel, par exemple : *« Quand un client demande un remboursement, demandez-lui le numéro de commande et vérifiez son statut ; si elle est livrée, proposez un coupon, sinon transférez à un agent. »* Cliquez ensuite sur **Compiler en étapes** : l'IA la convertit en une séquence d'étapes concrètes, conservée comme **Brouillon** pour votre révision.
   - **Vierge** — construisez les étapes manuellement, une par une, avec **Ajouter une étape**.
3. Révisez et ajustez les étapes. Chaque étape est de l'un de ces types :

| Type | Rôle |
|------|------|
| **Message** | Communique quelque chose au client |
| **Demander** | Demande une donnée au client et l'enregistre (ex. : numéro de commande) |
| **Outil** | Exécute une action (consulter une commande, rechercher un produit…) |
| **Condition** | Évalue une donnée et oriente le flux selon le résultat |
| **Transfert** | Transfère la conversation à une personne de votre équipe |

4. Cliquez sur **Enregistrer**.

### Activer la procédure

- Définissez les **Mots déclencheurs** (ex. : « remboursement, retour, garantie »). Lorsqu'un client en mentionne un, la procédure démarre automatiquement.
- Utilisez **Activer** pour la mettre en marche ou **Désactiver** pour la mettre en pause sans la supprimer.
- Chaque changement incrémente la **version** de la procédure, afin que vous sachiez toujours quelle version est utilisée.

**Astuce :** après avoir activé ou modifié une procédure, testez-la dans le chat de test en mentionnant l'un de ses mots déclencheurs, puis lancez une simulation pour vérifier que le reste des conversations n'a pas été affecté.

## Questions fréquentes

**La simulation peut-elle envoyer des messages à mes vrais clients ?**
Non. Tout se passe dans un environnement isolé : aucun rendez-vous, commande, remise ni conversation réels ne sont créés, et aucun message ne part vers vos canaux connectés.

**Quelle est la différence entre le chat de test et la simulation ?**
Le chat de test, c'est vous qui conversez avec l'agent : idéal pour des vérifications rapides et ponctuelles. La simulation exécute des dizaines de conversations variées avec une notation automatique : idéale avant de publier des changements importants.

**Qu'est-ce que la « référence » et à quoi sert-elle ?**
C'est une simulation antérieure que vous utilisez comme point de comparaison. En réutilisant ses mêmes scénarios, Parallly peut vous dire si un changement que vous avez fait a **dégradé** une réponse qui sortait bien auparavant (une « régression »).

**Que faire si « Régression détectée » apparaît ?**
Ouvrez les scénarios signalés, lisez la transcription et les problèmes détectés, ajustez la configuration de l'agent (personnalité, règles, connaissance ou procédures) et relancez la simulation en comparant avec la même référence.

**Un bon score garantit-il que l'agent est parfait ?**
Non, mais il réduit fortement le risque. À titre de repère : 8 ou plus est un bon résultat ; entre 5 et 8, il convient d'examiner les scénarios les moins bien notés ; en dessous de 5, révisez la configuration avant de publier.

**Qui peut utiliser ces outils ?**
Seul le rôle **administrateur**. Si vous ne voyez pas ces options dans le menu et que vous en avez besoin, demandez l'accès à l'administrateur de votre compte. Des questions ? Écrivez-nous sur https://parallly-chat.cloud/support
