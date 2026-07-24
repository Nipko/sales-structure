---
id: canales-redes
title: "Conectar Instagram, Messenger e Telegram"
routes: ["/admin/channels", "/admin/channels/instagram", "/admin/channels/messenger", "/admin/channels/telegram"]
roles: ["tenant_admin"]
keywords: ["instagram", "messenger", "telegram", "facebook", "conectar canal", "conectar instagram", "conectar messenger", "conectar telegram", "reconectar", "token expirado", "bot", "botfather", "mensagens diretas", "dm", "direct", "desconectar canal", "conta business", "varias contas", "limite de contas", "pagina do facebook", "redes sociais"]
---

Além do WhatsApp, seu negócio pode atender clientes pelo **Instagram**, **Messenger** e **Telegram**. Os três são conectados na seção **Canais** da barra lateral, e cada conexão pode ter seu próprio agente de IA. Aqui explicamos o que você precisa, como conectar cada um, o que significam os status e o que fazer quando uma conexão expira.

> Somente o papel de **administrador** pode conectar e desconectar canais. Supervisores e agentes podem ver o status, mas não alterá-lo.

## Antes de começar: requisitos por canal

| Canal | Você precisa de |
|-------|-----------|
| Instagram | Uma conta de **Instagram Business** (contas pessoais não funcionam; é uma exigência da Meta, não da Parallly) |
| Messenger | Uma conta do Facebook com acesso de administrador à **página do Facebook** do seu negócio |
| Telegram | Um **bot do Telegram** criado com o @BotFather (a gente te guia passo a passo; leva menos de 2 minutos) |

## Como conectar o Instagram

1. Na barra lateral, entre em **Canais** e localize o card do **Instagram**.
2. Clique em **Conectar**.
3. Na página do Instagram, clique em **Conectar com Instagram**. Uma janela pop-up da Meta será aberta.
4. Faça login com sua conta de **Instagram Business** e aceite as permissões de mensagens que a Meta solicitar.
5. A janela fecha sozinha e você verá sua **Conta conectada** com o nome e o usuário do seu perfil.

A partir daí, as mensagens diretas (DM) do Instagram chegam à sua caixa de entrada e seu agente de IA pode respondê-las.

### Quando e como reconectar o Instagram

A autorização que a Meta concede à Parallly para a sua conta do Instagram **dura 60 dias**. Você não precisa fazer nada para mantê-la: a Parallly a renova automaticamente todos os dias quando o vencimento se aproxima.

- No card do canal você verá o aviso "**O token expira em X dias**", apenas informativo.
- Se a renovação automática falhar (por exemplo, porque você trocou a senha ou as permissões no Instagram), você receberá um alerta e verá a mensagem "**Token expirado. Por favor reconecte sua conta.**".
- Nesse caso, clique em **Reconectar** e repita o login com o Instagram. Suas conversas e o histórico ficam intactos.

## Como conectar o Messenger

1. Na barra lateral, entre em **Canais** e localize o card do **Messenger**.
2. Clique em **Conectar**.
3. Clique em **Conectar com Facebook**. A janela de login do Facebook será aberta.
4. Faça login, **selecione a página do Facebook** do seu negócio e conceda as permissões de mensagens solicitadas.
5. Pronto: você verá sua **Página conectada** e as mensagens do Messenger começarão a chegar à sua caixa de entrada.

## Como conectar o Telegram

1. Na barra lateral, entre em **Canais** e localize o card do **Telegram**. Clique em **Conectar**.
2. **Passo 1 — Crie seu bot no Telegram** (menos de 1 minuto):
   - Abra o Telegram e procure por **@BotFather** (o assistente oficial do Telegram para criar bots), ou use o botão **Abrir @BotFather**.
   - Envie o comando `/newbot` e escolha um nome e um usuário para o seu bot.
   - O BotFather vai te enviar um **token**: copie-o.
3. Clique em **Já tenho o token**.
4. **Passo 2 — Cole o token do seu bot** no campo indicado e clique em **Conectar bot**. O token é guardado criptografado e nunca aparece em texto puro.
5. Você verá a confirmação "**Bot conectado!**". A Parallly completa o resto da configuração automaticamente.
6. Use **Abrir no Telegram** para mandar uma mensagem de teste para o seu bot e verificar que o agente de IA responde.

## Status de uma conexão

Na página **Canais**, cada card mostra o status atual:

- **Conectado** (selo verde): o canal recebe e envia mensagens normalmente. O botão muda para **Configurar** para acessar os detalhes.
- **Desconectado** (selo vermelho): o canal não está ativo. Entre no card para conectá-lo ou reconectá-lo.
- **Contador de contas** ("X/Y contas"): quantas conexões desse tipo você tem ativas e quantas o seu plano permite. Se ainda houver espaço, aparece o link **Adicionar outra**.

Lembre-se: cada conexão precisa de um agente de IA atribuído para responder automaticamente. A atribuição é feita no editor do agente (seção **Agente IA**), e vale a regra de **um agente por conexão**.

## Várias contas do mesmo canal

Dependendo do seu plano, você pode conectar mais de uma conta do mesmo tipo (por exemplo, duas contas de Instagram ou dois bots do Telegram) sem que as conversas se misturem. Limites incluídos por plano:

| Plano | Instagram | Messenger | Telegram |
|------|:---------:|:---------:|:--------:|
| Emprendedor | 1 | 1 | 1 |
| Starter | 1 | 1 | 1 |
| Pro | 1 | 3 | 1 |
| Enterprise | 2 | 5 | 2 |
| Custom | Ilimitado | Ilimitado | Ilimitado |

Se você precisar de mais conexões do que o seu plano inclui, escreva para o [suporte](https://parallly-chat.cloud/support): os limites podem ser ampliados para a sua conta.

## Como desconectar uma conta

A desconexão é **por conta**: se você tem várias conexões do mesmo canal, desconectar uma não afeta as outras.

1. Entre em **Canais**, abra o canal e escolha a conexão que quer remover.
2. Clique em **Desconectar** e confirme no modal.
3. O resultado mostra exatamente o que aconteceu:
   - **Verde** — "Desconectado completamente": tudo foi encerrado também do lado do provedor (Meta ou Telegram).
   - **Amarelo** — "Desconectado na plataforma": a Parallly não vai mais processar mensagens, mas vale conferir a integração no provedor (por exemplo, no Meta Business Suite), porque a autorização pode ter expirado antes de o encerramento ser concluído.
   - **Vermelho** — houve um erro de rede: tente de novo.

## Perguntas frequentes

**Posso conectar meu Instagram pessoal?**
Não. Só funcionam contas de **Instagram Business**. É uma exigência da Meta. Converter sua conta pessoal em Business é grátis e se faz pelo próprio app do Instagram.

**Preciso reconectar o Messenger ou o Telegram de tempos em tempos?**
Não. A renovação periódica só vale para o Instagram, e normalmente é automática. Você só precisará agir se receber um alerta de que a renovação falhou.

**Posso ter um agente de IA diferente em cada canal?**
Sim: a regra é **um agente por conexão**. Você pode ter, por exemplo, um agente mais formal no Messenger e outro mais descontraído no Instagram, conforme o que o seu plano permitir.

**Conectei o canal mas o bot não responde. O que verifico?**
Verifique duas coisas nesta ordem: se o card do canal mostra **Conectado**, e se a conexão tem um agente de IA atribuído na seção **Agente IA**. Se as duas estiverem certas e mesmo assim não responder, fale com a gente no [suporte](https://parallly-chat.cloud/support).

**O que acontece com minhas conversas se eu desconectar e conectar de novo?**
Nada se perde: o histórico de conversas e seus contatos são preservados. Ao reconectar, as novas mensagens retomam a conversa existente.
