---
id: cuenta-seguridad
title: "Sua conta, equipe e segurança"
routes: ["/admin/users", "/admin/settings/security", "/admin/settings/change-password"]
roles: ["tenant_admin", "tenant_supervisor", "tenant_agent"]
keywords: ["conta", "segurança", "equipe", "usuários", "convidar usuário", "adicionar usuário", "cargos", "permissões", "administrador", "supervisor", "agente", "autenticação de dois fatores", "2fa", "autenticação", "código", "senha", "alterar senha", "dispositivos confiáveis", "sso", "login único", "saml", "idioma", "tema", "modo escuro", "sair", "inatividade", "sessão"]
---

# Sua conta, equipe e segurança

Cada usuário pode proteger a própria conta com 2FA, dispositivos confiáveis e alteração de senha. A administração da equipe, dos cargos e do SSO é exclusiva do papel **administrador**.

## Sua equipe e os cargos (somente administrador)

Você pode convidar as pessoas da sua equipe para trabalharem com você na plataforma. Cada pessoa tem um **cargo** que define o que ela pode ver e fazer:

| Cargo | Para quem | O que pode fazer |
|-----|-----------|-----------------|
| **Administrador** | Dono / responsável pela conta | Tudo: configurações, canais, agentes de IA, faturamento, usuários e dados. |
| **Supervisor** | Líder de equipe | Ver e auditar conversas, CRM e relatórios; gerenciar a operação, sem mexer em faturamento nem em ajustes sensíveis. |
| **Agente** | Pessoa do atendimento | Atender conversas na caixa de entrada e trabalhar com os contatos atribuídos. |

### Como convidar alguém

1. Na barra lateral, acesse **Usuários**.
2. Clique em **Convidar usuário** (ou **Adicionar usuário**).
3. Digite o **email** da pessoa, escolha o **cargo** e envie o convite.
4. A pessoa recebe um email com um link para aceitar o convite e criar sua senha.

Na mesma tela você pode alterar o cargo de um usuário ou desativar o acesso dele quando alguém sai da equipe.

> **Quantos usuários posso ter**: confira a capacidade atual da sua conta em **Administração → Plano e faturamento**.

---

## Autenticação de dois fatores (2FA)

A autenticação de dois fatores adiciona uma segunda camada de segurança: além da sua senha, é pedido um código temporário ao entrar. Muito recomendada, principalmente para administradores.

1. Acesse **Configurações** → **Segurança**.
2. Ative a **Autenticação de dois fatores** e escolha o método:
   - **App de autenticação** (recomendado): escaneie o código QR com o Google Authenticator, Authy ou similar e digite o código de 6 dígitos para confirmar.
   - **Email**: você recebe o código no seu email toda vez que entra.
3. Ao ativá-la, são gerados alguns **códigos de backup**. Guarde-os em um lugar seguro: eles permitem que você entre caso perca o acesso ao seu app ou ao seu email.

### Dispositivos confiáveis

Quando você entra do seu computador ou celular de sempre, pode marcá-lo como **dispositivo confiável**. Enquanto essa confiança estiver vigente, o código de dois fatores não será pedido nesse dispositivo. Em **Configurações** → **Segurança** você vê a lista e pode remover os dispositivos que não usa mais (por exemplo, um equipamento emprestado).

---

## Alterar sua senha

1. Acesse **Configurações** → **Alterar senha**.
2. Digite sua senha atual e depois a nova (duas vezes).
3. Salve. Use uma senha longa e única, que você não repita em outros serviços.

> Se você **esqueceu** a senha e não consegue entrar, use a opção **Esqueceu sua senha?** na tela de login: você receberá um código no seu email para criar uma nova.

---

## Login único (SSO, somente administrador)

Se a sua empresa usa um sistema corporativo de identidade (por exemplo, o do seu provedor de email empresarial), você pode configurar o **login único (SSO)** para que a sua equipe entre com as credenciais da empresa, sem precisar gerenciar senhas à parte.

1. Acesse **Configurações** → **Segurança**.
2. Na seção **SSO / SAML**, preencha os dados que o seu provedor de identidade fornece e baixe os dados que ele pede do Parallly.
3. Opcionalmente, você pode **forçar o SSO** para que todos os usuários da sua empresa tenham que entrar por essa via.

> A disponibilidade do SSO depende da configuração da sua conta. Se você não vê a opção ou quer ajuda para configurá-la, escreva para o suporte.

---

## Idioma, tema e login

- **Idioma da plataforma**: você pode usar a interface em espanhol, inglês, português ou francês. O seletor de idioma fica no menu do seu perfil / barra superior. Alterá-lo não afeta o idioma em que o seu agente de IA responde aos clientes.
- **Tema claro ou escuro**: na barra superior você encontra o seletor de tema (claro / escuro / automático conforme o seu sistema).
- **Encerramento de sessão por inatividade**: por segurança, se você deixar a sessão inativa por muito tempo, verá um aviso antes de ela ser encerrada automaticamente. É normal; basta entrar novamente.

---

## Perguntas frequentes

**Convidei alguém, mas o email não chega.**
Peça para a pessoa verificar a pasta de spam ou lixo eletrônico. Confira também se o email está escrito corretamente. Você pode reenviar o convite em **Usuários**.

**Um agente vê menos opções do que eu. Está errado?**
Não. Cada cargo vê apenas o que precisa para o seu trabalho. Um agente vê a caixa de entrada e seus contatos, mas não o faturamento nem as configurações: isso está correto e protege a sua conta.

**Ativei a autenticação de dois fatores e perdi meu telefone.**
Use um dos **códigos de backup** que você guardou ao ativá-la. Se também não os tiver, escreva para o suporte para verificar a sua identidade e recuperar o acesso.

**Posso obrigar toda a minha equipe a usar autenticação de dois fatores?**
A autenticação de dois fatores é ativada por usuário. Se você precisa exigi-la no nível de toda a empresa ou usar SSO obrigatório, entre em contato para revisar as opções habilitadas na sua conta.

Ainda com dúvidas? Escreva para nós em https://parallly-chat.cloud/support
