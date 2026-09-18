---
id: agentes-ia
title: "Agents IA : créer et configurer"
routes: ["/admin/agent", "/admin/agent/simulation"]
roles: ["tenant_admin"]
keywords: ["agent", "agents ia", "bot", "chatbot", "assistant virtuel", "créer un agent", "modèle", "personnalité", "instructions", "ton", "horaires de l'agent", "assigner un canal", "connexion", "dupliquer un agent", "agent par défaut", "limite d'agents", "canaux sans agent", "tester l'agent", "règles", "sujets interdits", "champs obligatoires", "quand passer a un humain", "message de repli", "actif inactif", "avance", "assist", "instructions principales", "vente et assistance", "brouillon de l'agent", "enregistrer", "changements immediats", "mode revise", "repond deja", "modifications anterieures", "modifications non appliquees", "supprimer les modifications", "canal sans reponse"]
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

L'agent est créé et son éditeur s'ouvre. Lorsqu'il est créé depuis cet écran, il n'est pas encore l'agent par défaut et ne prend en charge aucune connexion : personnalisez-le, cochez dans **Attribution des canaux** les connexions qu'il prend en charge et enregistrez ; dès ce moment, il répond là-bas.

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
- **Personnalité** — style de communication, usage des emojis et de l'humour, **Longueur des réponses** (Concis, Standard ou Détaillé) et message d'accueil initial.
- **Message lorsqu'il ne peut pas répondre** — le texte de repli, obligatoire.
- **Instructions** — une consigne principale, des règles concrètes, les sujets interdits et les informations à demander dans chaque contexte. La consigne principale fait partie du prompt effectif en mode guidé.
- **Quand passer à un humain** — la liste des motifs qui font que l'agent cesse de répondre et alerte votre équipe : le client le demande, se plaint, pose une question de remise, ou l'agent échoue plusieurs fois de suite. Sans au moins un motif, la conversation n'atteint jamais une personne.
- **Vente et assistance** — choisissez si l'agent vend, assiste ou fait les deux ; pour la vente, vous pouvez aussi régler l'intensité des recommandations et la remise maximale autorisée.
- **Horaires** — quand l'agent est actif (voir plus bas).
- **Capacités** — ce que l'agent peut faire, avec des interrupteurs pour activer ou désactiver chaque capacité :
  - Chercher des réponses dans votre base de connaissances
  - Vérifier les disponibilités et prendre des rendez-vous
  - Présenter les produits, services ou biens de votre catalogue
  - Créer des commandes ou des réservations
  - Transférer la conversation à un membre de votre équipe quand c'est nécessaire

Les capacités spécialisées dépendent du **type d'activité** du tenant. L'éditeur ne propose que les familles de ce profil et explique si des données, le forfait ou un fournisseur manquent pour les activer.

**Avancé** n'est pas une carte : ce sont deux sections repliables, dans deux onglets différents, et c'est pourquoi vous ne les trouvez jamais ensemble :

- **Avancé : affiner la recherche** — dans **Capacités**, sous l'interrupteur de la recherche dans vos connaissances (il n'apparaît que si cet interrupteur est activé). C'est là que se trouvent le nombre de passages à utiliser et le degré de correspondance exigé.
- **Avancé** — dans **Instructions**, avec les données que l'agent doit demander dans chaque contexte.

Les deux arrivent avec des valeurs raisonnables ; ne les changez que si vous savez ce que vous réglez.

## Configurer avec Parallly Assist

Vous pouvez demander à Assist d'examiner l'agent et de préparer des changements d'identité, de langue, d'instructions, de règles, d'informations requises, de comportement hors horaires, de vente/assistance, de recommandations, de longueur de réponse, de connaissances et d'autorisations. Assist présente une proposition à vérifier ; l'accepter applique le changement à l'agent (ou le laisse en brouillon si votre compte utilise le mode révisé). Assist n'active ni ne désactive jamais l'agent. En mode prompt personnalisé, Assist ne propose pas de modifier la personnalité, la consigne principale, les règles ni les champs requis, car le prompt les remplace. N'envoyez jamais d'identifiants ou de connexions dans le chat.

Quand vous avez terminé, cliquez sur **Enregistrer**. Le changement s'applique aussitôt sur les connexions affectées et l'avis vert affiche **Enregistré. Votre agent répond désormais ainsi.** ; la version précédente reste dans l'historique. Si un champ obligatoire manque, l'éditeur le marque en rouge et n'enregistre pas. Utilisez **Tester l'agent** pour le voir répondre avant ou après l'enregistrement. Si vous quittez avec des modifications non enregistrées, l'éditeur vous prévient.

**Mode révisé (facultatif).** Les équipes qui préfèrent approuver chaque changement avant qu'il n'atteigne les clients peuvent activer le mode révisé pour le compte. Le bouton affiche alors **Enregistrer le brouillon**, les sections **Examiner une version** et **Publier et voir l'historique** apparaissent, et le changement ne répond aux clients qu'après avoir examiné et publié cette version. Par défaut, le compte est en mode immédiat.

**Modifications antérieures pas encore appliquées.** Si vous avez enregistré des modifications avec l'ancien circuit de brouillon et de révision et qu'elles n'ont jamais été appliquées, l'éditeur affiche en haut **Vous avez des modifications antérieures qui ne sont pas encore appliquées**. Le formulaire montre ce que votre agent utilise aujourd'hui : choisissez **Appliquer ces modifications** pour qu'il commence à les utiliser (elles s'enregistrent comme n'importe quel changement ; s'il manque un champ obligatoire, l'éditeur le signale) ou **Supprimer ces modifications** pour le laisser tel quel. Si vous enregistrez sans les appliquer, elles sont supprimées et ce que vous voyez est enregistré. Si votre agent a changé depuis (par exemple, vous l'avez activé, avez connecté un canal ou accepté une proposition d'Assist), l'avis indique qu'elles ne peuvent plus être appliquées : supprimez-les pour pouvoir enregistrer à nouveau.

## Actif ou inactif

L'en-tête de l'éditeur comporte un interrupteur **Actif / Inactif**. Un agent **inactif** ne répond sur aucune de ses connexions, même si le canal est connecté et que les horaires disent le contraire. Vous pouvez le désactiver immédiatement après confirmation, et le réactiver avec le même interrupteur : il s'active aussitôt. (En mode révisé, la réactivation passe par l'examen et la publication d'une version.) La **Santé des agents** signale comme blocage critique tout agent inactif, avec ou sans connexions assignées.

## Comment définir les horaires de l'agent

1. Configurez les jours, les plages et le fuseau de tout le compte dans **Paramètres → Horaires d'ouverture**.
2. Dans l'éditeur de l'agent, ouvrez **Horaires** pour consulter ce calendrier et décider si l'IA continue à répondre en dehors de celui-ci.
3. Si vous désactivez l'IA hors horaires, rédigez le message propre à cet agent et enregistrez.

Les horaires d'ouverture appartiennent au tenant et sont partagés par ses agents ; chaque agent choisit uniquement son comportement en dehors de ces horaires.

## Comment assigner l'agent à chaque connexion

La règle est simple : **un agent IA par connexion**. Une connexion correspond à chaque compte ou numéro que vous avez connecté — par exemple, « WhatsApp Ventes » et « WhatsApp Support » sont deux connexions distinctes, et chacune peut avoir son propre agent.

1. Dans l'éditeur de l'agent, allez dans **Attribution des canaux**.
2. Cochez les connexions que cet agent va prendre en charge. Vous verrez chaque compte avec son nom et son numéro, et non le canal générique.
3. Si la connexion était déjà assignée à un autre agent, l'éditeur vous prévient qu'elle **sera réattribuée** depuis l'agent précédent.
4. Cliquez sur **Enregistrer**. La réattribution a lieu au moment de l'enregistrement. Si une connexion cochée n'est pas encore connectée, sa ligne affiche **Connecter**, qui vous amène à l'écran de ce canal.

Lorsque vous connectez votre **premier canal**, il est affecté uniquement à l'agent par défaut (si c'est le seul actif) ; inutile de retourner dans l'éditeur. Avec plusieurs agents actifs, l'affectation vous revient.

Les types de connexion disponibles et leur capacité figurent dans **Canaux** et **Forfait et facturation**.

## Que signifie l'avis « canaux sans agent assigné »

Si **Agent IA** affiche **Canaux sans agent assigné**, vous avez des connexions actives qu'aucun agent ne prend en charge de façon spécifique. Tant qu'un agent par défaut actif existe, sa version opérationnelle traite ces messages. S'il n'y a pas d'agent par défaut actif, ou si deux agents ont la même connexion affectée, personne n'y répond : les messages arrivent mais restent sans réponse, et **Santé des agents** le signale comme critique dans **Chaque canal connecté a un agent qui répond**.

Cliquez sur **Assigner un agent maintenant** pour choisir quel agent prend en charge chaque connexion et offrir une expérience personnalisée.

## Dupliquer, enregistrer comme modèle et autres actions

Dans la liste **Agent IA**, chaque agent dispose d'un menu d'actions :

- **Dupliquer** — crée une copie exacte, idéale pour expérimenter sans toucher à l'agent qui fonctionne déjà.
- **Enregistrer comme modèle** — copie la configuration actuelle dans un modèle réutilisable lorsque la fonction est activée.
- **Définir par défaut** — le transforme en agent qui répond aux connexions non assignées, aussitôt.
- **Supprimer** — retire l'agent de l'usage en le désactivant et en libérant ses connexions, tout en conservant son enregistrement. L'agent par défaut ne peut pas être retiré avant d'établir un autre agent par défaut.

## Testez votre agent avant de l'activer

Dans **Agent IA → Tester l'agent**, vous pouvez discuter avec l'agent tel qu'il répond aujourd'hui, sans affecter de vrais clients, consommer de messages ni créer de réservations. Testez-le après tout changement de personnalité, règles, outils ou connexions.

## Questions fréquentes

**Puis-je avoir un agent pour les ventes et un autre pour le support ?**
Oui, si votre compte dispose de la capacité nécessaire. Créez-en un avec le modèle **Conseiller Commercial** et un autre avec **Agent de Support**, puis assignez chacun à la connexion correspondante.

**Que se passe-t-il si je connecte un canal sans lui assigner d'agent ?**
C'est votre agent par défaut qui répond, s'il est actif ; sinon, personne ne répond sur ce canal et **Santé des agents** vous le signale. Vous verrez l'avis de canaux non assignés dans **Agent IA** pour corriger cela en un clic.

**L'agent peut-il répondre par SMS ?**
Non. Dans Parallly, le SMS n'est pas un canal de conversation : il sert uniquement aux notifications sortantes avec des crédits (1 crédit = 1 segment). Les surfaces conversationnelles en libre-service sont WhatsApp, Instagram, Messenger, Telegram et le chat web. Email conserve un adaptateur inbound interne, mais pas de configuration libre-service certifiée.

**J'ai modifié les instructions et l'agent réagit toujours pareil, que dois-je vérifier ?**
Vérifiez que l'enregistrement s'est terminé avec l'avis vert **Enregistré. Votre agent répond désormais ainsi.** ; si un champ obligatoire manquait, l'éditeur le marque en rouge et n'enregistre pas. Confirmez ensuite que cette connexion est affectée à cet agent et non à un autre, et que l'agent est **Actif**. En mode révisé, il faut en plus examiner et publier la version.

**Comment ajouter plus d'agents ou plus de numéros ?**
L'écran affiche la capacité disponible pour les agents et les connexions. Consultez les options actuelles dans **Administration → Forfait et facturation**, ou écrivez-nous à https://parallly-chat.cloud/support si vous avez besoin d'une autre capacité.
