---
id: pipeline
title: "Funil de vendas (pipeline)"
routes: ["/admin/pipeline", "/admin/settings/pipeline"]
roles: ["tenant_admin", "tenant_supervisor", "tenant_agent"]
keywords: ["funil", "funil de vendas", "pipeline", "kanban", "etapas", "oportunidades", "negócios", "deals", "auto-avanço", "avanço automático", "mover cartão", "arrastar", "probabilidade", "cores das etapas", "aprovação de negócios", "aprovar", "rejeitar", "re-sincronizar", "etapa ganha", "etapa perdida"]
---

# Funil de vendas (pipeline)

O funil de vendas é o seu quadro kanban: cada oportunidade de venda é um cartão e cada coluna é uma etapa do seu processo (por exemplo: novo → qualificado → proposta → ganho). Você o encontra na barra lateral, em **Funil de vendas**.

Cada contato aparece com **um único cartão**, mesmo que ele fale com você por vários canais — assim o quadro não fica cheio de duplicados.

Na parte de cima do quadro você vê quatro indicadores: **Valor total** (a soma de todas as oportunidades abertas), **Ponderado** (valor × probabilidade da etapa em que cada uma está), **Oportunidades** (quantas existem) e **Média** (valor médio por oportunidade).

## Como criar uma oportunidade

1. Vá em **Funil de vendas** na barra lateral.
2. Clique em **Nova oportunidade**.
3. Preencha o formulário: **Contato**, **Título** (ex.: "Venda do produto X"), **Valor ($)**, **Etapa** inicial e **Notas** opcionais.
4. Salve. O cartão aparece na coluna da etapa escolhida.

Além disso, quando seus clientes conversam com o agente de IA, as oportunidades são criadas e avançam sozinhas (veja "Auto-avanço" mais abaixo).

## Como mover uma oportunidade de etapa

É só **arrastar o cartão** para a coluna desejada. Todos os perfis (administrador, supervisor e agente) podem mover cartões.

As **Condições da etapa** configuradas podem travar o movimento. Se a etapa de destino exige certos dados (e-mail, telefone, nome completo, pontuação mínima, consultor atribuído, agendamento marcado ou cotação ativa), você verá uma mensagem explicando exatamente o que falta.

Ao clicar em um cartão, você abre o detalhe do negócio: valor, **Probabilidade**, **Dias na etapa**, **Histórico de etapas**, responsável atribuído e atalhos para **Ver conversa** e **Ver contato**. De lá você também pode **Arquivar** a oportunidade (ela é marcada como perdida).

## Como personalizar as etapas (ordem, cor e probabilidade)

Somente administradores e supervisores. Há dois caminhos: o botão **Personalizar etapas** no quadro, ou **Configurações → Etapas do pipeline**.

1. **Arraste** as etapas para reordená-las.
2. Edite o **Nome**, a **Cor** (8 cores disponíveis) e a **Probabilidade** de fechamento de cada etapa. A probabilidade alimenta o indicador **Ponderado** do quadro.
3. Marque as etapas de fechamento como **Etapa final (fechada)** — por exemplo "Ganho" e "Perdido". As demais ficam como **Etapa ativa**.
4. Use **Adicionar etapa** para criar novas, ou exclua as que você não usa.
5. Se preferir partir de um modelo, use **Carregar predefinições do setor** para carregar as etapas típicas do seu ramo, ou **Restaurar padrões** para voltar ao início.
6. Salve as alterações (você verá o aviso "Você tem alterações não salvas" enquanto houver edições pendentes).

### Condições para entrar em uma etapa

Na mesma página, cada etapa tem sua seção **Condições de Transição**: regras que o contato precisa cumprir para entrar naquela etapa. Você pode exigir e-mail cadastrado, telefone, nome completo, uma pontuação mínima, consultor atribuído, agendamento marcado, cotação comercial ativa ou um atributo personalizado com determinado valor. Se você não configurar condições, a passagem é livre.

## Como ativar ou desativar o avanço automático

Com o **Auto-avanço** ligado, o agente de IA move as oportunidades pelo funil conforme os sinais da conversa: interesse demonstrado, perguntas sobre preço, intenção de compra, agendamento marcado etc. Ele já vem ativado de fábrica.

Para ligar ou desligar:

1. Vá em **Funil de vendas**.
2. No cabeçalho do quadro, use o interruptor **Auto-avanço**.

Se você desligar, você e sua equipe gerenciam as etapas manualmente e a IA não move nada. Pode religar quando quiser.

Ao lado do interruptor está o botão **Re-sincronizar**: ele realinha as oportunidades existentes com a etapa correta segundo suas conversas. Ao terminar, você verá quantas foram atualizadas (ex.: "12 oportunidades re-sincronizadas"). É útil depois de mudar suas etapas ou de ficar um tempo com o auto-avanço desligado. A mesma opção existe em **Configurações → Etapas do pipeline**, na seção **Avanço automático de etapas**.

> O avanço automático também respeita suas **Condições de Transição**: se o contato não cumpre os requisitos de uma etapa, a IA não o move para lá.

## Estado da aprovação de negócios

A interface contém elementos de aprovação, mas **o fluxo de solicitação, revisão e bloqueio de etapas finais não está certificado de ponta a ponta na versão atual**. Não o use como controle financeiro ou de auditoria: uma movimentação direta pode alterar a etapa sem concluir essa revisão. Até que o painel marque o fluxo como disponível, restrinja operacionalmente os fechamentos a administradores/supervisores e revise o histórico de cada oportunidade.

## Perguntas frequentes

**Por que não consigo mover um cartão para determinada etapa?**
A etapa tem **Condições de Transição** que o contato ainda não cumpre; a mensagem indica o que falta. Não dependa dos elementos de aprovação como bloqueio aplicado nesta versão.

**O auto-avanço desfaz o que eu movo manualmente?**
A IA só avança oportunidades com base em sinais novos da conversa. Se você prefere controle total sobre as etapas, desligue o interruptor **Auto-avanço** no quadro.

**Quem pode editar as etapas do funil?**
Somente administradores e supervisores. Os agentes podem ver o quadro e mover cartões.

**Por que vejo um único cartão se o cliente me escreveu pelo WhatsApp e pelo Instagram?**
O funil mostra um cartão por contato, unificando as conversas de todos os canais.

**Posso recuperar uma oportunidade arquivada?**
Ao arquivar, a oportunidade é marcada como perdida e sai do quadro. O histórico dela continua disponível na ficha do contato.

**Precisa de mais ajuda?** Escreva para a gente em https://parallly-chat.cloud/support
