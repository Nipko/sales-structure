---
id: multi-cuenta
title: "Várias conexões do mesmo canal (multiconta)"
routes: ["/admin/channels", "/admin/agent", "/admin/broadcast", "/admin/channels/whatsapp/templates"]
roles: ["tenant_admin"]
keywords: ["multiconta", "varias contas", "dois numeros de whatsapp", "segundo numero", "outra conta de instagram", "limite de contas", "conectar outra conta", "adicionar outra", "desconectar uma conta", "numero remetente", "escolher numero", "enviar do numero", "contas por canal", "varias conexoes", "duas contas", "contador de contas", "limite por plano", "varios numeros"]
---

# Várias conexões do mesmo canal (multiconta)

Seu negócio tem um número de WhatsApp para vendas e outro para suporte? Ou duas contas de Instagram para marcas diferentes? Com a Parallly você pode conectar **mais de uma conta do mesmo canal** — por exemplo dois números de WhatsApp, duas contas de Instagram ou dois bots do Telegram — e cada uma funciona de forma independente: as conversas nunca se misturam e cada conexão pode ter seu próprio agente de IA.

> Conectar, desconectar e revisar contas de canal é tarefa do papel de **administrador**. Supervisores podem escolher um remetente disponível dentro do fluxo de campanhas, mas não gerenciam canais nesta tela.

## Capacidade de conexões

A quantidade e os tipos de conexão disponíveis dependem da configuração da sua conta. Cada card de **Canais** mostra o uso atual e se outra conexão pode ser adicionada; **Plano e faturamento** mostra o limite vigente. O chat web é administrado em sua própria tela.

## Como ver quantas contas você tem conectadas

1. Na barra lateral, entre em **Canais**.
2. Cada card de canal mostra o uso atual e o limite aplicável à sua conta. Se a capacidade for ilimitada, o símbolo ∞ pode aparecer.
3. Quando ainda há espaço, o card mostra o link **Adicionar outra**.

## Como conectar outra conta do mesmo canal

1. Entre em **Canais** e localize o card do canal (por exemplo, WhatsApp).
2. Clique em **Adicionar outra**.
3. Siga o mesmo processo de conexão de sempre: login com a Meta para WhatsApp, Instagram ou Messenger, ou o token do @BotFather para o Telegram.
4. Ao terminar, a nova conta aparece no card do canal junto com as demais, com seu próprio nome ou número.

Cada conta guarda a sua própria autorização, então as mensagens sempre saem pelo número ou pela conta certos.

> Se o link **Adicionar outra** não aparecer, você já atingiu o limite do seu plano para aquele canal.

## Cada conexão com seu próprio agente de IA

Na Parallly a regra é **um agente de IA por conexão**, não por canal. Ou seja, se você tem dois números de WhatsApp, pode atribuir um agente diferente a cada um — por exemplo, "Sofía" para o número de vendas e "Carlos" para o de suporte.

Para atribuí-los:

1. Na barra lateral, entre em **Agente IA** e abra o agente que quer configurar.
2. Na seção **Atribuição de canais**, você verá uma opção para **cada conta conectada**, identificada pelo nome ou número (por exemplo, "WhatsApp · Vendas +57 300…").
3. Marque as conexões que esse agente deve atender e clique em **Salvar alterações** na barra inferior.

Se você atribuir a esse agente uma conexão que outro agente já atendia, a plataforma avisa antes de salvar: a conexão passará para o novo agente.

## Como desconectar uma conta específica

A desconexão é **por conta**: você pode desconectar um número sem afetar os demais.

1. Entre em **Canais** e clique no canal.
2. Localize a conta específica que quer desconectar e clique em **Desconectar**.
3. Confirme na mensagem: "Desconectar esta conta? As demais contas deste canal continuarão ativas."
4. Confira o resultado no modal de confirmação: verde significa desconexão completa; amarelo significa que ela foi desconectada na Parallly, mas vale a pena conferir também a sua conta no provedor (por exemplo, o Meta Business Suite).

## Escolher o número remetente nas campanhas

Quando você tem mais de um número de WhatsApp conectado, o rascunho da campanha permite escolher o remetente:

1. Na barra lateral, entre em **Campanhas** e crie uma **Nova campanha**.
2. No formulário você verá o campo **Enviar do número**.
3. Escolha o número remetente, ou deixe **Número principal (padrão)**.
4. Salve o rascunho sem agendar nem lançar. O envio de produção pelo editor não está certificado de ponta a ponta e campanhas agendadas não têm ação de cancelamento; consulte **Campanhas e disparo** antes de operar.

## Templates de WhatsApp com vários números

Os templates aprovados pela Meta pertencem a um número específico. Se você tem vários números:

1. Entre em **Canais → WhatsApp** e clique em **Ver todos os templates**.
2. Ao criar um template, aparece o campo **Número / conta**: escolha para qual número você está criando, ou deixe **Número principal (padrão)**.
3. Envie para aprovação e confira o estado recebido da Meta. Ao preparar um rascunho, escolha template e remetente da mesma conta; isso não elimina a limitação atual do lançamento de campanhas.

## Perguntas frequentes

**As conversas dos meus dois números podem se misturar?**
Não. Cada conexão mantém suas conversas separadas na caixa de entrada, e as respostas sempre saem pela mesma conta pela qual o cliente escreveu.

**Posso atribuir dois agentes de IA ao mesmo número?**
Não. Cada conexão tem exatamente um agente atribuído. O que você pode fazer é atribuir o mesmo agente a várias conexões.

**Cheguei ao limite de contas do meu plano, e agora?**
Confira as opções atuais em **Administração → Plano e faturamento**, ou fale com a gente em https://parallly-chat.cloud/support se o seu negócio precisar de outra capacidade.

**Se eu desconectar uma conta, as outras continuam funcionando?**
Sim. A desconexão é individual: as demais contas do mesmo canal continuam recebendo e respondendo mensagens normalmente.

**A multiconta vale para o chat web?**
O widget de chat web é configurado à parte em **Configurações → Canais e integrações**. A multiconta vale somente para as conexões que a tela **Canais** permitir adicionar.

**Contas de canais diferentes contam para o mesmo limite?**
Não necessariamente. A tela calcula a capacidade por tipo de canal e mostra cada uso separadamente.

Dúvidas? Escreva para a gente em https://parallly-chat.cloud/support — será um prazer ajudar.
