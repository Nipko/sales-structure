---
id: agentes-ia
title: "Agents IA : créer et configurer"
routes: ["/admin/agent", "/admin/agent/simulation"]
roles: ["tenant_admin"]
keywords: ["agent", "agents ia", "bot", "chatbot", "assistant virtuel", "créer un agent", "modèle", "personnalité", "instructions", "ton", "horaires de l'agent", "assigner un canal", "connexion", "dupliquer un agent", "agent par défaut", "limite d'agents", "canaux sans agent", "tester l'agent", "règles", "sujets interdits", "champs obligatoires", "quand passer a un humain", "message de repli", "actif inactif", "avance"]
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

## Ce que l'éditeur exige avant d'enregistrer

Un agent ne fonctionne bien que si le minimum est défini. À l'enregistrement, l'éditeur vérifie et pointe le champ manquant :

- **Nom de l'agent** — comment il se présente à vos clients.
- **Rôle** — ce qu'il fait (par exemple, « Conseillère commerciale » ou « Réceptionniste »).
- **Message lorsqu'il ne peut pas répondre** — la phrase exacte que dit l'agent quand la question sort de ce qu'il sait. Promettre de chercher une personne vaut mieux qu'improviser.
- **Au moins une règle** de comportement.
- **Au moins un motif** dans **Quand passer à un humain**.

Si vous videz l'un de ces champs pour le réécrire, enregistrez seulement une fois qu'il est complet : un agent sans message de repli ou sans motifs de transfert apparaît comme blocage critique dans la **Santé des agents**.

**Si votre agent tourne en mode prompt personnalisé**, cette liste change. Lorsque votre compte dispose de cette fonction et que l'agent l'utilise, un texte unique que vous rédigez remplace la personnalité guidée : la **Santé des agents** marque l'identité, le ton, le message d'accueil, le message de repli et les règles comme **Non applicable**, et exige à la place que ce prompt ne soit pas vide. Ce qui **reste obligatoire**, c'est au moins un motif dans **Quand passer à un humain** : sans lui la conversation n'atteint jamais une personne, quoi que dise le prompt. Si vous voyez « Non applicable » là où ce guide dit « obligatoire », c'est pour cette raison, pas à cause d'une erreur.

## Comment configurer la personnalité et les instructions

Dans **Agent IA**, cliquez sur **Modifier** sur l'agent. L'éditeur est organisé en onglets et en cartes :

- **Identité** — nom, rôle ou titre (par exemple, « Conseillère commerciale ») et langue.
- **Personnalité** — le **Style de communication** (Amical, Professionnel, Formel, Décontracté ou Empathique), la **Longueur des réponses** (Concis, Standard ou Détaillé) et le message d'accueil initial.
- **Message lorsqu'il ne peut pas répondre** — le texte de repli, obligatoire.
- **Instructions** — vos propres règles en texte libre (par exemple, « proposer toujours la formule familiale avant de conclure »), les sujets interdits que l'agent ne doit jamais aborder et le mode de réponse (toujours IA, toujours humain ou hybride).
- **Quand passer à un humain** — la liste des motifs qui font que l'agent cesse de répondre et alerte votre équipe : le client le demande, se plaint, pose une question de remise, ou l'agent échoue plusieurs fois de suite. Sans au moins un motif, la conversation n'atteint jamais une personne.
- **Modèle IA** — le moteur utilisé par l'agent. L'éditeur affiche les modèles activés pour votre compte.
- **Horaires** — quand l'agent est actif (voir plus bas).
- **Capacités** — ce que l'agent peut faire, avec des interrupteurs pour activer ou désactiver chaque capacité :
  - Chercher des réponses dans votre base de connaissances
  - Vérifier les disponibilités et prendre des rendez-vous
  - Présenter les produits, services ou biens de votre catalogue
  - Créer des commandes ou des réservations
  - Transférer la conversation à un membre de votre équipe quand c'est nécessaire

**Avancé** n'est pas une carte : ce sont deux sections repliables, dans deux onglets différents, et c'est pourquoi vous ne les trouvez jamais ensemble :

- **Avancé : affiner la recherche** — dans **Capacités**, sous l'interrupteur de la recherche dans vos connaissances (il n'apparaît que si cet interrupteur est activé). C'est là que se trouvent le nombre de passages à utiliser et le degré de correspondance exigé.
- **Avancé** — dans **Instructions**, avec les données que l'agent doit demander dans chaque contexte.

Les deux arrivent avec des valeurs raisonnables ; ne les changez que si vous savez ce que vous réglez.

Quand vous avez terminé, cliquez sur **Enregistrer les modifications** — le bouton reste toujours visible dans la barre inférieure, vous ne perdez donc pas vos modifications en faisant défiler la page.

## Actif ou inactif

L'en-tête de l'éditeur comporte un interrupteur **Actif / Inactif**. Un agent **inactif** ne répond sur aucune de ses connexions, même si le canal est connecté et que les horaires disent le contraire. Utilisez-le pour préparer un agent sans l'exposer aux clients, ou pour l'éteindre un moment sans rien supprimer. La **Santé des agents** signale comme blocage critique tout agent inactif, avec ou sans connexions assignées.

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
