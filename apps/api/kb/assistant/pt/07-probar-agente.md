---
id: probar-agente
title: "Testar seu agente antes de publicar"
routes: ["/admin/agent", "/admin/agent/simulation", "/admin/procedures"]
roles: ["tenant_admin"]
keywords: ["testar agente", "simulacao", "simular conversa", "chat de teste", "cenarios", "sinteticos", "historicos", "linha de base", "regressao", "pontuacao", "qualidade do agente", "avaliar agente", "procedimentos", "sop", "procedimento operacional", "compilar passos", "palavras de ativacao", "fluxo passo a passo", "testar bot", "antes de publicar"]
---

# Testar seu agente antes de publicar

Antes de deixar seu agente de IA conversar com clientes de verdade, vale a pena conferir como ele responde. A Parallly te dá três ferramentas para isso:

- **Chat de teste** — converse você mesmo com o agente, como se fosse um cliente.
- **Simulações** — dezenas de "clientes simulados" conversam com seu agente e uma IA avaliadora dá nota para cada conversa.
- **Procedimentos (SOP)** — escreva seus processos em linguagem natural para o agente segui-los passo a passo, sem improvisar.

> Essas ferramentas estão disponíveis para o papel de **administrador**. **Agente IA** e **Procedimentos** ficam em **IA e crescimento**.

## Como conversar com seu agente (chat de teste)

É o jeito mais rápido de ver seu agente em ação:

1. Na barra lateral, vá em **IA e crescimento** → **Agente IA**.
2. Abra o agente que você quer revisar.
3. Clique no botão **Testar agente**.
4. Escreva como se fosse um cliente ("Quais são os preços?", "Vocês têm horário no sábado?") e clique em **Enviar**.
5. Com **Reiniciar** você apaga a conversa e começa do zero.

O chat de teste é um espaço seguro: não cria contatos, não aparece na sua caixa de entrada e não mexe em nenhuma conversa real. Use-o sempre que mudar a personalidade, as regras ou as informações do negócio, para confirmar que o agente responde do jeito que você espera.

## Como executar uma simulação

Quando você quer uma avaliação mais completa do que algumas mensagens manuais, use as simulações. Pense nelas como um "controle de qualidade" automático do seu agente.

1. Abra **Agente IA**, escolha o agente e selecione **Testar agente**.
2. No painel **Nova simulação**, escolha o **Agente** que quer avaliar.
3. Em **Origem dos cenários**, escolha como os clientes de teste são gerados:
   - **Sintéticos** — a IA gera clientes variados e realistas do seu setor: fáceis, desconfiados, irritados, caçadores de preço etc.
   - **Históricos** — reproduz conversas reais que seus clientes já tiveram, para ver como o agente as trataria com a configuração atual.
4. Defina o **Número de cenários** a rodar (50 por padrão; você pode ajustar).
5. (Opcional) Em **Comparar com (linha de base)**, escolha uma simulação anterior: os mesmos cenários são reutilizados para detectar se algo piorou depois das suas mudanças.
6. Clique em **Executar simulação**.

A simulação roda em segundo plano: você pode continuar trabalhando e voltar depois. No painel **Histórico** você vê cada execução com seu status — **Na fila**, **Executando**, **Concluída** ou **Falhou** — e o andamento dos cenários avaliados.

> **É 100% seguro:** a simulação nunca cria agendamentos, pedidos nem descontos reais. As ações do agente ficam desativadas durante o teste; nada chega aos seus clientes.

## Como ler os resultados

Ao abrir uma simulação concluída você verá:

- **Pontuação média** (0 a 10) — a qualidade geral das respostas do agente.
- **Taxa de resolução** — a porcentagem de conversas que o agente conseguiu resolver.
- **Sub-pontuações por dimensão** — **Resolução**, **Tom**, **Precisão** e **Empatia**, para saber exatamente onde ele está forte e onde deixa a desejar.
- **Regressões** — se você escolheu uma linha de base, verá **Regressão detectada** quando alguma resposta piorou em relação à execução anterior, ou **Sem regressões** se tudo se manteve ou melhorou.
- **Tabela de cenários** — clique em qualquer cenário para ver a **transcrição** completa (cliente vs. agente) e os **problemas** que o avaliador encontrou naquela conversa.

**Recomendação:** rode uma simulação sempre que mudar a personalidade, as regras, a base de conhecimento ou os procedimentos do seu agente, e compare com a linha de base anterior. Assim você publica mudanças com evidência, não no achismo.

## Como criar um procedimento (SOP)

Os procedimentos ensinam seu agente a executar processos do seu negócio **passo a passo**: reembolsos, garantias, reclamações, qualificação de leads… O agente decide como redigir cada mensagem com naturalidade, mas o fluxo é controlado pelo procedimento — por isso ele nunca pula nem inventa passos.

1. Na barra lateral, vá em **IA e crescimento** → **Procedimentos**.
2. Escolha como criá-lo:
   - **Escrever SOP** (recomendado) — descreva o procedimento em linguagem natural, por exemplo: *"Quando um cliente pedir reembolso, peça o número do pedido e verifique o status; se entregue, ofereça um cupom, senão escale para um agente."* Depois clique em **Compilar em passos**: a IA transforma tudo em uma sequência de passos concretos que fica como **Rascunho** para você revisar.
   - **Em branco** — monte os passos manualmente, um por um, com **Adicionar passo**.
3. Revise e ajuste os passos. Cada passo é de um destes tipos:

| Tipo | O que faz |
|------|-----------|
| **Mensagem** | Comunica algo ao cliente |
| **Perguntar** | Pede um dado ao cliente e o guarda (ex.: número do pedido) |
| **Ferramenta** | Executa uma ação (consultar um pedido, buscar um produto…) |
| **Condição** | Avalia um dado e ramifica o fluxo conforme o resultado |
| **Escalar** | Transfere a conversa para uma pessoa da sua equipe |

4. Clique em **Salvar**.

### Ativar o procedimento

- Defina as **Palavras que ativam** (ex.: "reembolso, devolução, garantia"). Quando um cliente menciona alguma delas, o procedimento começa automaticamente.
- Use **Ativar** para colocá-lo no ar ou **Desativar** para pausá-lo sem apagar.
- Cada mudança aumenta a **versão** do procedimento, então você sempre sabe qual versão está em uso.

**Dica:** depois de ativar ou modificar um procedimento, teste-o no chat de teste mencionando uma das palavras de ativação e, em seguida, rode uma simulação para verificar que o restante das conversas não foi afetado.

## Perguntas frequentes

**A simulação pode enviar mensagens para os meus clientes reais?**
Não. Tudo acontece em um ambiente isolado: não são criados agendamentos, pedidos, descontos nem conversas reais, e nenhuma mensagem sai pelos seus canais conectados.

**Qual é a diferença entre o chat de teste e a simulação?**
No chat de teste é você conversando com o agente: ideal para revisões rápidas e pontuais. A simulação roda dezenas de conversas variadas com avaliação automática: ideal antes de publicar mudanças importantes.

**O que é a "linha de base" e para que serve?**
É uma simulação anterior que você usa como ponto de comparação. Ao reutilizar os mesmos cenários, a Parallly consegue dizer se uma mudança que você fez **piorou** alguma resposta que antes saía bem (uma "regressão").

**O que faço se aparecer "Regressão detectada"?**
Abra os cenários marcados, leia a transcrição e os problemas encontrados, ajuste a configuração do agente (personalidade, regras, conhecimento ou procedimentos) e rode a simulação de novo comparando com a mesma linha de base.

**Uma boa pontuação garante que o agente é perfeito?**
Não, mas reduz muito o risco. Como referência: 8 ou mais é um bom resultado; entre 5 e 8, vale revisar os cenários com pontuação mais baixa; abaixo de 5, revise a configuração antes de publicar.

**Quem pode usar essas ferramentas?**
Somente o papel de **administrador**. Se você não vê essas opções no menu e precisa delas, peça acesso ao administrador da sua conta. Dúvidas? Escreva para a gente em https://parallly-chat.cloud/support
