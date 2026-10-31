# OSINT // infoc.hacker

Site `https://ostnt.online/`. A produção é servida por `cloudflare-worker.mjs`; ele é a fonte de verdade dos headers. `public/_headers` vale somente para desenvolvimento Netlify. O código Netlify antigo é mantido por compatibilidade.

## Estado desta revisão

Código candidato, sem promoção em produção. A opção escolhida é validação remota antes do deploy. Consulte `verification/current-review.md` para resultados e limites da comprovação; documentos anteriores em `verification/` são históricos. O conector GitHub está conectado ao repositório `ninermegsq/pesquisa`; o projeto está na pasta `current-site/osint-infoc-hacker`.

## Fluxo e proteção

1. O browser busca a sitekey em `GET /.netlify/functions/token`, com cache público de 24h.
2. O visitante resolve Turnstile. `POST /.netlify/functions/token` valida Siteverify e emite token HMAC de 60s, vinculado ao alvo normalizado e ao IP.
3. `POST /api/scan` recebe `{alvo, token}` e exige Origin permitido. Token inválido, expirado ou repetido retorna 429. Não há bypass `x-validation`.
4. Durable Object SQLite coordena uso único e as cotas de 10 scans/hora e 60/dia por IP, inclusive concorrentes. O namespace é separado por hash do IP. KV guarda somente dois contadores espelhados por scan aceito; se o espelho falha, o limite persistente do Durable Object continua obrigatório.
5. Respostas excedendo cota têm 429 e Retry-After. Fonte indisponível não derruba o relatório: há status/proveniência por fonte e score parcial. Se nenhuma fonte responde, o nível é INCONCLUSIVO.

Cache de resultados em `caches.default`, usando `<origin>/__cache/<id>/<alvo-codificado>`. O prefixo HTTP é bloqueado com 404. Sucesso usa TTL da fonte; erro/timeout usa 120s. Mudanças de proveniência invalidam entradas anteriores. Cache é local ao datacenter, best-effort; teste local não comprova comportamento na borda. DDD local não acessa fetch nem Cache API.

O orçamento contabiliza custo externo declarado e reserva operações de cache, KV e autorização para não selecionar mais que o limite estimado de 50 subrequests. Fontes excluídas aparecem em `meta.omitidas` e tornam o resultado parcial. E-mail: 12 fontes, custo externo declarado 16; isso não é uma contagem medida da rede.

## Desenvolvimento e verificação

Use Node 24 para a suíte de verificação e instale as dependências de desenvolvimento:

```sh
npm install --include=dev
npm run build:worker
npm run check:worker
npm run test:unit
npm run test:runtime
```

`test:runtime` usa Miniflare/workerd local, Durable Objects SQLite e Cache API local, com todas as respostas externas simuladas e sem consultas públicas. Executa seis tipos, replay sequencial/concorrente, rajada de 11 tokens distintos, 11º scan e espera real de 121 segundos para erro em cache. Não é aceite de edge ou prova de disponibilidade de fontes.

Autenticação do CLI é independente dos conectores ChatGPT:

```sh
npx wrangler whoami
npx wrangler login --device --browser=false
npm run dev:validation
```

`wrangler.validation.toml` aponta para `ostnt-validation`. O comando dev:validation usa wrangler.remote-client.toml, um cliente local ligado ao componente remoto por service binding autenticado, padrão oficial para testar Durable Objects SQLite implantados. O Worker de validação mantém workers.dev e previews públicos desligados. É uma verificação do componente e da saída das fontes; não testa nem remove a restrição WAF da entrada pública. Não confundir esse resultado com acesso público aprovado. `--remote` executa na Cloudflare e pode usar recursos remotos; não é teste puramente local. Durable Objects SQLite não são suportados diretamente pelo modo remoto legado: a validação completa exige um ambiente isolado implantado e autenticado apropriado, não enfraquecer a proteção para fazê-lo caber em dev --remote. Qualquer bloqueio real deve ser registrado e respeitado, sem alternar clientes ou redes para evitá-lo.

## Segredos e ambientes

Produção: APP_ENV=production e sitekey real em TURNSTILE_SITE_KEY ou TURNSTILE_SITEKEY. Configure TURNSTILE_SECRET e HMAC_SECRET como secrets. TOKEN_GUARD e sua migração SQLite devem acompanhar o código. Chaves dummy são rejeitadas em produção, inclusive se APP_ENV for configurado incorretamente no hostname ostnt.online.

Validação: APP_ENV=validation, sitekey dummy e secret dummy correspondente da documentação oficial da Cloudflare, HMAC_SECRET próprio, Origins explicitamente permitidos. A resposta dummy de Siteverify pode ter hostname localhost; essa exceção só vale com par de chaves de teste no ambiente de validação. Cada emissão registra `TURNSTILE_SITEKEY de teste em uso`.

A TURNSTILE_SITEKEY de teste nunca pode ir para produção porque aceita qualquer visitante. `.dev.vars*` e `.env.*` estão ignorados no Git. Não coloque credenciais em HTML, logs, comandos literais ou no repositório. Para segredos, use o prompt seguro do Wrangler com o arquivo de configuração do ambiente correto.

| Segredo opcional | Uso | Cadastro/documentação |
| --- | --- | --- |
| GITHUB_TOKEN | Busca de perfis públicos, cache de sucesso 24h | https://docs.github.com/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens |
| EMAILREP_KEY | Reputação de e-mail | https://emailrep.io/ |
| TRANSPARENCIA_KEY | Consulta CEIS | https://portaldatransparencia.gov.br/api-de-dados |

sem a chave a fonte aparece indisponível e score.parcial vira true; o restante do relatório não é afetado

O operador informou que o token do GitHub pertence a conta de teste e expira em aproximadamente 90 dias; a validade não foi confirmada por API. A chave da Transparência é pessoal do titular; revogá-la interrompe essa fonte. Nenhuma dessas chaves é solicitada ao visitante.

## User-Agent

| UA_MODE | Header User-Agent | Uso |
| --- | --- | --- |
| identificado | env.UA; fallback de identificação do scanner | Padrão e produção |
| navegador | env.UA_NAVEGADOR | Apenas configuração de validação, ainda sem A/B comprovado no Worker |

alterar o modo muda apenas o header User-Agent; o cliente HTTP permanece fetch do runtime

UA_MODE desconhecido ou UA_NAVEGADOR ausente no modo navegador resulta em erro explícito. O modo não é tratado como solução comprovada para 1010.

## Fontes e limitações

- DDD: snapshot Anatel com 67 DDDs em `src/data/ddd.mjs`, custo 0. Preserva UFs múltiplas onde existentes; não infere localização atual de telefone. Fonte e SHA-256 do CSV estão no arquivo.
- CNPJ: `cnpj_br` usa Minha Receita, mantendo formato do relatório. O endpoint respondeu 200/JSON no teste direto local; ainda depende de validação na borda. O fallback CNPJ.ws só será adotado se houver falha real que o justifique.
- Subdomínios: id `crtsh` preservado, provedor Subdomain Center. Testes diretos locais receberam 503 e timeout, sem sucesso comprovado. A API anônima fornece amostra; o relatório limita a 60 nomes. Não é enumeração completa.
- Observatory: endpoint atualizado conforme MDN para `POST https://observatory-api.mdn.mozilla.net/api/v2/scan`; a API resumida v2 não fornece a lista detalhada de falhas, então o relatório mostra os contadores disponíveis.
- Telegram: somente telefone, com parse do título/descrição. Erros HTTP de serviço são erros; não viram falsamente conta inexistente. Uma correspondência pública não comprova identidade.
- As consultas de perfis e nomes são buscas públicas, não provas de titularidade. CPF está fora do escopo. Sem confirmação de dados, não apresente ausência de resultado como garantia de segurança.
- Senhas do teste anônimo são SHA-1 no cliente: somente prefixo de cinco caracteres é enviado a Pwned Passwords, com Add-Padding. Fragmentos de Hudson Rock são mascarados antes de cache/exportação.

O operador atribuiu o 1010 ao IP de saída do Worker. Essa causa ainda não foi comprovada neste ambiente; a evidência disponível do 1010 inicial é de acesso ao próprio Worker de validação, antes de executar fontes. Troca de provedor é uma decisão de disponibilidade, não uma confirmação causal. Cada endpoint é classificado pelo próprio status e corpo; BrasilAPI CNPJ e DDD não são agrupados por host. Não há fontes movidas ao browser ou removidas nesta revisão.

## Relatório e exportação

JSON completo e CSV são gerados no navegador. Não existe `/api/export`. JSON schemaVersion=2 mantém alvo tipado, fontes, status, proveniência, timestamps, cache, score, pivôs e metadados. CSV contém fonte/campo/valor/severidade/proveniência/timestamp, com proteção de fórmulas de planilha. Severidade `informativa` descreve dados de consulta, não uma classificação de vulnerabilidade; fontes que falharam usam `indisponivel`.

Os oito dorks para e-mail continuam disponíveis. Acessibilidade anuncia uma contagem de achados tipada por fonte, não a quantidade de campos exportados. Não há cookies próprios; fornecedores e infraestrutura podem manter registros. Não há garantia de ausência total de logs.

## Headers e conteúdo público

CSP sem unsafe-inline em script-src; script do scanner externo com defer. HSTS HTML `max-age=31536000`, sem includeSubDomains/preload; COOP same-origin, COEP credentialless e CORP same-origin. Inclua subdomínios em HSTS somente após verificar HTTPS em todos eles. A submissão a preload é etapa manual posterior.

Robots/sitemap/canonical apontam para ostnt.online. `public/og.html` contém o card aprovado por especificação; `og.jpg` foi renderizado em 1200x630, qualidade 88, abaixo de 300 KB, com metadata alinhada. O caminho antigo /og.png redireciona para /og.jpg. security.txt tem contato existente, idiomas e expiração anual a revisar antes de vencer.

A CSP permite o beacon, mas sua injeção observada vem de fora do HTML do repositório. Ainda falta comprovar `/cdn-cgi/rum` 200 no Network ou remover a injeção na origem correta. Lighthouse mobile >=95 e ausência de violações em produção continuam pendentes de medição real.

## Promoção

Nenhum teste local substitui o aceite remoto. Antes de promover: confirmar fontes por endpoint, cache de edge, token, cotas, exportações, arquivos públicos e console. Produção usa chaves reais, APP_ENV=production e UA_MODE=identificado. Faça smoke tests com rollback disponível; falhas bloqueiam a conclusão. A versão candidata desta revisão não foi publicada em produção.
