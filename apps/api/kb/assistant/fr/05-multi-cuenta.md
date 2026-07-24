---
id: multi-cuenta
title: "Plusieurs connexions du même canal (multi-compte)"
routes: ["/admin/channels", "/admin/agent", "/admin/broadcast", "/admin/channels/whatsapp/templates"]
roles: ["tenant_admin", "tenant_supervisor"]
keywords: ["multi-compte", "plusieurs comptes", "deux numeros whatsapp", "deuxieme numero", "autre compte instagram", "limite de comptes", "connecter un autre compte", "ajouter un autre", "deconnecter un compte", "numero expediteur", "choisir le numero", "envoyer depuis le numero", "comptes par canal", "plusieurs connexions", "deux comptes", "compteur de comptes", "limite par forfait", "plusieurs numeros"]
---

# Plusieurs connexions du même canal (multi-compte)

Votre entreprise dispose d'un numéro WhatsApp pour les ventes et d'un autre pour le support ? Ou de deux comptes Instagram pour des marques différentes ? Avec Parallly, vous pouvez connecter **plusieurs comptes du même canal** — par exemple deux numéros WhatsApp, deux comptes Instagram ou deux bots Telegram — et chacun fonctionne de manière indépendante : les conversations ne se mélangent jamais et chaque connexion peut avoir son propre agent IA.

> Connecter et déconnecter des comptes relève du rôle **administrateur**. Les superviseurs peuvent consulter l'état des canaux et choisir le numéro expéditeur lors de l'envoi de campagnes.

## Combien de comptes du même canal votre forfait inclut

Chaque forfait définit le nombre de connexions du même type que vous pouvez avoir. Voici les limites incluses :

| Forfait | WhatsApp | Instagram | Messenger | Telegram |
|------|:--------:|:---------:|:---------:|:--------:|
| Emprendedor | 1 | 1 | 1 | 1 |
| Starter | 1 | 1 | 1 | 1 |
| Pro | 2 | 1 | 3 | 1 |
| Enterprise | 3 | 2 | 5 | 2 |
| Custom | Illimité | Illimité | Illimité | Illimité |

À noter :

- Les canaux disponibles dépendent également de votre forfait : le forfait **Emprendedor** inclut uniquement WhatsApp, et **Telegram** est disponible à partir du forfait **Pro**.
- Le canal **Email** admet une connexion par entreprise.
- Si vous avez besoin de plus de comptes que votre forfait n'en inclut, vous pouvez passer à un forfait supérieur depuis **Paramètres → Facturation**, ou nous écrire pour élargir votre limite : l'équipe Parallly peut l'ajuster pour votre entreprise.

## Comment voir combien de comptes sont connectés

1. Dans la barre latérale, accédez à **Canaux**.
2. Chaque carte de canal affiche un compteur au format **« X/Y comptes »** — par exemple, « 1/2 comptes » signifie que vous avez 1 compte connecté et que votre forfait en autorise jusqu'à 2 pour ce canal. Si votre limite est illimitée, vous verrez le symbole ∞.
3. Tant qu'il vous reste de la place, la carte affiche le lien **Ajouter un autre**.

## Comment connecter un autre compte du même canal

1. Accédez à **Canaux** et repérez la carte du canal (par exemple, WhatsApp).
2. Cliquez sur **Ajouter un autre**.
3. Suivez le même processus de connexion que d'habitude : connexion Meta pour WhatsApp, Instagram ou Messenger, ou le token de @BotFather pour Telegram.
4. Une fois terminé, le nouveau compte apparaît sur la carte du canal aux côtés des autres, avec son propre nom ou numéro.

Chaque compte conserve sa propre autorisation ; les messages partent donc toujours depuis le bon numéro ou le bon compte.

> Si le lien **Ajouter un autre** n'apparaît pas, vous avez déjà atteint la limite de votre forfait pour ce canal.

## Chaque connexion avec son propre agent IA

Chez Parallly, la règle est **un agent IA par connexion**, et non par canal. Cela signifie que si vous avez deux numéros WhatsApp, vous pouvez attribuer un agent différent à chacun — par exemple, « Sofía » pour le numéro des ventes et « Carlos » pour le support.

Pour les attribuer :

1. Dans la barre latérale, accédez à **Agent IA** et ouvrez l'agent à configurer.
2. Dans la section **Attribution des canaux**, vous verrez une option pour **chaque compte connecté**, identifiée par son nom ou son numéro (par exemple, « WhatsApp · Ventes +57 300… »).
3. Cochez les connexions que cet agent doit prendre en charge et cliquez sur **Enregistrer les modifications** dans la barre inférieure.

Si vous attribuez à cet agent une connexion déjà gérée par un autre agent, la plateforme vous en avertit avant l'enregistrement : la connexion passera au nouvel agent.

## Comment déconnecter un compte précis

La déconnexion se fait **par compte** : vous pouvez déconnecter un numéro sans affecter les autres.

1. Accédez à **Canaux** et cliquez sur le canal.
2. Repérez le compte que vous souhaitez déconnecter et cliquez sur **Déconnecter**.
3. Confirmez le message : « Déconnecter ce compte ? Les autres comptes de ce canal resteront actifs. »
4. Vérifiez le résultat dans la fenêtre de confirmation : vert signifie une déconnexion complète ; jaune signifie que le compte est déconnecté dans Parallly, mais qu'il est conseillé de vérifier également votre compte chez le fournisseur (par exemple, Meta Business Suite).

## Choisir le numéro expéditeur dans les campagnes

Lorsque plusieurs numéros WhatsApp sont connectés, vous choisissez lequel utiliser à la création d'une campagne :

1. Dans la barre latérale, accédez à **Campagnes** et créez une **Nouvelle campagne**.
2. Dans le formulaire, vous verrez le champ **Envoyer depuis le numéro**.
3. Choisissez le numéro expéditeur, ou laissez **Numéro principal (par défaut)** pour envoyer depuis votre numéro principal.
4. Complétez le reste de la campagne (audience, template, programmation) et confirmez.

## Templates WhatsApp avec plusieurs numéros

Les templates approuvés par Meta appartiennent à un numéro précis. Si vous avez plusieurs numéros :

1. Accédez à **Canaux → WhatsApp** et cliquez sur **Voir tous les templates**.
2. Lors de la création d'un template, le champ **Numéro / compte** apparaît : choisissez le numéro concerné, ou laissez **Numéro principal (par défaut)**.
3. Soumettez-le à l'approbation comme d'habitude. Lors de l'envoi de campagnes, utilisez des templates du même numéro que celui choisi comme expéditeur.

## Questions fréquentes

**Les conversations de mes deux numéros peuvent-elles se mélanger ?**
Non. Chaque connexion conserve ses conversations séparées dans la boîte de réception, et les réponses partent toujours depuis le compte par lequel le client a écrit.

**Puis-je attribuer deux agents IA au même numéro ?**
Non. Chaque connexion a exactement un agent attribué. En revanche, vous pouvez attribuer le même agent à plusieurs connexions.

**J'ai atteint la limite de comptes de mon forfait, que faire ?**
Vous pouvez passer à un forfait supérieur depuis **Paramètres → Facturation**, ou nous contacter sur https://parallly-chat.cloud/support pour étudier un élargissement de la limite pour votre entreprise.

**Si je déconnecte un compte, les autres continuent-ils de fonctionner ?**
Oui. La déconnexion est individuelle : les autres comptes du même canal continuent de recevoir et de répondre aux messages normalement.

**Le multi-compte s'applique-t-il au chat web ou à l'Email ?**
L'Email admet une connexion par entreprise, et le widget de chat web se configure à part dans **Paramètres → Intégrations → Web Chat**. Le multi-compte s'applique à WhatsApp, Instagram, Messenger et Telegram.

**Les comptes de canaux différents comptent-ils dans la même limite ?**
Non. La limite s'applique par type de canal : par exemple, avec le forfait Pro, vous pouvez avoir 2 numéros WhatsApp et en plus 3 pages Messenger.

Des questions ? Écrivez-nous sur https://parallly-chat.cloud/support — nous serons ravis de vous aider.
