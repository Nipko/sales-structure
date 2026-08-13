---
id: centro-calidad-agente
title: "Centro de qualidade do agente"
routes: ["/admin/agent/quality"]
roles: ["tenant_admin", "tenant_supervisor"]
keywords: ["centro de qualidade", "qualidade do agente", "preparacao", "qualidade testada", "evidencia de producao", "agente em risco", "pronto para piloto", "configuracao incompleta", "revisao necessaria", "recomendacoes", "pontos fracos do agente", "melhorar agente"]
---

# Centro de qualidade do agente

O **Centro de qualidade** mostra o que ainda falta configurar, o que já foi testado e
o que acontece em conversas reais para cada agente de IA. Ele fica em **Insights →
Centro de qualidade**. Admin e Supervisor podem consultá-lo; somente Admin pode editar
agentes, conexões ou configurações em **IA e crescimento → Agente de IA**.

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

## Perguntas frequentes

**O checklist de configuração é igual ao Centro de qualidade?**
Não. O checklist orienta a adoção inicial. O centro acrescenta testes repetíveis e
evidência de produção atribuída.

**Uma boa pontuação de simulação basta para publicar?**
Não. Ela ajuda a reduzir o risco, mas deve ser revisada junto com bloqueios críticos,
atualidade da versão e evidência real quando disponível.

**O sistema aprende e muda sozinho após cada conversa?**
Não. As interações geram diagnósticos e recomendações; uma pessoa revisa e aprova
qualquer mudança antes de testá-la novamente.
