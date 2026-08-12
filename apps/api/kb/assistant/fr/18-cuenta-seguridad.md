---
id: cuenta-seguridad
title: "Votre compte, votre équipe et la sécurité"
routes: ["/admin/users", "/admin/settings/security", "/admin/settings/change-password"]
roles: ["tenant_admin", "tenant_supervisor", "tenant_agent"]
keywords: ["compte", "sécurité", "équipe", "utilisateurs", "inviter un utilisateur", "ajouter un utilisateur", "rôles", "permissions", "administrateur", "superviseur", "agent", "authentification à deux facteurs", "2fa", "authentification", "code", "mot de passe", "changer le mot de passe", "appareils de confiance", "sso", "authentification unique", "saml", "langue", "thème", "mode sombre", "déconnexion", "inactivité", "session"]
---

# Votre compte, votre équipe et la sécurité

Chaque utilisateur peut protéger son propre compte avec la 2FA, les appareils de confiance et le changement de mot de passe. La gestion de l'équipe, des rôles et du SSO est réservée au rôle **administrateur**.

## Votre équipe et les rôles (administrateur uniquement)

Vous pouvez inviter les personnes de votre équipe à travailler avec vous sur la plateforme. Chaque personne dispose d'un **rôle** qui définit ce qu'elle peut voir et faire :

| Rôle | Pour qui | Ce qu'elle peut faire |
|------|----------|-----------------------|
| **Administrateur** | Propriétaire / responsable du compte | Tout : configuration, canaux, agents IA, facturation, utilisateurs et données. |
| **Superviseur** | Chef d'équipe | Consulter et auditer les conversations, le CRM et les rapports ; piloter l'activité, sans toucher à la facturation ni aux réglages sensibles. |
| **Agent** | Personne en charge du service client | Traiter les conversations dans la boîte de réception et travailler avec les contacts qui lui sont assignés. |

### Comment inviter quelqu'un

1. Dans la barre latérale, ouvrez **Utilisateurs**.
2. Cliquez sur **Inviter un utilisateur** (ou **Ajouter un utilisateur**).
3. Saisissez son **e-mail**, choisissez son **rôle** et envoyez l'invitation.
4. La personne reçoit un e-mail contenant un lien pour accepter l'invitation et créer son mot de passe.

Depuis ce même écran, vous pouvez modifier le rôle d'un utilisateur ou désactiver son accès lorsqu'une personne quitte l'équipe.

> **Combien d'utilisateurs puis-je avoir** : consultez la capacité actuelle de votre compte dans **Administration → Forfait et facturation**.

---

## Authentification à deux facteurs (2FA)

L'authentification à deux facteurs ajoute une seconde couche de sécurité : en plus de votre mot de passe, un code temporaire est demandé lors de la connexion. Fortement recommandée, en particulier pour les administrateurs.

1. Ouvrez **Paramètres** → **Sécurité**.
2. Activez l'**Authentification à deux facteurs** et choisissez la méthode :
   - **Application d'authentification** (recommandé) : scannez le code QR avec Google Authenticator, Authy ou une application similaire, puis saisissez le code à 6 chiffres pour confirmer.
   - **E-mail** : vous recevez le code sur votre boîte mail à chaque connexion.
3. Lors de l'activation, des **codes de secours** sont générés. Conservez-les en lieu sûr : ils vous permettent de vous connecter si vous perdez l'accès à votre application ou à votre e-mail.

### Appareils de confiance

Lorsque vous vous connectez depuis votre ordinateur ou votre téléphone habituel, vous pouvez le marquer comme **appareil de confiance**. Tant que cette confiance reste valide, le code à deux facteurs n'est plus demandé sur cet appareil. Depuis **Paramètres** → **Sécurité**, vous voyez la liste et pouvez retirer les appareils que vous n'utilisez plus (par exemple, un appareil emprunté).

---

## Changer votre mot de passe

1. Ouvrez **Paramètres** → **Changer le mot de passe**.
2. Saisissez votre mot de passe actuel, puis le nouveau (deux fois).
3. Enregistrez. Utilisez un mot de passe long et unique, que vous ne réutilisez sur aucun autre service.

> Si vous avez **oublié** votre mot de passe et ne parvenez pas à vous connecter, utilisez l'option **Mot de passe oublié ?** sur l'écran de connexion : vous recevrez un code par e-mail pour en créer un nouveau.

---

## Authentification unique (SSO, administrateur uniquement)

Si votre entreprise utilise un système d'identité d'entreprise (par exemple celui de votre fournisseur de messagerie professionnelle), vous pouvez configurer l'**authentification unique (SSO)** afin que votre équipe se connecte avec les identifiants de l'entreprise, sans gérer de mots de passe distincts.

1. Ouvrez **Paramètres** → **Sécurité**.
2. Dans la section **SSO / SAML**, renseignez les informations fournies par votre fournisseur d'identité et téléchargez les données que celui-ci vous demande concernant Parallly.
3. Vous pouvez, en option, **forcer le SSO** afin que tous les utilisateurs de votre entreprise soient obligés de se connecter par cette voie.

> La disponibilité du SSO dépend de la configuration de votre compte. Si vous ne voyez pas l'option ou souhaitez de l'aide pour la configurer, écrivez-nous au support.

---

## Langue, thème et connexion

- **Langue de la plateforme** : vous pouvez utiliser l'interface en espagnol, anglais, portugais ou français. Le sélecteur de langue se trouve dans le menu de votre profil / la barre supérieure. Le modifier n'affecte pas la langue dans laquelle votre agent IA répond aux clients.
- **Thème clair ou sombre** : dans la barre supérieure, vous trouverez le sélecteur de thème (clair / sombre / automatique selon votre système).
- **Déconnexion pour inactivité** : par sécurité, si vous laissez votre session inactive trop longtemps, un avertissement apparaît avant qu'elle ne se ferme automatiquement. C'est normal ; il vous suffit de vous reconnecter.

---

## Questions fréquentes

**J'ai invité quelqu'un mais il ne reçoit pas l'e-mail.**
Demandez-lui de vérifier son dossier de courrier indésirable ou spam. Vérifiez aussi que l'adresse e-mail est correctement saisie. Vous pouvez renvoyer l'invitation depuis **Utilisateurs**.

**Un agent voit moins d'options que moi. Est-ce un problème ?**
Non. Chaque rôle ne voit que ce dont il a besoin pour son travail. Un agent voit la boîte de réception et ses contacts, mais pas la facturation ni la configuration : c'est normal et cela protège votre compte.

**J'ai activé l'authentification à deux facteurs et j'ai perdu mon téléphone.**
Utilisez l'un des **codes de secours** que vous avez conservés lors de l'activation. Si vous ne les avez pas non plus, écrivez-nous au support pour vérifier votre identité et récupérer l'accès.

**Puis-je obliger toute mon équipe à utiliser l'authentification à deux facteurs ?**
L'authentification à deux facteurs s'active utilisateur par utilisateur. Si vous devez l'imposer à l'échelle de toute l'entreprise ou utiliser un SSO obligatoire, contactez-nous pour examiner les options activées sur votre compte.

Vous avez encore des questions ? Écrivez-nous sur https://parallly-chat.cloud/support
