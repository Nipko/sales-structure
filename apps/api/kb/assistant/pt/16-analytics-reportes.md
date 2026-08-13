---
id: analytics-reportes
title: "Analytics e relatórios"
routes: ["/admin", "/admin/analytics-v2", "/admin/crm-analytics", "/admin/agent-analytics", "/admin/report-builder", "/admin/settings/alerts"]
roles: ["tenant_admin", "tenant_supervisor"]
keywords: ["analytics", "análises", "métricas", "relatórios", "estatísticas", "kpi", "dashboard", "painel", "csat", "satisfação", "pesquisa", "funil", "velocidade", "ganhos perdidos", "relatório personalizado", "relatório programado", "exportar csv", "desempenho de agentes", "taxa de resolução"]
---

# Analytics e relatórios

O Parallly mede conversas e vendas para que você tome decisões com base em dados. Em **Insights** você encontra **Analytics**, **Analíticos CRM**, **Desempenho de agentes**, **Atribuição** e **Relatórios personalizados**.

As análises são para administradores e supervisores. Usuários com papel de agente não têm acesso a essas telas; devem pedir as informações necessárias a um supervisor ou administrador.

## O painel principal (Dashboard)

Ao fazer login, você chega ao **Dashboard**: sua visão geral do dia. Ele se adapta ao seu setor — um consultório vê "Agendamentos hoje" e "Pacientes novos"; um restaurante vê "Pedidos hoje" e "Receita do dia"; um negócio geral vê "Conversas hoje", "Leads novos" e "Taxa de resposta". Se a sua conta for nova, você também verá um checklist com os passos pendentes para ativá-la (conectar um canal, personalizar seu agente etc.).

## Como ver as métricas gerais do negócio

1. Na barra lateral, abra **Insights → Analytics**.
2. Escolha um dos períodos disponíveis ou defina um intervalo personalizado.
3. Navegue pelas abas: **Visão Geral** (conversas, mensagens, resolução IA, tempo de resposta, CSAT médio), **IA & Bot**, **Resolução IA**, **Qualidade (QA)**, **CRM & Vendas**, **Agentes**, **Automação**, **Campanhas**, **Canais**, **CSAT**, **Anomalias** e **Coortes**.
4. Use **Exportar CSV** para baixar os dados e trabalhá-los na sua planilha.

### A taxa de resolução IA

Na aba **Resolução IA** você vê qual porcentagem das conversas o seu agente de IA resolveu sozinho, sem que um humano precisasse intervir, com a tendência ao longo do tempo e a divisão por canal. Esse é um sinal operacional, não uma nota de qualidade: uma taxa alta pode coexistir com respostas incorretas, enquanto uma taxa baixa pode refletir transferências seguras. Se ela mudar muito por canal, revise as perguntas, o agente atribuído e as lacunas de conhecimento.

## Como avaliar o desempenho dos seus agentes e canais

1. Vá em **Insights → Desempenho de agentes**.
2. No topo você vê quatro indicadores do período: **Conversas**, **Tempo médio de resposta**, **Taxa de resolução** e **CSAT médio**.
3. Percorra as abas:
   - **Resumo** — volume diário de conversas.
   - **Agentes** — tabela comparativa por agente (conversas, resolvidas, tempo de resposta e CSAT), com selo de **IA** ou **Humano**.
   - **Canais** — quantas conversas chegam por cada canal e qual porcentagem do total representam.
   - **CSAT** — a satisfação dos seus clientes (veja mais abaixo).

## Como funciona a medição de satisfação (CSAT)

A aba **CSAT** de **Desempenho de agentes** mostra as avaliações que já estejam registradas na conta:

- **CSAT médio** do período, com o total de respostas.
- **Distribuição por estrelas** — quantos clientes deram nota 5, quantos deram 4 etc.
- **Comentários recentes** — o que os seus clientes escreveram, exatamente como escreveram.

Na versão atual, encerrar uma conversa não envia nem captura automaticamente uma pesquisa pelo canal e também não cria um alerta no sino. Se precisar coletar CSAT, use um processo ou integração habilitada para sua conta e confirme que as respostas aparecem antes de usar essa visão para tomar decisões.

## Como analisar seu funil de vendas (Analíticos CRM)

1. Vá em **Insights → Analíticos CRM**.
2. No topo você vê os indicadores-chave: **Total leads**, **Oportunidades ativas**, **Valor do pipeline**, **Score médio** e **Taxa de conversão**.
3. Explore as abas:
   - **Visão geral** — leads por etapa, fontes de leads e o bloco **Ganhos vs Perdidos**: quantos negócios você ganhou, quantos perdeu, sua **Taxa de sucesso**, o valor total ganho e os **Motivos de perda** mais frequentes.
   - **Funil** — como seus contatos avançam etapa por etapa e onde eles caem.
   - **Velocidade** — quantos dias, em média, uma oportunidade passa em cada etapa. Se uma etapa acumula muitos dias, ali está o seu gargalo.
   - **Agentes** — ranking da equipe por negócios fechados e valor vendido.

A visão **Atribuição** (em **Insights**) complementa isso medindo o caminho completo dos seus anúncios: cliques → conversas → leads → vendas, com o retorno de cada campanha publicitária.

## Como criar um relatório personalizado

Se você precisa de um relatório com exatamente as métricas que lhe interessam:

1. Vá em **Insights → Relatórios personalizados**.
2. Clique em **Novo relatório**.
3. Escreva o **Nome do relatório** (ex.: "Desempenho semanal") e uma **Descrição** opcional.
4. Escolha o **Tipo de gráfico**: **Barras**, **Linhas**, **Área** ou **Pizza**.
5. Em **Selecionar métricas**, marque as que quiser combinar. Elas estão agrupadas em **Conversas** (conversas, mensagens, transferências), **Inteligência artificial** (resolução IA, contenção), **Desempenho** (tempos de resposta e resolução), **CRM** (leads, taxa de conversão, valor do pipeline) e **Operações** (agendamentos, faltas, campanhas, CSAT).
6. Ajuste o **Intervalo de datas** e confira a **Prévia**.
7. Clique em **Salvar**.

Seus relatórios salvos ficam na mesma página, prontos para consulta quando você quiser. Cada um tem opções para **Editar**, **Duplicar** (útil para criar variações) e **Excluir**.

## Como receber relatórios automáticos por email

Você pode receber um resumo dos seus indicadores no seu email, sem entrar no painel:

1. Vá em **Configurações → Governança e alertas → Alertas do Sistema**.
2. Desça até **Relatórios Programados**.
3. Escolha uma das frequências e horários de envio disponíveis para a sua conta.
4. Em **Destinatários**, escreva os emails separados por vírgula.
5. Marque a caixa como **Habilitado** e clique em **Salvar alterações**.

Abaixo você verá a data do último envio. Se a opção não aparecer, confira sua disponibilidade em **Plano e faturamento**.

Nessa mesma página você pode criar **alertas do sistema**: notificações por email quando uma métrica ultrapassar um limite que você definir (conversas ativas, mensagens do dia, escalações, entre outras). A plataforma os avalia automaticamente.

## Perguntas frequentes

**Quem pode ver as análises?**
Administradores e supervisores podem acessar essas telas. Agentes não têm acesso direto às páginas de análise.

**Por que uma aba diz "sem dados"?**
O período escolhido não tem atividade. Amplie o intervalo de datas (por exemplo, de 7 para 30 dias) ou verifique se os seus canais estão conectados e recebendo conversas.

**Posso baixar os dados?**
Sim: use **Exportar CSV** na Visão geral de Analytics, ou configure os **Relatórios Programados** para recebê-los por email.

**Os relatórios programados estão disponíveis para minha conta?**
A tela e **Plano e faturamento** mostram a disponibilidade atual. As visões consultáveis permanecem visíveis conforme seu perfil e configuração.

**Como melhoro meu CSAT?**
Leia os **Comentários recentes** da aba CSAT: ali os seus clientes dizem o que ajustar. Costuma ajudar afinar o tom do agente de IA, completar sua base de conhecimento e responder rápido às conversas escaladas.

Precisa de mais ajuda? Escreva para nós em https://parallly-chat.cloud/support
