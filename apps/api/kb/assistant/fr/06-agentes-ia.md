---
id: agentes-ia
title: "Agents IA : créer et configurer"
routes: ["/admin/agent", "/admin/agent/simulation"]
roles: ["tenant_admin"]
keywords: ["agent", "agents ia", "bot", "chatbot", "assistant virtuel", "créer un agent", "modèle", "personnalité", "instructions", "ton", "horaires de l'agent", "assigner un canal", "connexion", "dupliquer un agent", "agent par défaut", "limite d'agents", "canaux sans agent", "tester l'agent", "règles", "sujets interdits"]
---

# Agents IA : créer et configurer

Votre agent IA est le « vendeur virtuel » qui répond à vos clients sur WhatsApp, Instagram, Messenger, Telegram et le chat de votre site web, 24 h/24. Vous apprendrez ici à le créer, lui donner une personnalité, définir ses horaires et l'assigner à vos connexions.

> Cette section est gérée par le rôle **administrateur**. Les superviseurs et les agents humains voient le résultat dans la boîte de réception, mais ne configurent pas les agents IA.

## Capacité des agents

**Agent IA** indique combien d'agents vous pouvez créer et si les modèles personnalisés sont activés. Lorsque la capacité est atteinte, **Limite d'agents atteinte** s'affiche ; consultez la limite actuelle dans **Forfait et facturation**.

## Comment créer un agent

1. Dans le menu latéral, ouvrez **Agent IA**.
2. Cliquez sur **Nouvel agent**.
3. Choisissez un modèle. Vous verrez trois groupes :
   - **Recommandés pour votre entreprise** — des modèles adaptés à votre secteur (par exemple, réceptionniste pour cliniques, conseiller immobilier, prise de commandes pour restaurants).
   - **Modèles généraux** — **Conseiller Commercial**, **Agent de Support**, **Bot FAQ**, **Planificateur de Rendez-vous**, **Qualificateur de Leads** et **Agent Vierge** (pour tout configurer à partir de zéro).
   - **Mes modèles** — ceux que vous avez enregistrés, lorsque la fonction est activée pour votre compte.
4. Cliquez sur **Utiliser** sur le modèle choisi.
5. Saisissez le **Nom de l'agent** si vous en souhaitez un personnalisé (par exemple, Sofia ou Max) ; si vous le laissez vide, le nom du modèle est utilisé.

L'agent est créé et son éditeur s'ouvre pour que vous puissiez le personnaliser.

## Comment configurer la personnalité et les instructions

Dans **Agent IA**, cliquez sur **Modifier** sur l'agent. L'éditeur est organisé en cartes :

- **Identité** — nom, rôle ou titre (par exemple, « Conseillère commerciale ») et langue.
- **Personnalité** — le **Style de communication** (Amical, Professionnel, Formel, Décontracté ou Empathique), la **Longueur des réponses** (Concis, Standard ou Détaillé) et le message d'accueil initial.
- **Comportement** — vos propres règles en texte libre (par exemple, « proposer toujours la formule familiale avant de conclure »), les sujets interdits que l'agent ne doit jamais aborder et le mode de réponse (toujours IA, toujours humain ou hybride).
- **Modèle IA** — le moteur utilisé par l'agent. L'éditeur affiche les modèles activés pour votre compte.
- **Horaires** — quand l'agent est actif (voir plus bas).
- **Capacités** — ce que l'agent peut faire, avec des interrupteurs pour activer ou désactiver chaque capacité :
  - Chercher des réponses dans votre base de connaissances
  - Vérifier les disponibilités et prendre des rendez-vous
  - Présenter les produits, services ou biens de votre catalogue
  - Créer des commandes ou des réservations
  - Transférer la conversation à un membre de votre équipe quand c'est nécessaire

Quand vous avez terminé, cliquez sur **Enregistrer les modifications** — le bouton reste toujours visible dans la barre inférieure, vous ne perdez donc pas vos modifications en faisant défiler la page.

## Comment définir les horaires de l'agent

1. Dans l'éditeur de l'agent, ouvrez la carte **Horaires**.
2. Cochez les jours et les plages horaires pendant lesquels l'agent répond (par exemple, « Quotidien 9:00–18:00 » ou seulement 5 jours par semaine).
3. Enregistrez avec **Enregistrer les modifications**.

En dehors de ces horaires, l'agent ne répond pas automatiquement ; combinez ce réglage avec le mode de réponse si vous préférez que votre équipe prenne le relais à certains moments.

## Comment assigner l'agent à chaque connexion

La règle est simple : **un agent IA par connexion**. Une connexion correspond à chaque compte ou numéro que vous avez connecté — par exemple, « WhatsApp Ventes » et « WhatsApp Support » sont deux connexions distinctes, et chacune peut avoir son propre agent.

1. Dans l'éditeur de l'agent, allez dans **Attribution des canaux**.
2. Cochez les connexions que cet agent va prendre en charge. Vous verrez chaque compte avec son nom et son numéro, et non le canal générique.
3. Si la connexion était déjà assignée à un autre agent, l'éditeur vous prévient qu'elle **sera réattribuée** depuis l'agent précédent.
4. Cliquez sur **Enregistrer les modifications**.

Les types de connexion disponibles et leur capacité figurent dans **Canaux** et **Forfait et facturation**.

## Que signifie l'avis « canaux sans agent assigné »

Si **Agent IA** affiche **Canaux sans agent assigné**, vous avez des connexions actives qu'aucun agent ne prend en charge de façon spécifique. En attendant, ces messages sont traités par votre **agent par défaut**, avec une configuration générique.

Cliquez sur **Assigner un agent maintenant** pour choisir quel agent prend en charge chaque connexion et offrir une expérience personnalisée.

## Dupliquer, enregistrer comme modèle et autres actions

Dans la liste **Agent IA**, chaque agent dispose d'un menu d'actions :

- **Dupliquer** — crée une copie exacte, idéale pour expérimenter sans toucher à l'agent qui fonctionne déjà.
- **Enregistrer comme modèle** — transforme la configuration en modèle réutilisable lorsque la fonction est activée (il apparaît dans **Mes modèles**).
- **Définir par défaut** — détermine quel agent répond sur les connexions qui n'en ont pas d'assigné.
- **Supprimer** — efface l'agent (une confirmation vous est demandée). L'agent par défaut ne peut pas être supprimé.

## Testez votre agent avant de l'activer

Depuis le menu **Agent IA → Tester l'agent**, vous pouvez discuter avec votre agent en mode simulation, sans affecter de vrais clients. Utilisez-le chaque fois que vous modifiez la personnalité ou les règles, avant qu'il ne parle à vos clients.

## Questions fréquentes

**Puis-je avoir un agent pour les ventes et un autre pour le support ?**
Oui, si votre compte dispose de la capacité nécessaire. Créez-en un avec le modèle **Conseiller Commercial** et un autre avec **Agent de Support**, puis assignez chacun à la connexion correspondante.

**Que se passe-t-il si je connecte un canal sans lui assigner d'agent ?**
C'est votre agent par défaut qui répond. Vous verrez l'avis de canaux non assignés dans **Agent IA** pour corriger cela en un clic.

**L'agent peut-il répondre par SMS ?**
Non. Dans Parallly, le SMS n'est pas un canal de conversation : il sert uniquement aux notifications sortantes avec des crédits (1 crédit = 1 segment). Les surfaces conversationnelles en libre-service sont WhatsApp, Instagram, Messenger, Telegram et le chat web. Email conserve un adaptateur inbound interne, mais pas de configuration libre-service certifiée.

**J'ai modifié les instructions et l'agent réagit toujours pareil, que dois-je vérifier ?**
Vérifiez que vous avez bien cliqué sur **Enregistrer les modifications** dans la barre inférieure de l'éditeur et que vous avez modifié l'agent assigné à cette connexion (et non un autre). Vérifiez ensuite le résultat dans **Tester l'agent**.

**Comment ajouter plus d'agents ou plus de numéros ?**
L'écran affiche la capacité disponible pour les agents et les connexions. Consultez les options actuelles dans **Administration → Forfait et facturation**, ou écrivez-nous à https://parallly-chat.cloud/support si vous avez besoin d'une autre capacité.
