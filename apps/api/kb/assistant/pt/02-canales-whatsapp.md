---
id: canales-whatsapp
title: "Conectar o WhatsApp"
routes: ["/admin/channels", "/admin/channels/whatsapp", "/admin/channels/whatsapp/templates"]
roles: ["tenant_admin"]
keywords: ["whatsapp", "conectar whatsapp", "numero de whatsapp", "whatsapp business", "coexistencia", "app do whatsapp", "migrar numero", "templates", "modelos", "modelo whatsapp", "sincronizar conversas", "historico de conversas", "codigo qr", "verificacao", "meta", "facebook", "desconectar whatsapp", "janela de 24 horas", "varias contas", "segundo numero", "exige reautorizar", "popup bloqueado", "conexao com avisos", "negocio nao verificado", "cobranca da meta", "meta cobra", "custo do whatsapp", "forma de pagamento", "cartao na meta", "mensagens de servico", "mil mensagens gratis", "teto de gasto", "envio pausado", "parou de responder", "1 de outubro", "fatura da meta"]
---

# Conectar o WhatsApp

O WhatsApp é o canal principal do Parallly: ao conectá-lo, seu agente de IA começa a receber e responder as mensagens dos seus clientes nesse número, com o seu catálogo, a sua agenda e as informações do seu negócio. A conexão é oficial, feita através da Meta (a empresa dona do WhatsApp), e leva entre 5 e 20 minutos dependendo do método que você escolher.

## Antes de começar

- Você precisa ser **administrador** da sua conta Parallly; a administração de canais não está disponível para supervisores nem agentes.
- Você precisa de uma conta do Facebook com acesso ao negócio no Meta Business Suite.
- Deixe à mão o número de telefone que vai usar: ele deve poder receber SMS ou chamadas (números virtuais VoIP e linhas premium não funcionam).
- A tela **Canais** informa se o WhatsApp está habilitado para sua conta.

## Como conectar seu número

1. Na barra lateral, seção **Administração**, entre em **Canais**.
2. No card do **WhatsApp**, clique em **Conectar**.
3. Antes das rotas aparece **"Antes de conectar o WhatsApp"**: uma lista curta com o número, o acesso ao código de verificação dele e a conta do Facebook. Marque os três itens e clique em **Continuar**; até confirmar, o botão diz **Confirme os itens para continuar**. É um lembrete, não uma validação: nada dos seus dados é conferido ali. A mesma etapa aparece no assistente **Conheça o seu agente** e na tela do **WhatsApp**.
4. Você verá a tela **"Escolha seu método de conexão"** com três rotas:
   - **WhatsApp Business App** (etiqueta **Coexistência**, marcada **Recomendado**, ~20 min) — se você já usa o app WhatsApp Business no seu celular e quer mantê-lo junto com suas conversas. É a rota que sugerimos; veja a próxima seção.
   - **Número novo** (~5 min) — para um número que nunca foi usado no WhatsApp. É o caminho mais rápido se você vai estrear uma linha.
   - **Migrar de outro provedor** (~15 min) — se você já usa o WhatsApp com outra plataforma (Wati, 360dialog, Twilio, etc.) e quer trazer seu número sem ficar fora do ar.
5. Escolha seu método e clique em **Conectar com Facebook**. Uma janela da Meta será aberta.
6. Faça login com sua conta do Facebook e selecione (ou crie) seu portfólio do Meta Business.
7. Selecione ou adicione sua conta do WhatsApp Business e o número de telefone.
8. Verifique o número com um **código por SMS ou chamada de voz** e aprove as permissões.
9. Você acompanhará o progresso na tela: **Autorização → Conectando número → Ativando WhatsApp**. Ao terminar, aparece "Conexão bem-sucedida!" e seu agente já responde nesse número.

> Dica: assim que conectar, a tela mostra o card **"Teste seu agente"** com o seu número. Mande um WhatsApp de outro celular e veja como ele responde.

### Se a janela da Meta não aparecer

A autorização acontece em uma janela pop-up da Meta. Se nada abrir ao clicar, ou se o
botão ficar esperando, quase sempre é o navegador bloqueando pop-ups:

1. Permita pop-ups para `admin.parallly-chat.cloud` pelo ícone de bloqueio da barra de
   endereços.
2. Clique de novo em **Conectar com Facebook**.
3. Não feche a janela da Meta até ver a mensagem de conexão concluída. Se você a fechou no
   meio do caminho, comece de novo em **Canais**.

Esse passo funciona melhor em um computador: no celular a janela da Meta abre como outra
aba e é fácil perdê-la de vista.

### Conexão concluída com avisos

Às vezes a conexão se completa, mas algo continua pendente do lado da Meta. Nesse caso a
tela não mostra um sucesso limpo: aparece um **card âmbar** com os avisos. Os mais comuns:

- **Negócio não verificado na Meta** — o número fica conectado, com limites de envio mais
  baixos, até você concluir a verificação do negócio no Meta Business Suite.
- **Assinatura do webhook falhou** — o Parallly não ficou inscrito nas mensagens recebidas
  desse número, então o agente pode não receber nada. Tente conectar de novo e, se
  repetir, fale com o suporte.
- **Registro do número pendente** — a Meta terminou de registrar o número depois do resto
  da conexão. Costuma se resolver sozinho em alguns minutos; volte à tela e confirme que o
  número ficou ativo.
- **Não conseguimos trazer seus modelos** — a sincronização de modelos falhou. A conexão
  funciona do mesmo jeito; sincronize de novo em **Modelos** quando quiser.

Leia o aviso antes de dar a instalação por concluída: o card âmbar significa "conectado,
mas confira isto", não "tudo pronto".

## Modo coexistência: mantenha seu app WhatsApp Business

Se hoje você atende seus clientes pelo app WhatsApp Business no celular, não precisa abandoná-lo. Com o método **WhatsApp Business App** (Coexistência), seu número fica conectado ao Parallly **e** continua funcionando no seu celular ao mesmo tempo: a IA responde pela plataforma e você pode continuar conversando pelo app quando quiser.

Passos específicos desse método:

1. Faça login com sua conta do Facebook e selecione seu portfólio do Meta Business.
2. **Escaneie o código QR pelo seu app WhatsApp Business** (como quando você vincula o WhatsApp Web).
3. **Autorize a sincronização de histórico e contatos**. Importante: você tem **24 horas** para autorizá-la depois de conectar; se o prazo passar, será preciso repetir a conexão do zero.

Requisitos: app WhatsApp Business atualizado (versão 2.24.17 ou superior), número com pelo menos 7 dias de atividade no app e uma conexão WiFi estável (a sincronização pode levar várias horas).

**O que sincroniza com o Parallly:**

- Chats individuais dos últimos **6 meses** (texto)
- Imagens, vídeos e áudios dos últimos 14 dias
- Seus contatos salvos no app
- As novas mensagens que você enviar pelo app, em tempo real

**O que NÃO sincroniza:** chats em grupo, mensagens temporárias ou de "visualização única", arquivos de mídia com mais de 14 dias e o catálogo de produtos do app.

**Limitações do modo coexistência:**

- Você deve **abrir o app WhatsApp Business pelo menos a cada 14 dias** para manter a conexão ativa.
- Os dispositivos vinculados (WhatsApp Web/Desktop) são desconectados ao ativar; você pode reconectá-los depois.
- As listas de transmissão do app passam para modo somente leitura.
- A velocidade de envio é um pouco menor (~20 mensagens por segundo), suficiente para a grande maioria dos negócios.

## Status do canal

Em **Canais**, cada card mostra o status da conexão:

- **Conectado** — o número está ativo e o agente responde.
- **Conectado** + **Reconectar: credenciais expiradas** — o card mostra as duas etiquetas
  ao mesmo tempo: a verde de sempre e, ao lado, uma vermelha. A conexão existe, mas a
  permissão que o Parallly usa para enviar está vencida, revogada, com erro ou ausente. O
  número pode continuar recebendo mensagens e as respostas não saem até você autorizar de
  novo em **Conectar**.
  A **Saúde dos agentes** reporta isso como conexão operacional afetada e trata como ação
  crítica do agente.
- **Desconectado** — ainda não há conexão, ou ela foi desfeita.

Ao entrar em **WhatsApp** com um número conectado, você verá o card **Canal Ativo** com o **Número**, o **Nome verificado** e a **Qualidade** (a nota que a Meta dá ao seu número de acordo com a forma como os clientes recebem suas mensagens; mantê-la "alta" garante melhores limites de envio). Você também encontrará o card **Perfil comercial** com o botão **Gerenciar perfil** para editar as informações que seus clientes veem no WhatsApp.

## O que a Meta cobra da sua conta do WhatsApp

A partir de **1º de outubro de 2026**, a Meta cobra da **sua própria conta do WhatsApp Business** cada **mensagem de serviço entregue**: as respostas do agente e as da sua equipe dentro da janela de 24 horas. O que os seus clientes escrevem continua sem custo.

Essa cobrança **não é da Parallly**. Perante a Meta, a Parallly é provedora de tecnologia: não fatura essas mensagens, não as paga à Meta por você e não as inclui na sua assinatura. São dois pagamentos distintos e nenhum substitui o outro:

- **Sua assinatura da Parallly** — o software. Gerenciada em **Administração → Plano e faturamento**.
- **As mensagens que o WhatsApp entrega** — pagas pelo seu negócio à Meta, com a forma de pagamento cadastrada na **sua** conta do WhatsApp Business.

Mudar de plano na Parallly não muda o que a Meta cobra.

### A forma de pagamento fica na Meta, não na Parallly

Ela é adicionada nas ferramentas da Meta (WhatsApp Manager → configurações da conta → **Faturamento e pagamentos**), com um usuário que administre essa conta do WhatsApp Business. Se o seu portfólio da Meta já tiver uma forma de pagamento cadastrada — por exemplo, para anúncios —, você pode escolhê-la para esta conta sem cadastrá-la de novo.

**A Parallly nunca pede o número de um cartão por chat**: nem o agente, nem o Parallly Assist, nem o suporte. Se alguém pedir isso dentro de uma conversa, não somos nós.

### Sem forma de pagamento, o número deixa de entregar

Não é que funcione pior: a partir de 1º de outubro de 2026, uma conta do WhatsApp Business sem forma de pagamento **deixa de entregar as mensagens de serviço**, mesmo que você não tenha gasto nada no mês. De fora, parece um agente que parou de responder.

O que continua funcionando: as mensagens que chegam são recebidas, guardadas e aparecem na **Caixa de entrada**. A conversa não se perde; o que não sai é a resposta.

### Como saber se o seu número está pronto

1. Abra **Canais → WhatsApp** e veja o cartão **Cobrança do WhatsApp (Meta)**: ele mostra se algum número ficou com o envio pausado.
2. Confirme nas ferramentas da Meta que **aquela** conta do WhatsApp Business tem forma de pagamento, moeda e fuso horário definidos. Os três são necessários: se faltar um, a cobrança não pode ser feita.
3. **Um cartão cadastrado não garante que a cobrança seja aprovada.** A Meta pode dizer que há forma de pagamento e o banco recusar mesmo assim: cartão vencido, sem compras internacionais habilitadas, sem limite ou com dados fiscais incompletos. "Cadastrado" só significa que não é isso que está faltando.

### As 1.000 mensagens de serviço grátis

Cada **número** recebe **1.000 mensagens de serviço grátis por mês civil**. A Meta cobra a partir da mensagem 1.001.

O que a cota **não** é:

- **Não é por país.** Um número que atende nove países tem mil grátis no total, não mil por país.
- **Não é por contato nem por conversa.** Contam-se mensagens entregues, não pessoas.
- **Não cobre modelos.** Modelos de marketing, utilidade e autenticação são cobrados à parte e não consomem a cota.
- **Não acumula.** O que não for usado neste mês não passa para o seguinte.
- **Não é por conta nem por plano.** É por número: com dois números conectados, cada um traz a sua própria cota.

O mês fecha no **fuso horário da sua conta do WhatsApp Business**, que pode não ser o seu. Se na Parallly você vê um período de 30 dias e na Meta um mês civil, são períodos diferentes.

### O que você vê na Parallly, e o que não

Em **Canais → WhatsApp**, o cartão **Cobrança do WhatsApp (Meta)** mostra quanto já foi da cota grátis, o gasto do período separado por moeda, para onde ele foi e quais números estão pausados. Só o **administrador** o lê: **Canais** é uma tela de administração, não aparece no menu de supervisores nem de agentes e, se digitarem o endereço, o painel os redireciona. Quem não for administrador e precisar do dado tem de pedi-lo. Retomar um número também é do administrador.

É a medição do **que a Parallly enviou** por aquela conexão, não uma cópia da fatura da Meta. A fatura é emitida pela Meta e consultada nas ferramentas da Meta.

### O que um teto de gasto pode e o que não pode prometer

Um teto de gasto limita **o que a Parallly envia** por aquela conexão durante o período. Hoje o medidor **registra**: conta, avisa e por padrão **não freia nenhum envio**. Não há uma tela para definir um teto; a contenção é habilitada conta a conta, depois de olhar o que o medidor registrou.

E mesmo ativo, há três coisas que um teto **não** pode prometer:

- **Não limita o que outra ferramenta cobra da mesma conta.** Se outro sistema — ou a sua equipe pelo app do WhatsApp Business — enviar por essa mesma conta do WhatsApp Business, esse consumo cai na mesma fatura da Meta, e a Parallly não o vê nem o pode frear.
- **Não é um limite aplicado pela Meta.** A Meta não conhece o seu teto: continua entregando e cobrando o que chegar, venha de onde vier.
- **Não reduz a tarifa.** Corta volume, não o preço por mensagem.

### Se um número ficar com o envio pausado

Quando a Meta responde que aquela conta **não pode ser faturada**, a Parallly pausa os envios cobráveis **daquele número** — só dele, não dos demais — e não tenta de novo: cada tentativa seria idêntica e falharia igual até alguém agir do lado da Meta.

1. Em **Canais → WhatsApp** você verá **Envio pausado**, com o motivo e desde quando.
2. Corrija a forma de pagamento nas ferramentas da Meta.
3. Volte à Parallly e toque em **Retomar envios** (só administrador). É a sua declaração de que resolveu, não uma verificação: se a Meta recusar a cobrança de novo, o número se pausa sozinho na próxima tentativa e o motivo aparece ali outra vez.

Enquanto a pausa durar, as mensagens que chegam continuam sendo recebidas.

## Modelos do WhatsApp

O WhatsApp permite responder livremente durante as **24 horas** seguintes à última mensagem do cliente. Para escrever para ele **fora** dessa janela — por exemplo, um lembrete de agendamento ou uma campanha — você precisa de um **modelo aprovado pela Meta**.

Para gerenciá-los: **Canais → WhatsApp → Ver todos os modelos** (a página **Modelos do WhatsApp**).

- **Sincronizar com a Meta** — traz para o Parallly os modelos que você já tem aprovados na sua conta.
- **Criar template** — crie um novo sem sair do Parallly: nome, idioma, categoria, corpo com variáveis (por exemplo `{{1}}` para o nome do cliente), cabeçalho, rodapé e até 3 botões, com pré-visualização ao vivo. Ao terminar, clique em **Enviar para a Meta**; a Meta determina o status e o prazo da análise.
- Cada modelo mostra seu status: **Aprovado**, **Pendente** ou **Rejeitado** (com o motivo da rejeição para você corrigir e enviar de novo).
- Ao conectar o WhatsApp, o Parallly envia automaticamente **4 modelos iniciais** já validados (lembrete de agendamento, confirmação de presença, confirmação de pedido e pagamento recebido) para você ter por onde começar.

## Mais de um número de WhatsApp?

Você pode conectar vários números quando sua conta tiver capacidade. O card do WhatsApp mostra o uso atual e o botão **Adicionar outra** enquanto houver vaga. Confira o limite atual em **Plano e faturamento**.

Cada conexão é independente: tem seu próprio agente de IA (você o atribui no editor do agente) e suas conversas não se misturam. Um rascunho de campanha pode registrar o número remetente previsto, mas não lance campanhas reais pelo editor atual: a vinculação exata de modelo/remetente e o cancelamento ainda não estão certificados de ponta a ponta. Se precisar de mais números do que a configuração vigente da sua conta permite, escreva para o [suporte](https://parallly-chat.cloud/support).

## Como desconectar um número

1. Entre em **Canais**, abra **WhatsApp** e escolha a conexão que quer remover.
2. Clique em **Desconectar** e confirme. Se você tiver vários números, os demais continuam ativos.
3. O resultado aparece com uma cor:
   - **Verde** — desconectado completamente.
   - **Amarelo** — foi desconectado no Parallly, mas vale conferir também no Meta Business Suite se a integração ficou encerrada.
   - **Vermelho** — houve um erro de rede; tente novamente.

## Perguntas frequentes

**Posso continuar usando o WhatsApp Business no meu celular?**
Sim, com o modo **Coexistência**: a IA responde pelo Parallly e você mantém o app. Só lembre de abri-lo pelo menos a cada 14 dias.

**Perco minhas conversas anteriores ao conectar?**
Não, se você conectar por coexistência: são sincronizados até 6 meses de conversas de texto e seus contatos. Se migrar de outro provedor, o histórico desse provedor não é transferido.

**Preciso de modelos para o agente responder?**
Não. O agente responde livremente dentro da janela de 24 horas após a última mensagem do cliente. Os modelos só são necessários quando você inicia a conversa fora dessa janela.

**Por que meu modelo foi rejeitado?**
A Meta revisa o conteúdo. Na página de modelos você verá o **motivo da rejeição**; corrija o texto (evite linguagem promocional agressiva em modelos de utilidade) e envie de novo.

**Quem pode conectar ou desconectar o WhatsApp?**
Somente o **administrador** da conta. Supervisores e agentes não entram em **Canais**: ali não veem o status da conexão nem podem alterá-lo. O que um supervisor vê é se um canal atribuído ao agente ficou sem conexão, em **Saúde dos agentes**.

**Posso ter um agente diferente em cada número?**
Sim. A regra é um agente de IA por conexão: por exemplo, um agente de vendas em um número e um de suporte em outro. A atribuição é feita no editor do agente.

**A Parallly me cobra pelas mensagens do WhatsApp?**
Não. A partir de 1º de outubro de 2026 a Meta cobra da sua conta do WhatsApp Business cada mensagem de serviço entregue, com a forma de pagamento que você cadastrou na Meta. Sua assinatura da Parallly é um pagamento separado e não muda por causa disso.

**Dou meu cartão à Parallly para pagar o WhatsApp?**
Não, e ninguém da Parallly vai pedir isso por chat. A forma de pagamento do WhatsApp fica nas ferramentas da Meta, sobre a sua própria conta do WhatsApp Business.

**As 1.000 mensagens grátis são por conta ou por número?**
Por número e por mês civil, sem acumular. Não são por país, não são por contato e não cobrem modelos.

**Instagram e Messenger também são cobrados por mensagem?**
Hoje não. A cobrança por mensagem de serviço que começa em 1º de outubro de 2026 é do WhatsApp; Instagram, Messenger e Telegram não têm cobrança por mensagem de serviço do provedor deles.

Ficou alguma dúvida? Fale com a gente no [suporte](https://parallly-chat.cloud/support).
