---
id: primeros-pasos
title: "Primeiros passos e configuração inicial"
routes: ["/admin/setup-wizard", "/admin", "/admin/channels", "/admin/agent", "/admin/settings/billing"]
roles: ["tenant_admin"]
keywords: ["primeiros passos", "começar", "cadastro", "criar conta", "onboarding", "configuracao inicial", "assistente de configuracao", "setup", "wizard", "conectar canal", "conectar whatsapp", "testar agente", "essenciais", "checklist", "seu progresso", "8/9", "tour", "trial", "usuario novo", "conheca seu agente", "conectar depois", "mostrar onde", "verificacao de e-mail", "proxima etapa", "quatro essenciais", "ja responde", "mudancas imediatas", "link de teste", "pagina de teste", "mostrar ao meu socio", "onde esta seu numero", "pergunta antes de conectar whatsapp", "caminho certo desde o inicio", "dia 0", "primeiro cliente real", "contagem regressiva", "fuso horario de cobranca", "meio de pagamento na meta", "por onde seus clientes escrevem", "canal recomendado", "incluido a partir do", "canal fora do meu plano", "confirmar e-mail para instagram", "continuar de onde parou", "colocar na minha bio", "chat web no meu plano", "trocar modelo"]
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

O Parallly envia um **código de 6 dígitos** para confirmar seu endereço de e-mail. Essa verificação **não bloqueia** a configuração: você pode confirmar seu agente, testá-lo no link dele e conectar o **WhatsApp** antes de concluí-la. **Instagram**, **Messenger** e **Telegram** precisam dela, e o assistente avisa **antes** de abrir qualquer janela: acima desses canais aparece "Antes de conectar Instagram, Messenger e Telegram, confirme seu e-mail" (só cita os que o seu plano inclui), com **Reenviar código** e **Já tenho o código** para digitá-lo. Enquanto estiver pendente, o painel também mostra um aviso com a opção de reenviar o código; se não chegar, confira a caixa de spam e verifique se o endereço está escrito corretamente.

## Conheça o seu agente: o assistente de configuração

Depois do cadastro, o painel abre **Conheça o seu agente**, um assistente de **três etapas** (também disponível na rota `/admin/setup-wizard`):

1. **Seu agente** — o Parallly prepara uma base para o seu setor e a mostra em quatro cartões: **o que você oferece**, **onde e quando atende**, **como compram ou reservam** e **perguntas frequentes**. Preços sugeridos são identificados como exemplos e respostas com dados pendentes não aparecem como prontas. Você pode escolher **Usar esta base**, ajustar nome e saudação e testar perguntas sugeridas no chat ao lado. Se uma resposta estiver errada, **Corrigir esta resposta** a salva como FAQ canônica que o agente pode usar. Depois da primeira resposta real, volta **Trocar modelo**. O que você salva é aplicado na hora.
2. **Por onde seus clientes escrevem para você?** — a etapa ordena os canais pela receita do seu tipo de negócio: em cima vai o que mais combina com ele, com o motivo (um salão de beleza, por exemplo, começa pelo Instagram; uma clínica, pelo WhatsApp). Se o seu ramo não traz recomendação, o WhatsApp vem primeiro. Um canal que o seu plano não inclui aparece com cadeado e **Incluído a partir do** seguido do nome do plano que o traz, **antes** de abrir qualquer janela, junto de **Ir para Plano e faturamento**; se o canal recomendado para o seu negócio for um deles, a etapa avisa e sugere começar, enquanto isso, por um que o seu plano inclui. O WhatsApp começa com a pergunta **Onde está hoje o seu número de WhatsApp?** e o botão que abre a janela da Meta (veja a seção seguinte); o Instagram abre a janela para entrar no Instagram e o Messenger a do Facebook, e o Telegram pede ali mesmo a chave que o @BotFather te dá. Quando você conecta Instagram, Messenger ou Telegram, a etapa confirma com um aviso próprio ("Instagram conectado") e diz como escrever para testar. Ao conectar o WhatsApp, a tela confere duas coisas antes de dizer que seu agente já responde: se falta ao número o **fuso horário de cobrança**, ela pede que você o confirme (o fuso do seu negócio já vem selecionado, então costuma bastar um toque), e mostra se sua conta do WhatsApp tem um **meio de pagamento na Meta**. Você pode seguir mesmo que falte algo e terminar depois em **Canais → WhatsApp**.
3. **Pronto** — diz que seu agente **já responde** pelo seu canal só quando isso é verdade, e cita os canais que você conectou; aí mande uma mensagem de outro celular para ver. Se o WhatsApp ficou conectado mas falta o fuso horário de cobrança ou o meio de pagamento, a tela diz o que falta e oferece **Terminar em Canais → WhatsApp**. Se você não conectou nenhum canal, ela diz que seu agente já responde pelo link dele e que fica pendente o canal com que a etapa anterior começou (WhatsApp, Instagram…). Abaixo, **Carregar o que o agente precisa saber** e **Convidar uma pessoa** aparecem como feitos se você já os fez e como pendentes se não; o que o Parallly não conseguiu conferir não aparece. Depois, o cartão **Primeiros passos** do Início mostra os essenciais que faltam.

Nesta etapa também aparece o cartão **o link do seu agente**: uma página pública — o endereço dela começa com `/w/` seguido de um identificador que nunca é o nome do seu negócio — onde qualquer pessoa pode conversar com seu agente igual a um cliente. Ela existe desde o dia 0, antes de conectar qualquer canal. O que ela é depende do seu plano:

- **Se o seu plano não inclui o chat web**, o link serve para **testar seu agente e mostrá-lo a alguém**: a plataforma paga as mensagens até um limite por conta, cada página tem um teto de mensagens por dia e a conversa nunca passa para uma pessoa. As ações são **Abrir**, **Copiar link** e **Mostrar ao meu sócio** (abre o WhatsApp com uma mensagem já escrita); abaixo, o cartão explica o que muda com um plano que inclua o chat web e oferece **Ver planos**. Ele não sugere colocá-lo na sua bio nem no seu site: seus clientes dariam com o teto e sem ninguém para atendê-los.
- **Se o seu plano inclui o chat web**, esse mesmo link é um **canal de verdade**: atende seus clientes com a cota do seu plano, sem o teto diário do teste, e pode passar a conversa para a sua equipe quando o cliente pede uma pessoa. Então o cartão ganha **Colocar na minha bio** (copia o link para Instagram → Editar perfil → Links) e **Colocar no meu site** (leva à tela do chat web, onde se cria o chat do seu site e se copiam as duas linhas).

Uma mudança de plano não transforma silenciosamente o link em atendimento real. Em **Administração → Canais**, a linha marcada **Nada para conectar** permite escolher explicitamente se o link continua como **teste** ou passa a **atendimento de clientes**; a segunda opção exige um plano com chat web. Essa escolha controla cotas, transferência humana e métricas a partir da próxima mensagem. A linha também oferece **Abrir** e **Copiar link**.

**Conectar depois** é uma saída válida: fica registrada, o assistente deixa você continuar e o cartão **Primeiros passos** do Início lembra você na etapa do canal, com **Continuar de onde parou** e o motivo: "Você deixou para depois." ou, se na pergunta do WhatsApp você respondeu **Outro provedor já usa esse número** ou **Não está comigo agora**, o que você deixou anotado. Nesses dois casos, **Continuar de onde parou** leva a **Canais → WhatsApp**, onde está a sua resposta; ela fica salva na sua conta, então você a vê igual de outro celular ou navegador. Não há um aviso separado para retomar: o cartão é o único lembrete. Apertar **Próximo** na etapa de conexão sem ter conectado conta igual: fica registrado como "conectar depois", nunca é pulado em silêncio. Nada do que você já configurou se perde.

Você pode reabrir o assistente quando quiser em **Configurações → Assistente de configuração**.

## Como conectar seu primeiro canal

Sem um canal conectado, a empresa **não recebe mensagens por esse canal**. Ao conectar o primeiro canal, seu agente padrão fica atribuído a ele e começa a responder por ali, do jeito que você testou no chat; não é preciso voltar ao editor. Comece pelo canal por onde seus clientes já escrevem para você: o assistente coloca em cima o que a receita do seu ramo recomenda. Se for o **WhatsApp**, o canal mais usado na América Latina, ele começa com uma única pergunta — onde está hoje o seu número? — para você escolher o caminho certo desde o início. Enquanto isso, seu agente já responde no link do seu agente, embora essa página não conte como canal conectado.

Antes de conectar o WhatsApp, tenha em mãos:

- Um **número de telefone**: seu número atual do WhatsApp Business, ou um novo que não tenha WhatsApp.
- Acesso ao **código de verificação** desse número (por SMS ou ligação).
- Uma **conta do Facebook** para autorizar a conexão com a Meta (dá para criar durante o processo).

Dicas úteis:

- Se você conectar seu número atual do WhatsApp Business, pode escanear um **código QR** pelo app para manter suas conversas.
- Se ainda não puder conectar, use **Conectar depois** e retome pelo cartão **Primeiros passos** do Início: a etapa fica pendente, não perdida.
- Você também pode conectar **Instagram**, **Messenger**, **Telegram** ou o **Chat web** para o seu site, conforme o que o seu plano incluir: os que ele não inclui aparecem com cadeado e **Incluído a partir do** antes de abrir qualquer coisa. Instagram, Messenger e Telegram pedem seu e-mail confirmado; o WhatsApp não. Email ainda não tem configuração de autosserviço certificada.

Mais adiante, você administra tudo em **Canais**, na seção **Administração** da barra lateral.

## O tour do produto e "Mostrar onde"

A última etapa do assistente oferece **Ver o tour do painel**: é o tour geral do **Início**, que destaca o agente, os canais, as conversas, as análises e, quando aplicável, a ferramenta específica do seu setor. Ele só abre se você pedir e não modifica nada.

Além desse tour geral, quando aquela tela ou aquela etapa têm roteiro, o cartão pendente, o painel de **Ajuda** da tela e o Parallly Assist mostram o botão **Mostrar onde** (ou **Mostrar como**): ele abre a tela certa e destaca, passo a passo, onde a mudança é feita. O roteiro **não modifica** nada sozinho; ele só leva você ao lugar exato.

Durante o seu dia 0, a etapa de conexão do assistente não mostra **Mostrar onde**: a pergunta da etapa já é o guia, e um roteiro por cima seria uma segunda voz. Ele volta depois da primeira resposta real do seu agente.

## O cartão "Primeiros passos"

**Primeiros passos** aparece no **Início** enquanto faltar algum dos **quatro essenciais**
disponíveis para seu plano e seu papel, nesta ordem:

- **conectar um canal** (WhatsApp, Instagram, Messenger, Telegram ou o chat web);
- **revisar seu agente** (nome, mensagem para quando não souber responder, regras e motivos para passar a um humano);
- **contar o que seu negócio faz** em Informações do negócio;
- **convidar uma pessoa** que receba as conversas quando a IA as transferir.

A etapa marcada **Próximo** é a que vale a pena fazer agora. Carregar conhecimento, confirmar o horário, preparar agendamentos ou o catálogo melhoram o agente, mas não são requisito para ele responder: ficam em **Saúde dos agentes**, não neste cartão. No Início, enquanto o cartão estiver lá, é ele que diz o que falta: o aviso global **Há algo importante para resolver nos seus agentes.** não aparece ali.

Cada item tem **Continuar**, que abre a tela onde isso é feito e, quando existe roteiro para aquela etapa, também **Mostrar onde**, que ainda destaca passo a passo o campo ou o botão exato. Algumas etapas não têm roteiro — o catálogo próprio do seu setor, por exemplo — e os papéis que não podem executar roteiros veem apenas **Continuar**. Cada etapa pendente abre uma rota permitida. O cartão desaparece ao concluir tudo e
não vira uma pílula flutuante `8/9`. Se o Parallly não puder verificar uma fonte,
mostra **Tentar novamente** em vez de afirmar que a etapa está incompleta. Tarefas
avançadas ficam em seus módulos e não aumentam esse progresso essencial.

Se você deixou o canal para depois, a etapa dele já não diz **Continuar**: diz **Continuar de onde parou**, com o motivo que você deu (veja **Conectar depois** acima).

## Seu dia 0: o painel não interrompe você

Até seu agente responder ao seu **primeiro cliente real** — ou até três dias depois de criar a conta, o que acontecer primeiro —, o painel não interrompe você: não aparecem a contagem regressiva do teste, o aviso para instalar o app, a saudação automática da ajuda ("Oi! Sou o Parallly") nem o aviso global da **Saúde dos agentes**, o que diz **Há algo importante para resolver nos seus agentes.** Terminar o assistente de configuração não encerra esse período; quem encerra é a primeira resposta do seu agente por um canal conectado ou pelo chat web do seu site, mesmo que seja você quem escreve de outro celular. O link do seu agente e o **Testar agente** não contam.

No **Início**, enquanto durar o dia 0 e o cartão **Primeiros passos** tiver algo pendente, o cartão é a tela: não aparecem os indicadores zerados, o painel de ajuda, a **Saúde dos agentes**, a atividade recente, o uso de IA nem a agenda vazia.

O que sempre aparece é uma falha real de entrega. Se um canal que você conectou não consegue responder — a conexão parou de funcionar, seu agente não tem canal atribuído, nenhum agente atende aquele canal ou o WhatsApp não consegue entregar as respostas —, o aviso global aparece mesmo assim e diz o motivo; no Início, quem diz é a etapa do canal do cartão **Primeiros passos**. Um aviso de restrição da sua conta, como plano vencido ou modo somente leitura, também aparece sempre.

## O que fazer primeiro: ordem recomendada

1. **Confirme seu agente** no assistente e teste no chat de teste.
2. **Conecte o canal por onde seus clientes escrevem para você** (o assistente coloca em cima o que o seu ramo recomenda). A partir desse momento o agente fica atribuído e responde por ali; no WhatsApp, confirme o fuso horário de cobrança se a tela pedir.
3. **Envie uma mensagem de outro celular** e confirme a resposta e a conversa em **Conversas**.
4. **Complete as informações e o conhecimento da empresa**: site, documentos, políticas, perguntas frequentes e o catálogo correspondente. Confirme também os preços de exemplo dos seus serviços em **Agendamentos** → **Serviços** para que o agente possa dizê-los.
5. **Ajuste o agente quando quiser**: tom, regras, saudação, ferramentas e atribuição do canal. Ao salvar, a mudança é aplicada na hora; teste no chat de teste.
6. **Convide sua equipe** em **Usuários** e atribua funções: administrador, supervisor ou agente.

## Perguntas frequentes

**Preciso de cartão para testar o Parallly?**
Depende da opção disponível para sua conta. O cadastro e **Plano e faturamento** informam se um método de pagamento é necessário e quando uma cobrança começaria.

**Quanto custam os planos?**
Abra **Administração → Plano e faturamento** para ver preços, moeda, ciclo e condições atuais.

**Quais canais o meu plano inclui?**
Em **Canais** você vê quais conexões pode ativar; **Plano e faturamento** mostra a disponibilidade e os limites da sua conta. No assistente, um canal que o seu plano não inclui aparece com **Incluído a partir do** e o nome do plano que o traz, antes de abrir qualquer janela.

**Posso ter vários agentes de IA?**
Sim, quando sua conta tiver capacidade disponível. Cada conexão usa seu próprio agente; confira o limite atual em **Plano e faturamento**.

**E o canal de SMS?**
O SMS não é um canal de conversa: ele serve para enviar notificações aos seus clientes usando créditos (1 crédito = 1 segmento de mensagem).

**O que é "o link do seu agente"?**
É uma página pública que existe desde o dia 0, antes de conectar qualquer canal, onde qualquer pessoa pode conversar com seu agente igual a um cliente. Se o seu plano não inclui o chat web, ela serve para testá-lo e mostrá-lo a alguém: a plataforma paga as mensagens até um limite por conta, cada página tem um teto de mensagens por dia e a conversa não passa para uma pessoa. Ao chegar no teto do dia, o próprio chat avisa e continua no dia seguinte; se o limite da conta acabar, o chat avisa que volta a funcionar quando o negócio ativar o chat web. Com um plano que inclui o chat web, o mesmo link é um canal de verdade: sem teto diário, com a cota do seu plano e com passagem para a sua equipe. Em nenhum caso conta como canal conectado: o cartão **Primeiros passos** continua pedindo um canal de verdade (WhatsApp, Instagram, Messenger, Telegram ou o chat web do seu site).

**Pulei o assistente, como retomo?**
Por **Configurações → Assistente de configuração**, ou direto na rota `/admin/setup-wizard`. Você também pode configurar cada peça separadamente pelos menus **Agente IA** e **Canais**: o cartão **Primeiros passos** do Início mostra os essenciais pendentes e, quando aquela etapa tem roteiro, o botão **Mostrar onde**.

**Preciso verificar meu e-mail antes de configurar o agente?**
Não. A verificação de e-mail não bloqueia o assistente, o link do seu agente nem a conexão do WhatsApp; você pode concluí-la quando o código chegar. Ela é necessária para conectar Instagram, Messenger ou Telegram — o assistente avisa antes de abrir qualquer janela — e para confirmar o fuso horário de cobrança do WhatsApp.

**Por que não vejo a contagem regressiva do meu teste?**
Porque sua conta está no dia 0: esse aviso, o de instalar o app e o aviso global da Saúde dos agentes esperam seu agente responder ao primeiro cliente real, ou passarem três dias desde que você criou a conta. As condições do seu teste estão sempre em **Administração → Plano e faturamento**.

**Posso usar o painel em outro idioma?**
Sim: espanhol, inglês, português e francês. Troque o idioma pelo seletor na parte superior do painel.

**Onde peço ajuda?**
Escreva para a gente em [parallly-chat.cloud/support](https://parallly-chat.cloud/support), ou pergunte ao copiloto dentro do painel.
