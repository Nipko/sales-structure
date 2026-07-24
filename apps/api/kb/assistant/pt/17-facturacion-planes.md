---
id: facturacion-planes
title: "Planos, faturamento e dados fiscais"
routes: ["/admin/settings/billing", "/admin/settings/fiscal"]
roles: ["tenant_admin"]
keywords: ["planos", "preços", "faturamento", "pagamento", "mercadopago", "cartão", "mudar de plano", "fazer upgrade", "teste grátis", "anual", "mensal", "fatura", "histórico de pagamentos", "dados fiscais", "nit", "cédula", "dian", "limite do plano", "créditos sms", "cupom"]
---

# Planos, faturamento e dados fiscais

Tudo relacionado à sua assinatura fica em uma única página: no menu lateral, seção **Gestão**, entre em **Faturamento**. Ali você vê seu plano atual, muda de plano, gerencia seu cartão, consulta o histórico de pagamentos e compra créditos SMS. Somente o perfil de administrador pode ver e alterar o faturamento.

## Os 5 planos

| Plano | Preço mensal | Agentes de IA | Mensagens de IA/mês | Usuários | Contatos | Calendários | Canais |
|------|----------------|------------|-----------------|----------|-----------|-------------|---------|
| **Emprendedor** | USD $21 | 1 | 1.000 | 1 | 100 | 1 | Somente WhatsApp |
| **Starter** | USD $49 | 1 | 5.000 | 3 | 500 | 1 | WhatsApp, Instagram, Messenger, Email e chat web |
| **Pro** | USD $129 | 3 | 25.000 | 5 | 5.000 | 3 | Todos |
| **Enterprise** | USD $349 | 10 | 100.000 | Ilimitados | 50.000 | 10 | Todos |
| **Custom** | Sob consulta | Ilimitados | Ilimitados | Ilimitados | Ilimitados | Ilimitados | Todos |

Alguns detalhes úteis:

- **Emprendedor** é o plano de entrada: somente WhatsApp, sem automações nem campanhas. Ideal para começar e depois evoluir.
- **Starter** desbloqueia mais canais, 5 regras de automação e 3 campanhas por mês.
- **Pro** adiciona Telegram, automações e campanhas ilimitadas, e até **2 números de WhatsApp** conectados ao mesmo tempo (cada conexão com seu próprio agente de IA).
- **Enterprise** permite até 3 números de WhatsApp, 2 contas de Instagram e suporte prioritário.
- **Custom** é sob medida: preço e limites são acordados com a equipe da Parallly.
- Lembre-se: há **um agente de IA por conexão**. Se você tem 2 números de WhatsApp, cada número tem seu agente; quantas conexões do mesmo tipo você pode ter depende do seu plano.
- Os preços são exibidos na sua **moeda local** quando disponível (por exemplo, pesos colombianos); caso contrário, você verá o equivalente em USD.
- O SMS não é um canal de conversa: são **notificações de saída que funcionam com créditos** (1 crédito = 1 segmento de SMS). Veja mais abaixo.

## Teste grátis

- **Emprendedor e Starter**: 7 dias de teste, **sem cartão**.
- **Pro e Enterprise**: 15 dias de teste, **com cartão** (não há cobrança até o teste terminar).
- Sua conta começa com o teste do plano Emprendedor no momento do cadastro.
- 3 dias antes de o teste terminar, você recebe um e-mail de lembrete. Se o teste expirar sem cartão, a conta fica como **Vencida**: você perde o acesso, mas **seus dados são preservados** e tudo volta ao pagar.

## Ciclo mensal ou anual

Cada plano pago pode ser cobrado em ciclo **Mensal** ou **Anual**. O anual aplica um **desconto de ~15%** sobre o total do ano.

1. Entre em **Gestão → Faturamento**.
2. Use o seletor **Mensal / Anual**: ao escolher Anual, os cartões de plano mostram o preço anual e a economia.
3. Para mudar o ciclo de uma assinatura ativa, use **Mudar para anual** (ou **Mudar para mensal**). A mudança de ciclo é **imediata**: a assinatura atual é encerrada e uma nova é criada com o ciclo escolhido.

## Como fazer upgrade ou downgrade de plano

1. Entre em **Gestão → Faturamento** e desça até **Planos disponíveis**.
2. No cartão do plano desejado, clique em **Fazer upgrade para…** (subir) ou **Fazer downgrade para…** (baixar).
3. Se você **faz upgrade**: é solicitado o cartão e a cobrança do novo plano é imediata. Os novos limites passam a valer na hora.
4. Se você **faz downgrade**: a mudança fica **agendada para o final do seu período atual**, sem cobrança adicional. Você mantém todas as suas funções até essa data e pode voltar atrás com o botão **Manter meu plano**.

## Forma de pagamento (MercadoPago)

As cobranças são processadas com **MercadoPago**. Seu cartão é guardado de forma segura (a Parallly nunca vê o número completo).

Para trocar de cartão:

1. Em **Gestão → Faturamento**, clique em **Trocar cartão**.
2. Informe os dados do novo cartão na janela segura do MercadoPago.
3. Clique em **Salvar novo cartão**. A próxima cobrança usará o cartão novo.

### Se uma cobrança falhar

Quando um pagamento é recusado, sua assinatura fica com o status **Pagamento pendente** e você recebe um e-mail com instruções. Você tem dois caminhos:

- **Trocar o cartão** e aguardar a nova tentativa automática.
- Clicar em **Tentar cobrança agora** para forçar a verificação na hora.

Se após **7 dias** o pagamento não for recuperado, a conta é suspensa temporariamente. Seus dados são preservados por 90 dias e tudo é reativado ao pagar.

## Histórico de pagamentos e faturas

Na mesma página de **Faturamento**, a seção **Histórico de faturas** mostra seus últimos pagamentos com **Data**, **Valor** (na moeda da cobrança) e **Status** (Bem-sucedido, Falhou, Reembolsado ou Pendente). Quando há fatura disponível, aparece o botão **Baixar**.

## Pausar ou cancelar

- **Pausar assinatura**: para dar uma pausa sem cancelar. Você não é cobrado enquanto está pausada e volta com **Retomar** (a próxima cobrança mantém sua data original). Os limites do plano continuam valendo durante a pausa.
- **Cancelar no fim do período**: você mantém o acesso até a data de término do seu ciclo atual.
- **Cancelar agora**: o acesso termina imediatamente, sem reembolso do período em andamento.

## Cupons promocionais

Se você recebeu um código promocional, em **Faturamento** procure a seção **Código de cupom**, cole o código e clique em **Aplicar**. Há cupons de porcentagem de desconto, de valor fixo e de meses grátis (estendem seu teste). Se o cupom não for aceito, a mensagem dirá o motivo (vencido, já usado, não se aplica ao seu plano, etc.).

## Créditos SMS (notificações aos seus clientes)

O envio de SMS funciona com **créditos pré-pagos**: 1 crédito = 1 segmento de SMS. Em **Faturamento**, a seção **Créditos SMS** mostra seu saldo disponível e o consumido no mês.

1. Escolha um pacote de créditos e clique em **Comprar**.
2. Pague com MercadoPago como **pagamento único** (não é uma assinatura).
3. Os créditos são creditados automaticamente em alguns segundos.

Os pacotes e preços são definidos pela plataforma e podem variar por país. Se a função de SMS estiver desativada no nível da plataforma, a seção não permite comprar nem enviar.

## Dados fiscais para a Colômbia (NIT ou cédula) e faturas DIAN

Se o seu negócio está na Colômbia, a Parallly emite **fatura eletrônica DIAN** das suas cobranças. Para que a fatura saia em nome do seu negócio, complete seu perfil fiscal:

1. No menu lateral, entre em **Configurações**.
2. Na seção **Empresa**, abra **Faturação eletrônica**.
3. Complete: tipo de organização (pessoa jurídica ou física), **tipo e número do documento** (NIT ou cédula; o dígito verificador do NIT é calculado sozinho), responsabilidade de IVA, razão social ou nomes, município, endereço, e-mail e telefone.
4. Salve as alterações.

Nessa mesma página você vê o **histórico de faturas emitidas** (número, status, valor, PDF/XML) e pode tentar reemitir uma fatura que tenha ficado pendente.

> **Importante:** se você não completar seus dados fiscais, suas faturas são emitidas em nome de "Consumidor Final" e **não servem para dedução de impostos**. A página de Faturamento lembra você disso com os acessos **Ver dados fiscais** / **Completar dados fiscais**.

## O que acontece ao atingir um limite

A página de **Faturamento** mostra barras de uso do seu plano: mensagens de IA do mês, processamento de mídia (áudios e imagens) e base de conhecimento.

- Aos **80%** de uso, você vê um aviso âmbar; aos **95%**, um alerta vermelho com o botão **Fazer upgrade de plano**.
- Se você atingir o limite de um recurso (contatos, agentes, campanhas, etc.), a plataforma avisa com uma mensagem do tipo "Você atingiu o limite do seu plano atual" e não poderá criar mais desse recurso até fazer upgrade de plano ou liberar espaço.
- Se o limite de **mídia** se esgotar, seu agente continua respondendo, mas os áudios e imagens são registrados de forma genérica, sem transcrição nem análise.
- Os contadores mensais são reiniciados no primeiro dia de cada mês.

## Perguntas frequentes

**Posso mudar de plano quando quiser?**
Sim. Os upgrades valem na hora (com cobrança imediata); os downgrades ficam agendados para o final do seu período, sem cobrança extra.

**O que acontece com meus dados se eu deixar de pagar ou cancelar?**
Eles são preservados. A conta fica bloqueada, mas ao reativar o pagamento você recupera tudo exatamente como estava.

**Posso pagar na minha moeda local?**
O preço é exibido na sua moeda quando há tarifa local (Colômbia, por exemplo). A cobrança é processada pelo MercadoPago com o cartão que você registrar.

**O teste grátis pede cartão?**
Emprendedor e Starter não. Pro e Enterprise sim, mas nada é cobrado até o teste terminar.

**Como obtenho minha fatura?**
Em **Faturamento → Histórico de faturas**, botão **Baixar**. Se você está na Colômbia e completou seus dados fiscais, também recebe a fatura eletrônica DIAN (PDF/XML) em **Configurações → Faturação eletrônica**.

Dúvidas com uma cobrança? Escreva para nós em https://parallly-chat.cloud/support — a equipe da Parallly ajuda você com prazer.
