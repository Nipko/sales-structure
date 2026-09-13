---
id: primeros-pasos
title: "Primeiros passos e configuração inicial"
routes: ["/admin/setup-wizard", "/admin", "/admin/channels", "/admin/agent", "/admin/settings/billing"]
roles: ["tenant_admin"]
keywords: ["primeiros passos", "começar", "cadastro", "criar conta", "onboarding", "configuracao inicial", "assistente de configuracao", "setup", "wizard", "conectar canal", "conectar whatsapp", "testar agente", "essenciais", "checklist", "seu progresso", "8/9", "tour", "trial", "usuario novo", "conheca seu agente", "conectar depois", "mostrar onde", "verificacao de e-mail"]
---

# Primeiros passos e configuração inicial

Boas-vindas ao Parallly! Neste guia, acompanhamos você desde a criação da conta até o seu agente de IA responder à primeira mensagem.

## Como criar sua conta

1. Acesse [admin.parallly-chat.cloud](https://admin.parallly-chat.cloud) e clique em **Crie sua conta gratuita**.
2. Preencha seu nome, e-mail e senha, ou use **Continuar com o Google**.
3. Ao enviar o formulário você entra **direto no assistente de boas-vindas de 4 etapas**; neste momento não há nenhum código para esperar:
   - **Sua empresa** — nome do negócio, setor, subtipo e fuso horário (campos como site, telefone e descrição são opcionais, mas ajudam seu agente a responder melhor).
   - **Seus clientes** — para quem você vende. As opções se adaptam ao seu setor.
   - **Objetivos** — o que você quer alcançar: responder perguntas frequentes, agendar horários, vender, dar suporte e muito mais.
   - **Plano** — confira as opções atuais e escolha como começar.
4. Clique em **Criar minha conta**.

As condições de teste, preços e opções de pagamento aparecem no cadastro e em **Administração → Plano e faturamento**. Essa tela é a fonte atual para sua conta e país.

Ao terminar, o Parallly deixa seu espaço pré-configurado de acordo com o seu setor: um funil de vendas com etapas adaptadas, um agente de IA sugerido com nome e tom, perguntas frequentes básicas da sua área e as ferramentas próprias do seu ramo (cardápio, imóveis, passeios etc., conforme o caso).

## Verificar seu e-mail (quando se aplica)

O Parallly envia um **código de 6 dígitos** para confirmar seu endereço de e-mail. Essa verificação **não bloqueia** a configuração: você pode continuar configurando e conectar seu canal antes de concluí-la. Enquanto estiver pendente, o painel mostra um aviso com a opção de reenviar o código; se não chegar, confira a caixa de spam e verifique se o endereço está escrito corretamente.

## Conheça o seu agente: o assistente de configuração

Depois do cadastro, o painel abre **Conheça o seu agente**, um assistente de **três etapas** (também disponível na rota `/admin/setup-wizard`):

1. **Seu agente** — você não escolhe modelo: o Parallly já preparou um agente a partir do setor e dos objetivos que você declarou, com nome, papel e saudação. Esta etapa serve para **confirmá-lo ou ajustá-lo** (nome e mensagem de boas-vindas) e testá-lo no chat ao lado. Se preferir outra base, o botão secundário **Trocar modelo** leva à lista completa de agentes.
2. **Conecte o WhatsApp** — os requisitos, a rota de conexão e o botão que abre a janela da Meta (veja a seção seguinte).
3. **Pronto** — o que vem depois, com **três dos essenciais**: conectar o canal, carregar o que o agente precisa saber e somar a pessoa que recebe as conversas. O cartão **Primeiros passos** do Início calcula até seis etapas conforme seu plano, papel e setor, então pode mostrar mais do que esse resumo fixo.

**Conectar depois** é uma saída válida: fica registrada, o assistente deixa você continuar e o **Início lembra você** com o cartão **Primeiros passos** e um aviso para retomar. Nada do que você já configurou se perde.

Você pode reabrir o assistente quando quiser em **Configurações → Assistente de configuração**.

## Como conectar seu primeiro canal

Sem um canal conectado, a empresa **não recebe mensagens por esse canal**. Conectar o canal não publica o rascunho do agente: depois você precisa revisar a atribuição, testar o rascunho e publicar a versão aprovada. Recomendamos começar pelo **WhatsApp**, o canal mais usado na América Latina.

Antes de conectar o WhatsApp, tenha em mãos:

- Um **número de telefone**: seu número atual do WhatsApp Business, ou um novo que não tenha WhatsApp.
- Acesso ao **código de verificação** desse número (por SMS ou ligação).
- Uma **conta do Facebook** para autorizar a conexão com a Meta (dá para criar durante o processo).

Dicas úteis:

- Se você conectar seu número atual do WhatsApp Business, pode escanear um **código QR** pelo app para manter suas conversas.
- Se ainda não puder conectar, use **Conectar depois** e retome pelo cartão **Primeiros passos** do Início: a etapa fica pendente, não perdida.
- Você também pode conectar **Instagram**, **Messenger**, **Telegram** ou o **Chat web** para o seu site, conforme o que o seu plano incluir. Email ainda não tem configuração de autosserviço certificada.

Mais adiante, você administra tudo em **Canais**, na seção **Administração** da barra lateral.

## O tour do produto e "Mostrar onde"

Quando o assistente tem um rascunho de agente, a última etapa oferece **Revisar e publicar meu agente**. Esse roteiro não publica sozinho: passa pelo editor, teste, preparação e revisão do candidato e termina na confirmação da publicação. Conectar um canal e publicar o agente são estados independentes; o roteiro pede que você confira a atribuição antes de confirmar.

O tour geral do produto continua disponível no **Início**. Ele destaca o agente, os canais, as conversas, as análises e, quando aplicável, a ferramenta específica do seu setor.

Além desse tour geral, quando aquela tela ou aquela etapa têm roteiro, o cartão pendente, o painel de **Ajuda** da tela e o Parallly Assist mostram o botão **Mostrar onde** (ou **Mostrar como**): ele abre a tela certa e destaca, passo a passo, onde a mudança é feita. O roteiro **não modifica** nada sozinho; ele só leva você ao lugar exato.

## O cartão "Primeiros passos"

**Primeiros passos** aparece no **Início** enquanto houver etapas essenciais pendentes
e disponíveis para seu plano, papel e setor:

- **conectar o WhatsApp** (ou outro canal certificado disponível na sua conta);
- **revisar seu agente** (nome, mensagem para quando não souber responder, regras e motivos para passar a um humano);
- **contar o que seu negócio faz** em Informações do negócio;
- **carregar o que o agente precisa saber**: perguntas frequentes, documentos ou o catálogo do seu setor;
- **convidar uma pessoa** que receba as conversas quando a IA as transferir;
- **confirmar seu horário**, se o seu setor trabalha com agenda.

Cada item tem **Continuar**, que abre a tela onde isso é feito e, quando existe roteiro para aquela etapa, também **Mostrar onde**, que ainda destaca passo a passo o campo ou o botão exato. Algumas etapas não têm roteiro — o catálogo próprio do seu setor, por exemplo — e os papéis que não podem executar roteiros veem apenas **Continuar**. Cada etapa pendente abre uma rota permitida. O cartão desaparece ao concluir tudo e
não vira uma pílula flutuante `8/9`. Se o Parallly não puder verificar uma fonte,
mostra **Tentar novamente** em vez de afirmar que a etapa está incompleta. Tarefas
avançadas ficam em seus módulos e não aumentam esse progresso essencial.

## O que fazer primeiro: ordem recomendada

1. **Complete as informações e o conhecimento da empresa**: site, documentos, políticas, perguntas frequentes e o catálogo correspondente.
2. **Conecte o WhatsApp** (ou seu canal principal). A conexão ainda não coloca um rascunho para atender clientes.
3. **Ajuste o rascunho do agente**: tom, regras, saudação, ferramentas e atribuição do canal; teste no chat interno.
4. **Prepare, revise e publique** a versão aprovada. A publicação torna operacionais o conteúdo e as atribuições do rascunho.
5. **Envie uma mensagem do seu celular** e confirme a resposta e a conversa em **Conversas**.
6. **Convide sua equipe** em **Usuários** e atribua funções: administrador, supervisor ou agente.

## Perguntas frequentes

**Preciso de cartão para testar o Parallly?**
Depende da opção disponível para sua conta. O cadastro e **Plano e faturamento** informam se um método de pagamento é necessário e quando uma cobrança começaria.

**Quanto custam os planos?**
Abra **Administração → Plano e faturamento** para ver preços, moeda, ciclo e condições atuais.

**Quais canais o meu plano inclui?**
Em **Canais** você vê quais conexões pode ativar; **Plano e faturamento** mostra a disponibilidade e os limites da sua conta.

**Posso ter vários agentes de IA?**
Sim, quando sua conta tiver capacidade disponível. Cada conexão usa seu próprio agente; confira o limite atual em **Plano e faturamento**.

**E o canal de SMS?**
O SMS não é um canal de conversa: ele serve para enviar notificações aos seus clientes usando créditos (1 crédito = 1 segmento de mensagem).

**Pulei o assistente, como retomo?**
Por **Configurações → Assistente de configuração**, ou direto na rota `/admin/setup-wizard`. Você também pode configurar cada peça separadamente pelos menus **Agente IA** e **Canais**: o cartão **Primeiros passos** do Início mostra os essenciais pendentes e, quando aquela etapa tem roteiro, o botão **Mostrar onde**.

**Preciso verificar meu e-mail antes de configurar o agente?**
Não. A verificação de e-mail não bloqueia o assistente nem a conexão do canal; você pode concluí-la quando o código chegar.

**Posso usar o painel em outro idioma?**
Sim: espanhol, inglês, português e francês. Troque o idioma pelo seletor na parte superior do painel.

**Onde peço ajuda?**
Escreva para a gente em [parallly-chat.cloud/support](https://parallly-chat.cloud/support), ou pergunte ao copiloto dentro do painel.
