---
id: canales-redes
title: "Connecter Instagram, Messenger et Telegram"
routes: ["/admin/channels", "/admin/channels/instagram", "/admin/channels/messenger", "/admin/channels/telegram"]
roles: ["tenant_admin"]
keywords: ["instagram", "messenger", "telegram", "facebook", "connecter canal", "connecter instagram", "connecter messenger", "connecter telegram", "reconnecter", "token expire", "jeton expire", "bot", "botfather", "messages prives", "dm", "deconnecter canal", "compte business", "plusieurs comptes", "limite de comptes", "page facebook", "reseaux sociaux"]
---

# Connecter Instagram, Messenger et Telegram

En plus de WhatsApp, votre entreprise peut répondre à ses clients sur **Instagram**, **Messenger** et **Telegram**. Les trois se connectent dans **Administration → Canaux**, et chaque connexion peut avoir son propre agent IA. Voici ce dont vous avez besoin, comment connecter chacun d'eux, ce que signifient les statuts et quoi faire lorsqu'une connexion expire.

> Seul le rôle **administrateur** peut ouvrir Canaux et gérer les connexions.

## Avant de commencer : prérequis par canal

| Canal | Vous avez besoin de |
|-------|-----------|
| Instagram | Un compte **Instagram Business** (les comptes personnels ne fonctionnent pas ; c'est une exigence de Meta, pas de Parallly) |
| Messenger | Un compte Facebook avec un accès administrateur à la **page Facebook** de votre entreprise |
| Telegram | Un **bot Telegram** créé avec @BotFather (nous vous guidons pas à pas ; cela prend moins de 2 minutes) |

## Comment connecter Instagram

1. Dans la barre latérale, ouvrez **Canaux** et repérez la carte **Instagram**.
2. Cliquez sur **Connecter**.
3. Sur la page Instagram, cliquez sur **Connecter avec Instagram**. Une fenêtre contextuelle de Meta s'ouvrira.
4. Connectez-vous avec votre compte **Instagram Business** et acceptez les autorisations de messagerie demandées par Meta.
5. La fenêtre se ferme d'elle-même et vous verrez votre **Compte connecté** avec le nom et l'identifiant de votre profil.

Dès ce moment, les messages privés (DM) d'Instagram arrivent dans votre boîte de réception et votre agent IA peut y répondre.

### Quand et comment reconnecter Instagram

L'autorisation que Meta accorde à Parallly pour votre compte Instagram **dure 60 jours**. Vous n'avez rien à faire pour la maintenir : Parallly la renouvelle automatiquement chaque jour à l'approche de l'échéance.

- Sur la carte du canal, vous verrez l'avis « **Le token expire dans X jours** » à titre informatif.
- Si le renouvellement automatique échoue (par exemple parce que vous avez changé votre mot de passe ou vos autorisations sur Instagram), vous recevrez une alerte et verrez le message « **Token expiré. Veuillez reconnecter votre compte.** ».
- Dans ce cas, cliquez sur **Reconnecter** et répétez la connexion avec Instagram. Vos conversations et votre historique restent intacts.

## Comment connecter Messenger

1. Dans la barre latérale, ouvrez **Canaux** et repérez la carte **Messenger**.
2. Cliquez sur **Connecter**.
3. Cliquez sur **Connecter avec Facebook**. La fenêtre de connexion Facebook s'ouvrira.
4. Connectez-vous, **sélectionnez la page Facebook** de votre entreprise et accordez les autorisations de messagerie demandées.
5. C'est fait : vous verrez votre **Page connectée** et les messages Messenger commenceront à arriver dans votre boîte de réception.

## Comment connecter Telegram

1. Dans la barre latérale, ouvrez **Canaux** et repérez la carte **Telegram**. Cliquez sur **Connecter**.
2. **Étape 1 — Créez votre bot sur Telegram** (moins d'une minute) :
   - Ouvrez Telegram et recherchez **@BotFather** (l'assistant officiel de Telegram pour créer des bots), ou utilisez le bouton **Ouvrir @BotFather**.
   - Envoyez la commande `/newbot` et choisissez un nom et un identifiant pour votre bot.
   - BotFather vous enverra un **token** : copiez-le.
3. Cliquez sur **J'ai déjà le token**.
4. **Étape 2 — Collez le token de votre bot** dans le champ indiqué et cliquez sur **Connecter le bot**. Le token est stocké chiffré et n'est jamais affiché en clair.
5. Vous verrez la confirmation « **Bot connecté !** ». Parallly termine automatiquement le reste de la configuration.
6. Utilisez **Ouvrir sur Telegram** pour envoyer un message de test à votre bot et vérifier que votre agent IA répond.

## Statuts d'une connexion

Sur la page **Canaux**, chaque carte affiche le statut actuel :

- **Connecté** (badge vert) : le canal reçoit et envoie les messages normalement. Le bouton devient **Configurer** pour accéder aux détails.
- **Déconnecté** (badge rouge) : le canal n'est pas actif. Ouvrez la carte pour le connecter ou le reconnecter.
- **Compteur de comptes** (« X/Y comptes ») : le nombre de connexions de ce type actives et le nombre autorisé par votre forfait. S'il vous reste de la marge, le lien **Ajouter un autre** apparaît.

Rappel : chaque connexion a besoin d'un agent IA assigné pour répondre automatiquement. L'assignation se fait depuis l'éditeur de l'agent (section **Agente IA** / Agent IA), et la règle **un agent par connexion** s'applique.

## Plusieurs comptes du même canal

Vous pouvez connecter plusieurs comptes du même type si votre compte dispose de la capacité nécessaire, sans mélanger les conversations. L'écran affiche l'utilisation actuelle ; consultez **Forfait et facturation** pour la disponibilité et les limites en vigueur.

## Comment déconnecter un compte

La déconnexion se fait **compte par compte** : si vous avez plusieurs connexions sur un même canal, en déconnecter une n'affecte pas les autres.

1. Ouvrez **Canaux**, accédez au canal et choisissez la connexion à retirer.
2. Cliquez sur **Déconnecter** et confirmez dans la fenêtre de confirmation.
3. Le résultat vous indique exactement ce qui s'est passé :
   - **Vert** — « Déconnecté complètement » : tout a également été clôturé du côté du fournisseur (Meta ou Telegram).
   - **Jaune** — « Déconnecté sur la plateforme » : Parallly ne traitera plus les messages, mais il est conseillé de vérifier l'intégration chez le fournisseur (par exemple dans Meta Business Suite), car l'autorisation a pu expirer avant la fin de la clôture.
   - **Rouge** — une erreur réseau s'est produite : réessayez.

## Questions fréquentes

**Puis-je connecter mon Instagram personnel ?**
Non. Seuls les comptes **Instagram Business** fonctionnent. C'est une exigence de Meta. Convertir votre compte personnel en compte Business est gratuit et se fait depuis l'application Instagram.

**Dois-je reconnecter Messenger ou Telegram régulièrement ?**
Non. Le renouvellement périodique ne concerne qu'Instagram, et il est normalement automatique. Vous n'aurez à intervenir que si vous recevez une alerte indiquant que le renouvellement a échoué.

**Puis-je avoir un agent IA différent sur chaque canal ?**
Oui : la règle est **un agent par connexion**. Vous pouvez par exemple avoir un agent formel sur Messenger et un autre plus chaleureux sur Instagram, selon ce que permet votre forfait.

**J'ai connecté le canal mais le bot ne répond pas. Que vérifier ?**
Vérifiez deux choses dans cet ordre : que la carte du canal indique **Connecté**, et que la connexion a un agent IA assigné dans la section Agent IA. Si les deux sont en ordre et qu'il ne répond toujours pas, contactez-nous au [support](https://parallly-chat.cloud/support).

**Qu'advient-il de mes conversations si je déconnecte puis reconnecte ?**
Rien n'est perdu : l'historique des conversations et vos contacts sont conservés. À la reconnexion, les nouveaux messages reprennent la conversation existante.
