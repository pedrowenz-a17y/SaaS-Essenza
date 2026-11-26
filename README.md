# Essenza

SaaS em português do Brasil para agenda, clientes, serviços, estoque e financeiro de pequenas empresas de beleza. O projeto usa Next.js, TypeScript, Tailwind CSS, componentes Radix no padrão shadcn/ui, FullCalendar, Recharts e Supabase. A instalação começa com o banco vazio.

## Instalação local

Pré-requisitos. Node.js 22 ou superior, npm e Docker para executar o Supabase localmente. Você também pode apontar o aplicativo para um projeto de desenvolvimento no Supabase.

1. Rode os comandos na pasta que contém package.json.

   ~~~sh
   npm ci
   npx supabase start
   cp .env.example .env.local
   ~~~

2. Use *API URL*, *Publishable Key* e *Secret Key* exibidas por npx supabase status. Preencha as três variáveis correspondentes em .env.local. Em projetos com chaves legadas, use anon e service_role. Gere valores diferentes para BOOKING_SIGNING_SECRET e CRON_SECRET com openssl rand -hex 32.
3. Execute npm run dev e abra http://localhost:3000. Cadastre uma conta e abra o e-mail de confirmação no Mailpit local em http://127.0.0.1:54325. Crie a empresa e configure profissionais, serviços, clientes e produtos.
4. Para aplicar novas migrações ao banco local, use npx supabase migration up --local. Configure produtos e materiais nos serviços antes de concluir os primeiros atendimentos.

### Variáveis

| Variável | Uso |
| --- | --- |
| NEXT_PUBLIC_SUPABASE_URL | URL da API do Supabase. |
| NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY | Chave pública usada pelas sessões da aplicação. |
| SUPABASE_SERVICE_ROLE_KEY | Chave de servidor usada pelas rotas públicas mediadas e pela fila de lembretes. |
| APP_URL | Origem do aplicativo, sem caminho. Compõe os links para e-mails, WhatsApp e convites. |
| BOOKING_SIGNING_SECRET | Chave aleatória de pelo menos 32 caracteres. Alterá-la invalida links de atendimento emitidos. |
| CRON_SECRET | Chave aleatória de pelo menos 32 caracteres para autenticar a tarefa do servidor. |
| RESEND_API_KEY, RESEND_FROM | Chave do Resend e remetente em domínio verificado. |
| WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID | Token de produção e ID do número remetente na Meta. |
| WHATSAPP_GRAPH_VERSION, WHATSAPP_TEMPLATE_LANGUAGE | Versão suportada pela Graph API, como v23.0, e código aprovado do idioma, normalmente pt_BR. |
| WHATSAPP_REMINDER_TEMPLATE, WHATSAPP_CONFIRMATION_TEMPLATE | Nomes dos modelos aprovados de lembrete e confirmação. |
| NEXT_PUBLIC_APP_NAME | Nome global opcional. Cada empresa configura separadamente seu próprio nome e logotipo. |

Somente variáveis com prefixo NEXT_PUBLIC_ podem ir ao navegador. Use ambientes Supabase diferentes para desenvolvimento, homologação e produção.

## Publicação na Vercel

1. Crie um projeto vazio no Supabase. Na raiz do repositório, execute npx supabase login, npx supabase link --project-ref SEU_PROJECT_REF e npx supabase db push. As migrações criam as tabelas, as políticas RLS, os índices, as funções transacionais e os buckets.
2. Importe o repositório na Vercel. Selecione **Next.js**, Node.js 22 ou posterior e a pasta que contém package.json como raiz. Configure as variáveis de produção no painel da Vercel. Defina APP_URL com o domínio HTTPS definitivo.
3. Em *Authentication → URL Configuration* no Supabase, defina *Site URL* como APP_URL e permita APP_URL/auth/callback e suas variantes com parâmetros. Configure SMTP para e-mails de cadastro e recuperação. Esta configuração é independente dos e-mails de lembrete do Resend.
4. Os modelos padrão de e-mail podem usar o fluxo PKCE com {{ .ConfirmationURL }}. Para permitir confirmação em outro navegador, use os links com token_hash abaixo nos respectivos modelos em *Authentication → Email Templates*.

   ~~~text
   Confirm signup
   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email

   Reset password
   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery
   ~~~

5. Publique a aplicação. Valide cadastro, redefinição de senha, criação de empresa e o link público usando um endereço de homologação.
6. No Vault do Supabase, cadastre essenza_app_url e essenza_cron_secret com os valores de APP_URL e CRON_SECRET. Execute supabase/cron/setup.sql no SQL Editor. Em *Cron*, confira a tarefa **essenza-lembretes**, agendada a cada cinco minutos. O histórico de envios fica em **Configurações → Histórico de envios**.

O endpoint do cron também aceita chamadas de outro serviço agendador. Envie POST para APP_URL/api/cron/lembretes com Authorization: Bearer CRON_SECRET. A fila usa bloqueio de linha para reservar cada tarefa. O processamento periódico continua com o navegador fechado.

## WhatsApp Business Cloud API

1. Na Meta, configure um aplicativo com **WhatsApp Business Platform** e adicione o número que fará os envios. Obtenha o *Phone Number ID* e um token de servidor com whatsapp_business_messaging. Use credenciais de teste na homologação.
2. No WhatsApp Manager, envie para aprovação os modelos de utilidade nos idiomas e nomes escolhidos. Cadastre seis parâmetros posicionais no corpo, nesta ordem. Nome da cliente, serviço, data, horário, empresa e link de gerenciamento.

   ~~~text
   Lembrete
   Olá, {{1}}! Seu atendimento de {{2}} está marcado para {{3}}, às {{4}}, em {{5}}.
   Confirme a presença ou gerencie o horário em {{6}}.

   Confirmação
   Olá, {{1}}! Seu agendamento de {{2}} para {{3}}, às {{4}}, em {{5}}, foi confirmado.
   Consulte seu horário em {{6}}.
   ~~~

3. Preencha as variáveis WHATSAPP_ na Vercel e marque o canal em **Configurações → Empresa → Lembretes e confirmação**. Os nomes dos modelos no painel da Meta devem corresponder às variáveis. Os envios utilizam a API oficial e o consentimento registrado na ficha da cliente.
4. Em homologação, teste com um destinatário autorizado e confira a resposta no histórico. O estado **Enviado** indica aceitação pelo provedor. Falhas de rede com entrega incerta no WhatsApp ficam registradas para conferência, pois uma repetição automática pode duplicar a mensagem.

A instalação usa um remetente de WhatsApp e um remetente de e-mail configurados no servidor. Os modelos da Meta são administrados no WhatsApp Manager. O texto do lembrete por e-mail é personalizável por empresa.

## E-mail e notificações

Verifique o domínio remetente no Resend, configure RESEND_API_KEY e RESEND_FROM e habilite e-mail nas configurações de cada empresa. O cron registra tentativas, envios e supressões de mensagens. Os campos dinâmicos do e-mail são {cliente}, {servico}, {data}, {hora}, {empresa} e {link}. O link permite solicitar reagendamento, confirmar presença e cancelar dentro da regra de antecedência. Pedidos online pendentes de aprovação são confirmados pela equipe.

Os lembretes têm antecedência inicial de 24 horas. Você pode configurar até cinco prazos de 15 minutos até 7 dias. Um horário criado depois que um prazo já passou recebe apenas os lembretes com prazo futuro. Cancelamentos, reagendamentos e revogação de consentimento são verificados antes da entrega. Credenciais ausentes aparecem no painel, e canais desativados deixam os lembretes internos disponíveis.

## Operação e dados

- **Agenda e estoque.** A restrição de intervalos do PostgreSQL protege contra conflitos simultâneos da mesma profissional, incluindo bloqueios. Horários usam timestamptz e são exibidos em America/Sao_Paulo. Concluir um atendimento grava consumo e financeiro na mesma transação. Produtos e serviços arquivados preservam o histórico.
- **Financeiro.** Faturamento considera o valor recebido na data de liquidação. O lucro estimado é o recebido menos as despesas pagas registradas. Compras lançadas como despesa aparecem no fluxo de caixa. A margem por serviço usa o custo dos materiais consumidos naquele atendimento.
- **Reposição.** O estoque é sinalizado como suficiente, baixo ou esgotado. Alterações de faixa geram um aviso por ocorrência e ajustam a lista de compras. A previsão usa 28 dias de consumo, com registros em pelo menos três dias distintos ao longo de sete dias ou mais. Produtos com histórico abaixo desse critério mostram “Histórico insuficiente”.
- **Permissões.** Proprietárias e administradoras gerenciam a operação. Recepcionistas cadastram clientes e gerenciam a agenda. Profissionais consultam sua agenda e clientes vinculadas e concluem os atendimentos atribuídos. Convites são vinculados ao e-mail verificado e aceitos dentro da aplicação. O campo plan no banco oferece um ponto de extensão para planos futuros.
- **Privacidade.** A exportação e exclusão ficam na ficha de cada cliente, com acesso gerencial. A exclusão remove o cadastro, notas de agenda vinculadas e lembretes associados, e conserva o histórico operacional anonimizado e os lançamentos da empresa. Cada empresa define seu aviso de privacidade e sua política de retenção. Fotos de estoque usam URLs temporárias e logotipos da página pública ficam no bucket público.
- **PWA.** A instalação pelo navegador exige HTTPS em produção. Sem conexão, o aplicativo exibe uma página de reconexão. O cache do Service Worker guarda somente a página offline e seu ícone.

## Testes

~~~sh
npm run test
npm run test:db
npm run lint
npm run typecheck
npm run build
~~~

Os testes TypeScript cobrem validação, fuso horário, assinatura e expiração de links, CSV e comportamento dos provedores de mensagens. O teste SQL usa uma transação revertida para validar isolamento, convites, conflitos, cancelamentos, consumo idempotente, financeiro, fila, alertas e privacidade. Para rodá-lo diretamente num Supabase PostgreSQL de homologação migrado, use psql -XAtq "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/operations.test.sql com um usuário administrativo. A suíte cria registros temporários e reverte a transação.

## Pastas

| Pasta | Conteúdo |
| --- | --- |
| src/app | Rotas do painel, autenticação, agendamento público, exportação e cron. |
| src/components | Interface responsiva e formulários. |
| src/lib | Validação, formatação, clientes Supabase e operações do servidor. |
| supabase/migrations | Esquema PostgreSQL, RLS, Storage e operações transacionais. |
| supabase/cron | Configuração da tarefa agendada. |
| supabase/tests e tests | Testes de banco e de aplicação. |
| public | Imagem editorial, ícones PWA e página offline. |
