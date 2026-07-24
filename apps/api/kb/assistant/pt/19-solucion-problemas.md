---
id: solucion-problemas
title: "Solução de problemas frequentes"
routes: ["/admin/channels", "/admin/agent", "/admin/inbox", "/admin/broadcast", "/admin/appointments", "/admin/settings/billing"]
roles: ["tenant_admin", "tenant_supervisor", "tenant_agent"]
keywords: ["problemas", "não funciona", "não chegam mensagens", "não responde", "o bot não responde", "canal desconectado", "token expirado", "reconectar", "campanha não envia", "modelo rejeitado", "limite do plano", "limite atingido", "agendamento não aparece", "calendário não sincroniza", "e-mail de verificação", "não chega o código", "erro", "ajuda", "suporte", "falar com o suporte"]
---

# Solução de problemas frequentes

Algo não está funcionando como você esperava? Este guia reúne os problemas mais comuns e como resolvê-los passo a passo. Se, no fim, nada disso resolver, mostramos no final como escrever para o suporte.

## Não chegam mensagens de um canal

Se seus clientes escrevem para você, mas as mensagens não aparecem na **Caixa de entrada**:

1. Acesse **Canais** na barra lateral e procure o cartão do canal afetado.
2. Verifique o status da conexão: se disser **Desconectado** ou você vir um aviso como "**Token expirado. Por favor, reconecte sua conta**", essa é a causa. Siga os passos da próxima seção para reconectar.
3. Se você tem **várias contas do mesmo canal** (por exemplo, dois números de WhatsApp), confirme que o cliente escreveu para o número ou a conta que está conectado: cada conexão é independente.
4. Faça um teste você mesmo: envie uma mensagem de outro telefone ou conta e verifique se ela aparece na **Caixa de entrada** em alguns segundos.
5. Se o canal aparecer como **Conectado** e mesmo assim as mensagens não chegarem, escreva para o suporte informando o canal, o horário aproximado e um exemplo da mensagem que não chegou.

> Apenas o papel de **administrador** pode conectar, reconectar ou desconectar canais. Supervisores e agentes veem o status, mas não podem alterá-lo.

## Canal desconectado ou token vencido: como reconectar

As autorizações de alguns canais podem vencer com o tempo ou ficar inválidas se você mudar a senha ou as permissões da conta (por exemplo, no Instagram ou no Facebook).

1. Vá em **Canais** e abra o cartão do canal.
2. Clique em **Reconectar** (ou **Conectar**, se aparecer como desconectado).
3. Refaça o login com o provedor (Meta, Google etc.) e aprove as permissões.
4. Pronto: a conexão volta a ficar ativa e **suas conversas e todo o histórico são preservados intactos**.

Detalhes úteis:

- O **Instagram** usa uma autorização que dura 60 dias. A Parallly a renova automaticamente, mas se a renovação falhar (senha ou permissões alteradas), você receberá um alerta e verá o aviso de token expirado no cartão: aí basta clicar em **Reconectar**.
- Reconectar **não apaga nada**: contatos, conversas e configuração do agente continuam iguais.

## O agente de IA não responde (ou responde mal)

Confira esta lista na ordem; quase sempre a causa é uma destas:

1. **A conexão tem um agente atribuído?** Acesse **Agente IA**. Se você vir um aviso do tipo "canais sem agente atribuído", essas conexões são atendidas pelo seu agente padrão com uma configuração genérica. Abra o agente correto e, em **Atribuição de conexões**, marque a conta exata que ele deve atender. Lembre-se: há **um agente de IA por conexão**.
2. **O agente está ativo?** Na lista de agentes, verifique se ele não está **pausado**.
3. **Está dentro do horário dele?** No editor do agente, confira o cartão **Horário**: fora desse intervalo, o agente não responde automaticamente.
4. **O modo de resposta está correto?** Em **Comportamento**, se o modo estiver em "sempre humano", a IA nunca responde sozinha. Mude para "sempre IA" ou "híbrido", conforme o que você precisa.
5. **A conversa está com um humano?** Se você ou alguém da equipe assumiu a conversa na **Caixa de entrada** (ou o cliente pediu para falar com uma pessoa), a IA fica pausada nessa conversa até que se clique em **Resolver**. É o comportamento esperado, não uma falha.
6. **As mensagens de IA do mês acabaram?** Acesse **Configurações → Faturamento** e veja a barra de uso de mensagens de IA. Cada plano inclui uma quantidade mensal (por exemplo, Emprendedor 1.000 e Starter 5.000); se acabar, atualize seu plano ou aguarde a virada do mês.

Se o agente **responde, mas responde mal** (inventa dados, não conhece seus preços ou foge do assunto):

- Alimente a **Base de Conhecimento**: o agente responde com aquilo que você ensina a ele. Adicione ou corrija artigos e perguntas frequentes com as informações oficiais do seu negócio.
- Ajuste as **regras** e os **temas proibidos** no cartão **Comportamento** do editor do agente.
- Teste as mudanças sem afetar clientes reais em **Agente IA → Testar agente**: é um simulador em que você conversa com o seu próprio agente.

## Não consigo enviar uma campanha

As causas mais comuns ao criar ou enviar uma campanha em **Campanhas**:

- **Seu plano não inclui campanhas ou você atingiu o limite do mês.** Emprendedor não inclui campanhas; Starter inclui 3 por mês; Pro, Enterprise e Custom têm campanhas ilimitadas. Se você atingiu o limite, verá o aviso de limite com a opção **Atualizar plano**.
- **O modelo do WhatsApp não está aprovado.** Para escrever a clientes que não falaram com você nas últimas 24 horas, o WhatsApp exige um modelo revisado e aprovado pela Meta. Confira o status em **Canais → WhatsApp → Ver todos os modelos**: ele deve constar como **Aprovado** (a revisão da Meta costuma levar de alguns minutos a 72 horas). Se tiver sido **Rejeitado**, você verá o motivo; corrija o texto e envie novamente.
- **Alguns destinatários não recebem.** É normal que alguns poucos falhem: contatos que cancelaram a inscrição (não recebem mais transmissões) ou números que já não existem. Você vê isso nas métricas da campanha.
- **Vários números conectados**: verifique se você escolheu o **número remetente** correto ao criar a campanha.

## Atingi o limite do meu plano

Quando um recurso chega ao seu limite (agentes, contatos, campanhas, mensagens de IA etc.), a plataforma avisa com uma mensagem do tipo "Você atingiu o limite do seu plano atual" e você não poderá criar mais desse recurso.

- Em **Configurações → Faturamento** você vê as barras de uso: aviso âmbar aos **80%** e alerta vermelho aos **95%** com o botão **Atualizar plano**.
- A mudança para um plano superior é aplicada **na hora**: você paga o novo plano e os limites são ampliados imediatamente.
- Os contadores mensais (mensagens de IA, campanhas, multimídia) **são reiniciados no primeiro dia de cada mês**.
- Você também pode liberar espaço (por exemplo, excluir um agente ou contatos que não usa) em vez de subir de plano.

## O agendamento não aparece no meu calendário

1. Primeiro confirme que o agendamento existe na Parallly: acesse a **Agenda** e procure-o na aba **Calendário**. Se não estiver ali, a reserva não chegou a se concretizar (o cliente pode não ter confirmado a última etapa).
2. Se o agendamento está na Parallly, mas não no seu Google Calendar ou Outlook, vá em **Agenda → Configurações → Calendários conectados** e verifique se o seu calendário continua **conectado**. Se a conexão venceu, clique em **Reconectar**.
3. Se você tem **vários calendários conectados**, o agendamento pode ter sido sincronizado em outro: cada agendamento vai primeiro para o calendário atribuído ao **serviço**; se não houver, para o do **profissional** atribuído; e, se também não houver, para o calendário **geral** do negócio. Confira essas atribuições na edição do serviço.
4. A sincronização é rápida, mas nem sempre instantânea: aguarde alguns minutos e atualize o seu calendário.

## Não recebo o e-mail de verificação

Ao se cadastrar (ou recuperar a sua senha), a Parallly envia um **código de 6 dígitos** por e-mail. Se ele não chegar:

1. Verifique a pasta de **spam ou lixo eletrônico** e procure por "Parallly" na sua caixa de entrada.
2. Aguarde 2 ou 3 minutos: alguns provedores de e-mail demoram para entregar.
3. Confirme que você digitou corretamente o seu endereço de e-mail e peça um **novo código** na mesma tela.
4. Se você usa um e-mail corporativo, é possível que um filtro da empresa o bloqueie; tente com outro endereço ou peça à sua equipe de TI que o libere.
5. Se nada funcionar, escreva para o suporte informando o e-mail com o qual você está tentando se cadastrar.

## Como falar com o suporte

Se você seguiu os passos e o problema continua:

- Escreva para nós em [parallly-chat.cloud/support](https://parallly-chat.cloud/support).
- Você também pode perguntar ao **copiloto** dentro do painel: muitas dúvidas são resolvidas na hora.

Para ajudar você mais rápido, inclua: o que você estava tentando fazer, em qual canal ou página aconteceu, o horário aproximado e, se possível, uma captura de tela do erro.

## Perguntas frequentes

**Reconectar um canal apaga minhas conversas ou contatos?**
Não. Reconectar apenas renova a autorização com o provedor; todo o seu histórico é preservado.

**Por que a IA parou de responder só em uma conversa?**
Porque essa conversa está atribuída a uma pessoa da sua equipe. Enquanto estiver assumida, a IA fica pausada; ela volta a responder quando se clica em **Resolver** na Caixa de entrada.

**Quem pode reconectar canais ou alterar a configuração do agente?**
Apenas o papel de **administrador**. Se você é supervisor ou agente e detecta o problema, avise o seu administrador.

**Quando os limites mensais do meu plano são reiniciados?**
No primeiro dia de cada mês. Os limites fixos (agentes, contatos, calendários) só mudam ao trocar de plano.

**Quanto tempo a Meta leva para aprovar um modelo do WhatsApp?**
Normalmente entre alguns minutos e 72 horas. O status (Pendente, Aprovado ou Rejeitado) aparece em **Canais → WhatsApp**.
