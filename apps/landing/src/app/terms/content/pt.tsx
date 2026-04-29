"use client";

import Link from "next/link";

export default function TermsPt() {
  return (
    <>
      {/* Back link */}
      <Link
        href="/"
        className="inline-flex items-center gap-2 text-sm text-text-muted hover:text-accent transition-colors mb-12"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M19 12H5M12 19l-7-7 7-7" />
        </svg>
        Voltar ao início
      </Link>

      {/* Title */}
      <h1 className="text-4xl font-bold tracking-tight mb-4">
        Termos e Condições
      </h1>
      <p className="text-text-muted text-sm mb-12">
        Última atualização: 29 de abril de 2026
      </p>

      <div className="space-y-12 text-text-secondary leading-relaxed">
        {/* Intro */}
        <p>
          Estes Termos e Condições (doravante, os &quot;Termos&quot;) regulam o
          acesso e o uso da plataforma{" "}
          <strong className="text-text-primary">Parallly</strong>{" "}
          (parallly-chat.cloud), operada por{" "}
          <strong className="text-text-primary">Automation AI S.A.S</strong>{" "}
          (NIT: 902032943-1), com sede em Bogotá, Colômbia. Ao acessar ou
          utilizar o serviço, você aceita estes Termos em sua totalidade.
        </p>

        {/* 1 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            1. Aceitação dos termos
          </h2>
          <p className="mb-4">
            Ao criar uma conta, acessar ou utilizar o Parallly, você declara
            que:
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              Tem pelo menos 18 anos de idade e capacidade legal para celebrar
              contratos vinculantes.
            </li>
            <li>
              Atua em nome próprio ou como representante autorizado de uma
              pessoa jurídica.
            </li>
            <li>
              Leu, compreendeu e aceita estes Termos e a nossa{" "}
              <Link href="/privacy" className="text-accent hover:underline">
                Política de Privacidade
              </Link>
              .
            </li>
          </ul>
          <p className="mt-4">
            Se você não concorda com estes Termos, não deve utilizar o serviço.
          </p>
        </section>

        {/* 2 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            2. Descrição do serviço
          </h2>
          <p className="mb-4">
            O Parallly é uma plataforma de software como serviço (SaaS) de
            inteligência artificial conversacional projetada para automatizar
            vendas e atendimento ao cliente em canais de mensagens,
            principalmente o WhatsApp.
          </p>
          <p className="mb-4">
            O serviço inclui, entre outras funcionalidades:
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              Agentes de IA configuráveis que respondem automaticamente a
              mensagens recebidas.
            </li>
            <li>
              Arquitetura multi-tenant com isolamento de dados por organização.
            </li>
            <li>
              CRM integrado com caixa de entrada, atribuição de conversas e
              encaminhamento para agentes humanos.
            </li>
            <li>
              Integração com diversos provedores de modelos de linguagem
              (OpenAI, Anthropic, Google, entre outros).
            </li>
            <li>
              Painel de administração com métricas, configuração de personas e
              gestão de equipe.
            </li>
            <li>
              Integração nativa com a WhatsApp Business API por meio da Meta
              Cloud API.
            </li>
          </ul>
        </section>

        {/* 3 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            3. Cadastro e contas
          </h2>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              Para utilizar o Parallly, você deve criar uma conta fornecendo
              informações verdadeiras, completas e atualizadas.
            </li>
            <li>
              Você é responsável por manter a confidencialidade das suas
              credenciais de acesso e por todas as atividades realizadas sob a
              sua conta.
            </li>
            <li>
              Você deve nos notificar imediatamente sobre qualquer uso não
              autorizado da sua conta.
            </li>
            <li>
              Reservamo-nos o direito de suspender ou cancelar contas que
              violem estes Termos ou que contenham informações falsas.
            </li>
            <li>
              Cada organização (tenant) pode ter múltiplos usuários com
              diferentes papéis: administrador, supervisor e agente.
            </li>
          </ul>
        </section>

        {/* 4 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            4. Planos e preços
          </h2>
          <p className="mb-4">
            O Parallly oferece os seguintes planos de assinatura:
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-3 pr-4 text-text-primary font-semibold">
                    Recurso
                  </th>
                  <th className="text-center py-3 px-4 text-text-primary font-semibold">
                    Starter
                  </th>
                  <th className="text-center py-3 px-4 text-text-primary font-semibold">
                    Pro
                  </th>
                  <th className="text-center py-3 px-4 text-text-primary font-semibold">
                    Enterprise
                  </th>
                </tr>
              </thead>
              <tbody className="text-text-muted">
                <tr className="border-b border-border/50">
                  <td className="py-3 pr-4">Conversas/mês</td>
                  <td className="text-center py-3 px-4">500</td>
                  <td className="text-center py-3 px-4">5.000</td>
                  <td className="text-center py-3 px-4">Ilimitadas</td>
                </tr>
                <tr className="border-b border-border/50">
                  <td className="py-3 pr-4">Agentes de IA</td>
                  <td className="text-center py-3 px-4">1</td>
                  <td className="text-center py-3 px-4">5</td>
                  <td className="text-center py-3 px-4">Ilimitados</td>
                </tr>
                <tr className="border-b border-border/50">
                  <td className="py-3 pr-4">Usuários da equipe</td>
                  <td className="text-center py-3 px-4">2</td>
                  <td className="text-center py-3 px-4">10</td>
                  <td className="text-center py-3 px-4">Ilimitados</td>
                </tr>
                <tr className="border-b border-border/50">
                  <td className="py-3 pr-4">Suporte</td>
                  <td className="text-center py-3 px-4">E-mail</td>
                  <td className="text-center py-3 px-4">Prioritário</td>
                  <td className="text-center py-3 px-4">Dedicado</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-4 text-text-muted text-sm">
            Os preços vigentes estão publicados na página de preços de
            parallly-chat.cloud. Reservamo-nos o direito de modificar os preços
            mediante aviso prévio de 30 dias.
          </p>
        </section>

        {/* 5 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            5. Período de avaliação
          </h2>
          <p>
            O Parallly oferece um período de avaliação gratuito de 7 dias
            corridos para novos usuários. Durante esse período, você terá
            acesso às funcionalidades do plano Pro. Ao final do período de
            avaliação, se você não tiver selecionado um plano pago, sua conta
            passará para o estado inativo e nenhuma mensagem será processada
            até que você ative uma assinatura. Nenhuma cobrança automática será
            efetuada ao final da avaliação, exceto se você tiver selecionado
            explicitamente um plano pago.
          </p>
        </section>

        {/* 6 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            6. Faturamento e pagamentos
          </h2>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              As assinaturas são faturadas mensal ou anualmente, conforme o
              ciclo de faturamento selecionado.
            </li>
            <li>
              Os pagamentos são processados por meio de provedores de pagamento
              certificados PCI DSS. Não armazenamos dados de cartões de crédito
              em nossos servidores.
            </li>
            <li>
              As faturas são emitidas eletronicamente em conformidade com a
              regulamentação colombiana vigente.
            </li>
            <li>
              Os preços não incluem impostos aplicáveis, que serão calculados
              conforme a jurisdição do cliente.
            </li>
            <li>
              Em caso de inadimplência, reservamo-nos o direito de suspender o
              serviço após 7 dias de vencimento e de cancelar a conta após 30
              dias de inadimplência continuada.
            </li>
            <li>
              Não são realizados reembolsos por períodos parciais de uso, salvo
              em casos excepcionais avaliados individualmente.
            </li>
          </ul>
        </section>

        {/* 7 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            7. Uso aceitável
          </h2>
          <p className="mb-4">
            Ao utilizar o Parallly, você se compromete a não:
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              Enviar mensagens não solicitadas (spam) nem comunicações em massa
              sem o consentimento prévio do destinatário.
            </li>
            <li>
              Utilizar a plataforma para atividades ilegais, fraudulentas ou
              que infrinjam direitos de terceiros.
            </li>
            <li>
              Distribuir conteúdo que seja ilegal, difamatório, obsceno,
              ameaçador, que incite ao ódio ou que viole direitos de
              propriedade intelectual.
            </li>
            <li>
              Tentar acessar dados de outros tenants ou contornar os mecanismos
              de segurança da plataforma.
            </li>
            <li>
              Realizar engenharia reversa, descompilar ou desmontar qualquer
              parte do software.
            </li>
            <li>
              Exceder os limites de uso do seu plano (rate limits da API,
              conversas mensais, etc.) por meio de técnicas de evasão.
            </li>
            <li>
              Utilizar bots, scrapers ou outras ferramentas automatizadas para
              acessar o serviço fora das APIs fornecidas.
            </li>
            <li>
              Revender, sublicenciar ou redistribuir o serviço sem autorização
              por escrito.
            </li>
          </ul>
          <p className="mt-4">
            O descumprimento destas regras pode resultar na suspensão imediata
            ou cancelamento da conta, sem direito a reembolso.
          </p>
        </section>

        {/* 8 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            8. Propriedade intelectual
          </h2>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              O Parallly, incluindo seu software, design, logotipos, marcas e
              documentação, é de propriedade exclusiva da Automation AI S.A.S
              ou de seus licenciantes.
            </li>
            <li>
              É concedida a você uma licença limitada, não exclusiva, não
              transferível e revogável para utilizar o serviço de acordo com
              estes Termos e o plano contratado.
            </li>
            <li>
              Você não adquire qualquer direito de propriedade sobre o software
              ou a plataforma pelo uso do serviço.
            </li>
            <li>
              As configurações de agentes de IA, modelos de personas e fluxos
              criados pelo cliente dentro da plataforma são de propriedade do
              cliente.
            </li>
          </ul>
        </section>

        {/* 9 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            9. Dados do cliente
          </h2>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              O cliente mantém a propriedade sobre todos os dados que insere,
              processa ou armazena por meio da plataforma (os &quot;Dados do
              Cliente&quot;).
            </li>
            <li>
              O Parallly atua como operador no tratamento dos Dados do Cliente
              de acordo com a nossa{" "}
              <Link href="/privacy" className="text-accent hover:underline">
                Política de Privacidade
              </Link>{" "}
              e os contratos de tratamento de dados aplicáveis.
            </li>
            <li>
              Comprometemo-nos a não acessar, usar ou divulgar os Dados do
              Cliente, exceto quando necessário para: (a) prestar o serviço,
              (b) cumprir obrigações legais ou (c) com o consentimento expresso
              do cliente.
            </li>
            <li>
              O cliente é responsável por obter os consentimentos e
              autorizações necessários de seus clientes finais (end-users) para
              o tratamento de dados por meio da plataforma.
            </li>
            <li>
              Em caso de encerramento do serviço, o cliente poderá solicitar a
              exportação dos seus dados nos 30 dias seguintes. Decorrido esse
              prazo, os dados serão eliminados de forma segura.
            </li>
          </ul>
        </section>

        {/* 10 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            10. Limitação de responsabilidade
          </h2>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              O serviço é fornecido &quot;no estado em que se encontra&quot; e
              &quot;conforme disponibilidade&quot;, sem garantias de qualquer
              tipo, expressas ou implícitas.
            </li>
            <li>
              O Parallly não garante que o serviço será ininterrupto, livre de
              erros ou que atenderá a todos os requisitos específicos do
              cliente.
            </li>
            <li>
              Não somos responsáveis pelas respostas geradas pelos modelos de
              IA, que podem conter imprecisões. O cliente é responsável por
              supervisionar e validar o conteúdo gerado.
            </li>
            <li>
              Em nenhum caso a responsabilidade total da Automation AI S.A.S
              excederá o valor total pago pelo cliente nos 12 meses anteriores
              ao evento que deu origem à reclamação.
            </li>
            <li>
              Não seremos responsáveis por danos indiretos, incidentais,
              especiais, consequentes ou punitivos, incluindo perda de lucros,
              dados, uso ou reputação.
            </li>
            <li>
              O Parallly não será responsável por interrupções do serviço
              causadas por: (a) manutenção programada, (b) força maior, (c)
              falhas de provedores terceiros (Meta, provedores de IA, hosting)
              ou (d) ações do cliente.
            </li>
          </ul>
        </section>

        {/* 11 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            11. Indenização
          </h2>
          <p>
            O cliente compromete-se a indenizar, defender e isentar a
            Automation AI S.A.S, seus diretores, funcionários, agentes e
            afiliados, de e contra qualquer reclamação, dano, perda,
            responsabilidade, custo e despesa (incluindo honorários
            advocatícios) decorrentes ou relacionados a: (a) o uso do serviço
            pelo cliente, (b) a violação destes Termos, (c) a violação de
            direitos de terceiros ou (d) o conteúdo processado por meio da
            plataforma pelo cliente ou seus usuários finais.
          </p>
        </section>

        {/* 12 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            12. Encerramento do serviço
          </h2>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              O cliente pode cancelar a sua assinatura a qualquer momento pelo
              painel de administração. O cancelamento será efetivo no final do
              período de faturamento vigente.
            </li>
            <li>
              Reservamo-nos o direito de suspender ou cancelar o serviço
              imediatamente em caso de: (a) violação destes Termos, (b)
              atividade fraudulenta ou ilegal, (c) inadimplência continuada ou
              (d) por exigência legal.
            </li>
            <li>
              Em caso de encerramento, o cliente poderá exportar os seus dados
              nos 30 dias seguintes. Decorrido esse prazo, todos os dados serão
              eliminados de forma segura.
            </li>
            <li>
              As obrigações de confidencialidade, propriedade intelectual,
              limitação de responsabilidade e indenização sobreviverão ao
              encerramento.
            </li>
          </ul>
        </section>

        {/* 13 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            13. Alterações dos termos
          </h2>
          <p>
            Reservamo-nos o direito de alterar estes Termos a qualquer momento.
            As alterações significativas serão notificadas por meio de aviso na
            plataforma ou por e-mail com pelo menos 30 dias de antecedência. O
            uso contínuo do serviço após a entrada em vigor das alterações
            constitui aceitação dos Termos modificados. Se você não concorda
            com as alterações, pode cancelar a sua assinatura antes da data de
            entrada em vigor.
          </p>
        </section>

        {/* 14 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            14. Lei aplicável e resolução de disputas
          </h2>
          <p className="mb-4">
            Estes Termos regem-se e interpretam-se em conformidade com as leis
            da República da Colômbia.
          </p>
          <p className="mb-4">
            Qualquer controvérsia que surja em relação a estes Termos será
            resolvida da seguinte forma:
          </p>
          <ol className="list-decimal pl-6 space-y-2">
            <li>
              <strong className="text-text-primary">
                Negociação direta:
              </strong>{" "}
              as partes tentarão resolver a disputa de boa-fé durante um
              período de 30 dias úteis.
            </li>
            <li>
              <strong className="text-text-primary">Mediação:</strong> se a
              negociação direta não tiver sucesso, as partes poderão recorrer a
              um mediador designado de comum acordo.
            </li>
            <li>
              <strong className="text-text-primary">Arbitragem:</strong> como
              último recurso, a disputa será resolvida por arbitragem
              administrada pelo Centro de Arbitraje y Conciliación de la Cámara
              de Comercio de Bogotá (Centro de Arbitragem e Conciliação da
              Câmara de Comércio de Bogotá), de acordo com o seu regulamento
              vigente. A sentença arbitral será definitiva e vinculante.
            </li>
          </ol>
        </section>

        {/* 15 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            15. Disposições gerais
          </h2>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong className="text-text-primary">Acordo integral:</strong>{" "}
              estes Termos, juntamente com a Política de Privacidade e a
              Política de Tratamento de Dados, constituem o acordo integral
              entre as partes e substituem qualquer acordo anterior.
            </li>
            <li>
              <strong className="text-text-primary">Divisibilidade:</strong> se
              alguma disposição destes Termos for declarada inválida ou
              inaplicável, as demais disposições permanecerão em pleno vigor e
              efeito.
            </li>
            <li>
              <strong className="text-text-primary">Cessão:</strong> o cliente
              não poderá ceder ou transferir estes Termos sem o consentimento
              prévio por escrito da Automation AI S.A.S.
            </li>
            <li>
              <strong className="text-text-primary">Renúncia:</strong> a
              ausência de exercício de qualquer direito previsto nestes Termos
              não constituirá renúncia a esse direito.
            </li>
            <li>
              <strong className="text-text-primary">Força maior:</strong>{" "}
              nenhuma das partes será responsável pelo descumprimento causado
              por eventos fora do seu controle razoável, incluindo desastres
              naturais, pandemias, guerras, atos de governo ou falhas de
              infraestrutura de terceiros.
            </li>
            <li>
              <strong className="text-text-primary">Notificações:</strong> as
              notificações legais serão enviadas para o e-mail registrado na
              conta do cliente. As notificações para a Automation AI S.A.S
              devem ser enviadas para{" "}
              <a
                href="mailto:cloud.manager@parallext.com"
                className="text-accent hover:underline"
              >
                cloud.manager@parallext.com
              </a>
              .
            </li>
          </ul>
        </section>

        {/* 16 */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            16. Conformidade com as políticas da Meta e obrigações do cliente
          </h2>
          <p className="mb-4">
            Quando o cliente conecta o WhatsApp, o Instagram ou o Messenger ao
            Parallly, o cliente passa a ser responsável pelo cumprimento das
            políticas da Meta Platforms, Inc. que regem esses produtos. O
            Parallly fornece a infraestrutura técnica, mas não controla o
            conteúdo da mensagem, o público nem a intenção comercial decidida
            pelo cliente.
          </p>

          <h3 className="text-lg font-semibold text-text-primary mt-6 mb-3">
            Políticas da Meta aplicáveis ao cliente
          </h3>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong className="text-text-primary">
                Meta Platform Terms (DFC):
              </strong>{" "}
              termos gerais que regem o uso das plataformas da Meta por
              desenvolvedores e empresas.
            </li>
            <li>
              <strong className="text-text-primary">
                Meta Developer Policies:
              </strong>{" "}
              regras de desenvolvimento, segurança de dados e uso das APIs da
              Meta.
            </li>
            <li>
              <strong className="text-text-primary">
                WhatsApp Business Solution Provider Terms:
              </strong>{" "}
              termos específicos que regem o uso da WhatsApp Business Platform
              por meio de um provedor de soluções.
            </li>
            <li>
              <strong className="text-text-primary">
                WhatsApp Business Messaging Policy:
              </strong>{" "}
              janela de atendimento de 24 horas, requisitos de opt-in e
              categorias de mensagem (utility / authentication / marketing /
              service).
            </li>
            <li>
              <strong className="text-text-primary">
                WhatsApp Commerce Policy:
              </strong>{" "}
              lista de bens e serviços proibidos no WhatsApp.
            </li>
            <li>
              <strong className="text-text-primary">
                Instagram Platform Policy:
              </strong>{" "}
              regras aplicáveis às mensagens e integrações do Instagram.
            </li>
            <li>
              <strong className="text-text-primary">
                Messenger Platform Policy:
              </strong>{" "}
              regras aplicáveis às mensagens e integrações do Messenger.
            </li>
          </ul>

          <h3 className="text-lg font-semibold text-text-primary mt-6 mb-3">
            Obrigações específicas do cliente
          </h3>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              Obter opt-in explícito de cada usuário final antes de iniciar
              conversas de saída no WhatsApp, Instagram ou Messenger, e
              conservar a comprovação desse opt-in.
            </li>
            <li>
              Respeitar as palavras-chave de descadastramento (STOP, BAJA,
              CANCELAR, etc.). O pipeline de conformidade do Parallly as
              detecta, mas a decisão final de honrá-las continua sendo um
              dever legal do cliente.
            </li>
            <li>
              Utilizar apenas Modelos de Mensagem (Message Templates) aprovados
              pela Meta para mensagens de saída do WhatsApp enviadas fora da
              janela de atendimento de 24 horas.
            </li>
            <li>
              Não enviar conteúdo proibido (bens ilegais, drogas, armas,
              conteúdo sexual, discurso de ódio, fraudes financeiras, etc.).
            </li>
            <li>
              Manter nome de exibição, perfil empresarial e informações de
              contato precisos nos canais conectados.
            </li>
            <li>
              Desconectar ou atualizar imediatamente os canais se a Meta
              rebaixar a classificação de qualidade, suspender ou notificar a
              conta.
            </li>
            <li>
              Manter sua própria política de privacidade e termos de serviço
              públicos e consistentes com os requisitos da Meta para empresas
              em suas plataformas.
            </li>
          </ul>

          <h3 className="text-lg font-semibold text-text-primary mt-6 mb-3">
            Indenização
          </h3>
          <p>
            O cliente indeniza e isenta o Parallly de quaisquer multas,
            suspensões, sanções de qualidade de conta, ações judiciais ou
            danos impostos pela Meta Platforms ou por terceiros como
            consequência direta ou indireta de: (a) uso indevido pelo cliente
            dos canais conectados, (b) violação pelo cliente de qualquer
            política da Meta listada acima, (c) falha do cliente em obter
            opt-in dos usuários finais, ou (d) o conteúdo que o cliente ou seus
            agentes publiquem por meio do Parallly.
          </p>

          <h3 className="text-lg font-semibold text-text-primary mt-6 mb-3">
            Suspensão por descumprimento
          </h3>
          <p>
            O Parallly reserva-se o direito de suspender ou encerrar o acesso
            aos canais afetados (ou à conta inteira) caso receba notificação
            confiável da Meta sobre violações repetidas ou graves de
            políticas, ou detecte abusos por meio de seu monitoramento
            interno. Notificaremos o cliente e ofereceremos um prazo razoável
            para sanar a situação quando for viável; entretanto, se a Meta
            exigir ação imediata, a suspensão poderá ser imediata.
          </p>
        </section>

        {/* Contact */}
        <section>
          <h2 className="text-2xl font-semibold text-text-primary mb-4">
            Contato
          </h2>
          <div className="bg-surface rounded-xl border border-border p-6 space-y-3">
            <p>
              <strong className="text-text-primary">Razão social:</strong>{" "}
              Automation AI S.A.S
            </p>
            <p>
              <strong className="text-text-primary">NIT:</strong> 902032943-1
            </p>
            <p>
              <strong className="text-text-primary">Endereço:</strong> Bogotá,
              Colômbia
            </p>
            <p>
              <strong className="text-text-primary">E-mail:</strong>{" "}
              <a
                href="mailto:cloud.manager@parallext.com"
                className="text-accent hover:underline"
              >
                cloud.manager@parallext.com
              </a>
            </p>
            <p>
              <strong className="text-text-primary">Suporte:</strong>{" "}
              <a
                href="mailto:support@parallext.com"
                className="text-accent hover:underline"
              >
                support@parallext.com
              </a>
            </p>
          </div>
        </section>
      </div>
    </>
  );
}
