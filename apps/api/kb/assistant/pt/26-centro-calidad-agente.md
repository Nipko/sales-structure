---
id: centro-calidad-agente
title: "Saúde dos agentes e Centro de qualidade"
routes: ["/admin/agent/quality", "/admin"]
roles: ["tenant_admin", "tenant_supervisor"]
keywords: ["saude dos agentes", "centro de qualidade", "qualidade do agente", "preparacao", "qualidade testada", "evidencia de producao", "agente em risco", "configuracao incompleta", "acoes criticas", "badge", "adiar", "Parallly Assist", "melhorar agente", "cobertura dos canais", "conexao operacional do canal", "mostrar onde", "roteiro guiado", "barra de contexto", "exige reautorizar"]
---

# Saúde dos agentes e Centro de qualidade

A **Saúde dos agentes** mostra o que ainda falta configurar, o que já foi testado e o
que acontece em conversas reais para cada agente de IA. O detalhe fica em **Insights
→ Saúde dos agentes**. Admin e Supervisor podem consultá-lo; somente Admin pode editar
agentes, conexões ou configurações em **IA e crescimento → Agente de IA**.

## Onde aparece e o que significa

- O cartão **Saúde dos seus agentes** no Início sempre resume o pior estado e as
  ações abertas para Admin/Supervisor.
- O badge de **Insights → Saúde dos agentes** conta somente sinais **Críticos e Altos
  abertos**. É um contador de atenção, não uma pontuação.
- O aviso global aparece apenas para um sinal Crítico aberto ou o estado **Agente em
  risco**. Você pode **Revisar**, **Perguntar ao Assist** ou **Adiar por 24 h**.
- Adiar oculta esse sinal temporariamente; não o corrige. Esses avisos ficam no
  dashboard e não enviam e-mail nem notificação push.

## As três camadas de evidência

- **Preparação:** verifica negócio e escopo, conhecimento, conversa e marca, ações,
  segurança e transferência, e robustez operacional. Uma capacidade fora do escopo
  pode aparecer como **Não se aplica** e não reduz o resultado.
- **Qualidade testada:** mostra a avaliação crítica e a simulação mais recentes, com
  versão, data, limite e cenários. Evidências anteriores podem ficar desatualizadas
  quando o agente muda. É evidência automatizada, não uma certificação.
- **Produção:** usa interações reais atribuídas ao agente e à sua versão. Mantém
  separados resolução verificada, qualidade conversacional observada, transferências,
  falhas de ferramentas e lacunas de conhecimento. Quando a amostra ainda é pequena,
  aparece **Evidência insuficiente**, não zero.

Evidências históricas que não identificam o agente de forma inequívoca não são
atribuídas retroativamente. Por isso, uma versão recém-publicada pode precisar de
novas interações antes de exibir um sinal de produção útil.

## O que a "Conexão operacional do canal" verifica

Esse controle de **Preparação** separa três coisas que costumam se confundir:

- **Atribuição** — no editor do agente você marcou os canais que este agente atende.
- **Conexão** — essa conta existe e está ativa em **Administração → Canais**.
- **Credencial** — a permissão continua válida, então o canal ainda consegue enviar
  respostas.

Um canal marcado no agente mas sem conexão **já não bloqueia** o agente quando outro
canal atribuído está operando: ele aparece como **Cobertura dos canais atribuídos**, uma
ação Alta e não crítica, com quantas atribuições o agente tem, quantas estão conectadas e
quais ficaram sem conexão.

**Conexão operacional do canal** bloqueia como crítica apenas em dois casos:

- nenhum canal atribuído consegue **receber** mensagens (não há conexão ativa), ou
- uma credencial **exige reautorizar** (vencida, revogada, com erro ou ausente), então o
  agente não consegue **enviar** a resposta.

Há um terceiro controle crítico, à parte, para atribuições que não correspondem a um canal
conversacional certificado: **Alcance operacional do canal** rejeita o agente atribuído a
um tipo de canal que não atende conversas (por exemplo, SMS, que só envia notificações, ou
e-mail, que hoje não tem configuração de autosserviço certificada). Não basta desconectar:
é preciso desmarcar esse tipo no editor do agente e deixar só canais certificados —
WhatsApp, Instagram, Messenger, Telegram ou o chat web.

Um vínculo que aponta para uma conta que já não existe (por exemplo, o número foi
reconectado e mudou de identificador) conta como atribuição sem conexão: basta marcar de
novo a conta vigente no editor do agente.

## O que acontece ao clicar em Revisar

**Revisar** abre a tela onde a mudança é feita e, no topo dessa tela, aparece uma **barra
de contexto** que explica por que você chegou ali. Ela mostra a ação pendente, o agente
afetado, uma explicação em linguagem simples com a evidência do controle (por exemplo,
"atribuído a 2 canais, 1 conectado, sem conexão: instagram") e até quatro botões: **Mostrar
onde**, **Perguntar ao Assist**, **Adiar por 24 h** e fechar. **Mostrar onde** aparece só
quando existe um roteiro que cobre aquele sinal e o seu papel pode executá-lo; caso
contrário, a barra mostra os outros três. Faz parte da tela, não é uma
notificação: nada é enviado para lugar nenhum e ela some ao fechá-la ou ao voltar a essa
tela sem esse link.

**Revisar** já não deixa você na porta: o link carrega a aba e o campo, então o editor abre
aquela aba, rola até o campo e o destaca. Se o sinal for a mensagem de apoio, você chega
com esse campo marcado; o mesmo vale para as regras ou os canais atribuídos. Você não
precisa vasculhar um formulário longo atrás do que faltava.

## Mostrar onde (roteiro guiado)

**Mostrar onde** abre a tela certa e destaca, passo a passo, onde a mudança é feita: qual
campo, qual aba, qual botão. O roteiro **não modifica** nenhuma configuração; ele só
aponta o lugar, e a pessoa decide o que escrever e quando salvar. Funciona no computador,
onde ficam esses elementos do painel. Admin vê os roteiros de edição (conectar um canal,
atribuir canais ao agente, regras de transferência); Supervisor vê os de revisão (Centro
de qualidade, evidência de produção). Dois roteiros alcançam também o papel **agente**: o
do sistema de ajuda (onde fica a ajuda de cada tela) e o da primeira conversa da caixa de
entrada. Você também pode pedi-lo no chat: quando pergunta ao
Assist onde ou como fazer algo que tem roteiro, a resposta traz esse botão.

## Como interpretar o estado

- **Ainda não avaliado:** ainda não há evidência suficiente.
- **Configuração incompleta:** falta um requisito ou existe um alerta de preparação.
- **Agente em risco:** um teste crítico ou sinal real importante exige revisão.
- **Pronto para piloto controlado:** preparação e testes permitem uso limitado, mas
  ainda falta evidência real suficiente.
- **Operando com evidências:** há configuração, testes atuais e uma amostra útil de
  produção.
- **Revisão necessária:** a evidência ficou desatualizada ou o desempenho recente piorou.

Nenhum estado significa que o agente é perfeito, certifica sua operação ou garante
resultados comerciais.

## O que melhorar primeiro

O Parallly mantém snapshots do estado e sinais por agente, versão e causa. Mudanças no
agente, resultados de QA, avaliações e simulações atualizam a evidência. Recorrências
são agrupadas para evitar alertas duplicados, e uma passagem periódica limitada
recupera eventos perdidos. Um sinal pode estar aberto, reconhecido, adiado, resolvido
ou substituído. Reconhecer ou adiar administra a atenção; somente nova evidência
resolve o sinal.

Abra primeiro as recomendações Críticas e Altas. Cada uma identifica o pilar e a
dimensão afetados e, quando disponível, quantos cenários ou interações originaram o
sinal. Use-as para distinguir entre:

- **Reforçar conhecimento:** faltam informações ou a fonte não foi recuperada.
- **Ajustar comportamento:** a informação existia, mas o agente perguntou, explicou,
  recusou ou transferiu de forma incorreta.
- **Reparar uma capacidade:** falhou uma ferramenta, conexão, política, aprovação ou
  rota humana.

O Centro de qualidade não reescreve automaticamente prompts, políticas ou conteúdo.
Admin faz a alteração, executa novamente os testes e verifica se novas evidências
confirmam a melhoria; Supervisor pode revisar resultados e coordenar o acompanhamento.

## Perguntar ao Parallly Assist

No Início ou no aviso global, **Perguntar ao Assist** abre o chat sobre o agente e o
sinal selecionados. O servidor valida tenant, papel, agente e sinal, e o Assist explica
uma prioridade com o estado atual. Admin pode receber uma rota de correção; Supervisor
recebe a rota de revisão sem ganhar permissão de edição.

O contexto contém apenas estado, versão, marco, códigos de bloqueio, atualidade dos
testes, amostra, gravidade, pilar, dimensão e contagens. Exclui transcrições, texto de
clientes, IDs de conversa, prompts, consultas de recuperação, texto livre do avaliador
e segredos. O Assist não aplica mudanças nem inicia comunicações externas.

Além do estado do agente, o Assist também recebe a **lista de canais conectados do
negócio** (tipo de canal, quantas contas e seu estado de credencial) e a evidência
limitada do controle: contagens e tipos de canal, nunca nomes, números ou
identificadores. Por isso ele consegue dizer qual canal está operando e qual falta
conectar, em vez de afirmar que você não tem canais conectados.

## Perguntas frequentes

**O checklist de configuração é igual ao Centro de qualidade?**
Não. O cartão **Primeiros passos** no Início mostra somente etapas essenciais
disponíveis para seu plano, papel e setor e desaparece ao concluí-las. Ele substitui a
antiga pílula flutuante `8/9`. Saúde dos agentes acrescenta testes e evidência real.

**Uma boa pontuação de simulação basta para publicar?**
Não. Ela ajuda a reduzir o risco, mas deve ser revisada junto com bloqueios críticos,
atualidade da versão e evidência real quando disponível.

**O sistema aprende e muda sozinho após cada conversa?**
Não. As interações geram diagnósticos e recomendações; uma pessoa revisa e aprova
qualquer mudança antes de testá-la novamente.
