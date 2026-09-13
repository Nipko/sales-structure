---
id: privacidad-medios
title: "Privacidade para imagens, áudios e consentimento"
routes: ["/admin/settings/policies", "/admin/compliance", "/admin/settings/billing"]
roles: ["tenant_admin"]
keywords: ["privacidade", "consentimento", "audio", "imagem", "transcricao", "analise", "retencao", "revogar"]
---

# Privacidade para imagens, áudios e consentimento

O plano pode incluir análise de imagens ou transcrição de áudio, mas essa disponibilidade não autoriza o tratamento do conteúdo de uma pessoa. Antes de usar a capacidade, o negócio deve publicar uma política de privacidade ativa em **Configurações → Políticas → Privacidade**. O texto deve explicar quais mídias são processadas, com qual finalidade, por quanto tempo são conservadas e como retirar o consentimento. A pessoa responsável pelo negócio deve revisar o texto; o Parallly Assist não inventa nem publica condições legais.

Quando chega uma imagem ou um áudio sem autorização válida, o agente não conserva nem analisa esse arquivo. Ele envia uma solicitação clara, apresenta o link da política pública e espera uma confirmação explícita. Se a pessoa aceitar, a Parallly registra o escopo, a versão da política, a data e a conversa de origem. Depois pede o reenvio do arquivo original, pois a primeira cópia não foi retida. Uma resposta ambígua ou condicional não concede permissão.

O consentimento de mídia cobre a extração automática solicitada; não é uma autorização geral para reutilizar dados. O arquivo de origem e a extração temporária são eliminados ao concluir o turno. A mensagem final ao cliente segue a retenção normal da conversa. A autorização pode ser revogada em **Conformidade** e também perde a validade quando muda a versão ativa da política ou o contato é apagado.

A segurança da conta Parallly e a relação de pagamento com a Meta são assuntos separados. O cartão cadastrado pelo negócio para cobranças do WhatsApp é administrado pela Meta; ele não dá à Parallly acesso aos dados do cartão. A política de privacidade do negócio governa o tratamento dos dados de seus clientes pelo agente. Revise os dois controles separadamente e teste o agente com uma mídia sintética após publicar a política.

Se a Saúde do agente mostrar **Privacidade para imagens e áudios**, abra a recomendação ou use **Mostre-me como**. O bloqueio só desaparece quando há uma política de privacidade ativa disponível para o runtime; política de envio, termos gerais ou rascunho não resolvem.
