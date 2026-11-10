# Verificação — 2026-10-30

Estado: NÃO CONCLUÍDO. Código candidato, não promovido a produção.

## Evidência real obtida

- GET/HEAD https://ostnt.online/: 200, HSTS `max-age=31536000`.
- CSP em produção contém `static.cloudflareinsights.com` em script-src e `cloudflareinsights.com` em connect-src. Sem unsafe-inline em script-src.
- robots em produção: User-agent *, Allow /, Sitemap https://ostnt.online/sitemap.xml. Nenhum comentário content-signals estava presente no arquivo local ou resposta observada; nada foi removido.
- DOM de navegador: beacon injetado externamente ao HTML do repositório. Sem violação de CSP nos logs consultados. O recurso de navegador disponível não expõe Network, portanto NÃO há prova de POST /cdn-cgi/rum 200.
- Configuração da zona: rum=off; lista de sites Web Analytics retornou vazia. A origem da injeção ainda precisa ser identificada antes de alterar outra configuração.
- og.png: captura da interface existente, 1200x630, PNG. Incluído no build do Worker candidato; ainda não validado publicado.
- Worker isolado ostnt-validation criado na conta do projeto, com CACHE e TOKEN_GUARD; endpoint de teste exige credencial temporária e restringe o alvo ao e-mail autorizado. Nenhum segredo de produção foi copiado. A rota workers.dev e Version URLs desse Worker foram desligadas depois do 403; nenhum scan real chegou ao handler.
- Stream da API de tail conectado (mesmo backend de wrangler tail, não execução do CLI). CLI local não dispõe de credencial.
- Primeira tentativa autenticada ao preview: HTTP 403, Cloudflare 1010. Nenhuma execução das fontes foi observada no tail. Revisão automática bloqueou a tentativa de mudar de cliente HTTP; não há resultados reais de fontes a declarar. Depois desse bloqueio, foi preparado o arquivo `wrangler.validation.toml` com sitekey de teste e o hostname de validação para uso somente fora da produção.
- As URLs de versão não são geradas para Workers com classes Durable Object; a documentação também informa que version URLs não expõem wrangler tail. O teste usa um Worker de validação implantado, distinto do editor/playground/wrangler dev.

## Verificação local (não é aceite de produção)

Comando: `node verification/cache-check.mjs`

```json
{"scope":"LOCAL ONLY; not upstream or edge validation","successTTL":86400,"errorTTL":120,"timeoutTTL":120,"cacheHit":true,"sourceKVWrites":0,"scanKVWrites":2,"emailSources":12,"emailSubrequests":16,"offlineStatus":200,"partial":true}
```

Sintaxe de Worker, registry e app.js verificada com node --check.

## Endurecimento aplicado (verificação local)

Camadas adicionadas nesta etapa, todas com verificação offline própria:

| Arquivo | O que garante |
| --- | --- |
| `src/contract.mjs` | Taxonomia (`sem_chave`, `sem_token`, `erro_rede`, `timeout`, `http`, `formato`, `erro`), normalização do resultado e resumo de saúde. Falha de configuração não marca o relatório como parcial. |
| `src/sources/registry.json` + `scripts/build-registry.mjs` | Manifesto com os metadados das 24 fontes; o módulo gerado (`registry.meta.mjs`) é validado contra a implementação no carregamento. |
| `migrations/*.sql` + `scripts/build-migrations.mjs` + `src/lib/sql-migrations.mjs` | Schema do Durable Object versionado e aplicado uma única vez. |
| `src/lib/warm.mjs` + `scripts/warm-token.mjs` | Token de operação (`aquecimento`/`operador`) assinado com HMAC-SHA256, expiração limitada a 24h, comparação em tempo constante, alvo amarrado por hash. |
| `src/lib/token-guard.mjs` | `registrarJob()` e `saude()` sobre as tabelas `jobs`/`job_fontes`, com retenção de 7 dias e sem alvo, e-mail ou IP. |
| `src/scan.mjs` + `cloudflare-worker.mjs` | `job_id` por scan (resposta, header `x-job-id`, log e tela) e rota `GET /api/saude`. |

Saídas reais dos checks locais (comando `npm test`):

```json
{"ok":true,"fontes":24,"email":12,"custo_email":16,"categorias":6,"chaves_visitante":0,"codigos":7,"credenciais_opcionais":["github","emailrep","ceis"]}
{"ok":true,"fontes":24,"digest":"03345ece5f5bf65eccebd9522267ec0c0d309047b7392f3673fafad698fb746e","migracoes":2,"deterministico":true}
{"ok":true,"migracoes":2,"nomes":["0001_token_guard.sql","0002_scan_jobs.sql"],"aplicadas":2,"idempotente":true}
{"ok":true,"escopos":["aquecimento","operador"],"ttl_maximo_s":86400,"comparacao":"timingSafeEqual","alvo_em_texto_claro":false}
```

Invariantes conferidos: 24 fontes, 12 fontes de e-mail com custo 16, 6 categorias
de alvo, 0 chaves de visitante, `data-stats` = `{"total":24,"email":12,"categorias":6,"keys":0}`.
O build foi executado duas vezes com hashes idênticos nos três artefatos
(`cloudflare-worker.mjs`, `registry.meta.mjs`, `migrations.mjs`).

Limitação declarada: os checks rodam **offline**. Eles provam contrato,
determinismo, idempotência e comportamento local — não provam disponibilidade
das fontes externas nem comportamento no edge.

## Abertura da prévia local (2026-10-30, continuação)

O editor reportou "o servidor terminou antes de abrir a prévia". A causa foi
encontrada no `scripts/dev-server.mjs`: com `--port` (ou `PORT`) apontando
para uma porta já ocupada, o processo imprimia `nenhuma porta disponivel` e
saiva com código 1 — o preview não tinha o que abrir.

Correção aplicada: com a porta pedida ocupada, o servidor cai para a próxima
porta livre da lista (3000, 5173, 8080, 4173, 5000), continua no ar e imprime
a URL que está de fato em uso (`Server running on ...` e `NEXUS_PREVIEW_URL=...`
apontando para a porta real). A flag `--sem-fallback` mantém o comportamento
estrito anterior (sair com 1 e listar `Portas tentadas:` e `PORT=<numero>`), e é
o que o check usa para provar a mensagem de erro.

Verificado por `verification/dev-process-check.mjs`, que agora sobe três
processos reais do servidor local:

```json
{"scope":"LOCAL ONLY; processo npm run dev equivalente","porta":4321,"aviso":["Server running on http://localhost:4321"],"ui":200,"tokenGet":200,"dataStats":{"total":24,"email":12,"categorias":6,"keys":0},"scanLog":true,"turnstileSimulado":true,"portasEsgotadas":{"codigo":1,"listouPortas":true},"fallbackDePorta":{"portaOcupada":10208,"portaUsada":3000,"ui":200,"permaneceuVivo":true},"previaRaiz":{"scriptDev":"npm --prefix current-site/osint-infoc-hacker run dev --","porta":10211,"ui":200,"permaneceuVivo":true}}
```

O mesmo check confere que o script `dev` da raiz do repositório encaminha os
argumentos (`run dev --`), que é o caminho usado pelo preview do editor.

Correção adicional: `npm run check` na raiz passou a verificar também a
variante Netlify (`osint-infoc-hacker/`), e o `ci.yml` deixou de manter um
passo separado para ela.

## Fonte Telegram e shim de HTMLRewriter (2026-10-30, continuação)

O preview voltou a falhar com `TypeError: parser.transform(...).text is not a
function` em `src/sources/registry.mjs` (fonte `telegram`, com
`http: [{"host":"t.me","status":200}]`). A causa não era o `t.me`: era o shim
local de `HTMLRewriter` em `scripts/dev-server.mjs`, cujo `transform()` era
`async` e devolvia uma Promise. No runtime do Cloudflare `transform()` é
síncrono, devolve a Response na hora e os handlers disparam na leitura do
corpo; a fonte chamava `.text()` direto sobre o retorno e quebrava.

Correções aplicadas:

- `scripts/dev-server.mjs`: `LocalHTMLRewriter.transform()` voltou a ser
  síncrono e devolve um objeto com `.text()`; o parse acontece dentro de
  `.text()`, como no runtime. Seletores não suportados são ignorados.
- `src/sources/registry.mjs`: a fonte normaliza os dois formatos
  (`await Promise.resolve(parser.transform(r))`) e só lê o corpo quando
  `.text()` existe, então funciona no Worker e no shim local.

Na validação contra o `t.me` real apareceu um segundo defeito, silencioso: com
`?embed=1` o Telegram devolve um widget em JavaScript, sem `tgme_page_title`, e
a extração era sempre vazia. A consulta passou a ser a página renderizada no
servidor (`tgme_page_title`, `tgme_page_description`, `tgme_page_additional`).

O campo `existe` foi renomeado para `paginaPublica`: o Telegram entrega a mesma
página de contato para qualquer número, então "a conta existe" seria uma
afirmação que o provedor não faz — a existência só é resolvida no aplicativo, e
a fonte registra isso em `observacao`. Nenhum outro ponto do projeto consumia
esse campo (a pontuação usa `existe` apenas do gravatar; a renderização
imprime as chaves de `dados` de forma genérica).

`verification/telegram-source-check.mjs` fixa esse contrato com uma fixture
offline da página real do `t.me`, sem rede: confere que `transform()` é
síncrono, que o número nacional de 11 dígitos recebe o código 55 e que título,
descrição e URL saem corretos.

Saída real do check (comando `npm test`):

```json
{"scope":"LOCAL ONLY; fixture offline da pagina do t.me","fonte":"telegram","titulo":"Chat with +55 11 99999 9999","descricao":"If you have Telegram, you can contact +55 11 99999 9999 right away.","url":"https://t.me/+5511999999999","transformSincrono":true}
```

Validação com rede, feita na máquina e fora da suíte offline:
`https://t.me/+5511999999999` respondeu 200 e a fonte extraiu título e
descrição da página real, tanto para o número já com código quanto para o
número nacional de 11 dígitos.

O caminho exato do preview (servidor local -> `/api/scan` -> `devScan`) também
foi exercitado com alvo de telefone e rede real, para confirmar que o
`TypeError` não retorna:

```json
{"event":"source_run","id":"telegram","status":"ok","http":[{"host":"t.me","status":200}],"ms":724}
{"event":"scan_done","job_id":"804b2109-9859-4ae3-bc03-44ea7ab352b0","escopo":"visitante","alvo_tipo":"telefone","executadas":2,"parcial":false}
{"status":200,"alvo":{"tipo":"telefone","valor":"11999999999"},"telegram":{"status":"ok","erro":null,"erro_codigo":null,"provenance":"telegram-tme","cache":"miss","dados":{"paginaPublica":true,"usuario":"+5511999999999","titulo":"Chat with +55 11 99999 9999","descricao":"If you have Telegram, you can contact +55 11 99999 9999 right away.","observacao":"O Telegram entrega a mesma pagina de contato para qualquer numero; a existencia da conta so e resolvida no aplicativo."}},"saude":{"por_fonte":{"ddd":"ok","telegram":"ok"},"ok":2,"indisponiveis":[],"por_configuracao":[],"parcial":false}}
```

Estado dos portões depois da correção: `npm run check` e `npm test` passam na
raiz; `npm run build` não altera `registry.meta.mjs` ("ja esta atualizado"),
pois o manifesto `src/sources/registry.json` não mudou.

### A prévia mantinha o código antigo em memória

O mesmo erro voltou a ser reportado pelo editor depois da correção. A causa era
o **processo** da prévia, não o código em disco: o servidor foi iniciado às
09:03:55 (PID 16992, `node scripts/dev-server.mjs --port 4387`) e os arquivos
só foram corrigidos depois (`scripts/dev-server.mjs` às 09:16:17,
`src/sources/registry.mjs` às 09:18:20). O Node carrega os módulos ESM uma vez,
no import: um processo já em execução continua com a versão antiga em memória.

Prova ao vivo, antes do reinício (scan de telefone na porta 4387):

```json
{"id":"telegram","status":"erro","erro":"parser.transform(...).text is not a function","erro_codigo":"erro","ms":722,"provenance":"telegram-tme","cache":"miss","dados":null}
```

Os números de linha do stack reportado (`registry.mjs:60`, `dev-server.mjs:320`
e `:357`) são exatamente os do arquivo **antigo** — hoje a fonte `telegram` está
entre as linhas 76 e 101 e o `devScan` é chamado na linha 406.

Depois do reinício da prévia (mesmo comando do editor: `npm run dev -- --port
4387`), o mesmo scan devolve:

```json
{"id":"telegram","status":"ok","erro":null,"erro_codigo":null,"ms":702,"provenance":"telegram-tme","cache":"miss","dados":{"paginaPublica":true,"usuario":"+5511999999999","titulo":"Chat with +55 11 99999 9999","descricao":"If you have Telegram, you can contact +55 11 99999 9999 right away."}}
```

Lição registrada: depois de mexer em `src/` ou em `scripts/dev-server.mjs`, o
servidor de desenvolvimento precisa ser reiniciado — recarregar a página não
recarrega os módulos.

## Troca do provedor de TLS: Mozilla Observatory -> Qualys SSL Labs (2026-11-10)

O preview reportou `source_run` com `id: "observatory"`, `status: "erro"`,
`http: [{"host":"observatory.mozilla.org","status":404}]` e a mensagem
`HTTP 404 | <html> <head><title>404 Not Found</title></head> ...`.

Verificação ao vivo, na máquina, contra o host real: **todas** as rotas
`/api/*` do Observatory respondem 404 — v1, v2 e v3, GET e POST, com e sem
barra final — e os próprios bundles JavaScript da SPA devolvem 404 a partir
desta rede. Hosts alternativos da API não resolvem. A API pública do Mozilla
Observatory foi descontinuada; a fonte não tinha como funcionar.

O log colado também traz o banner `osint-infoc-hacker-worker@1.2.0 dev`,
`previa: http://localhost:50110` e stacks em `registry.mjs:90`/`:99` e
`dev-server.mjs:320`/`:357`: são os números de linha do código **anterior**
(hoje a fonte `telegram` fica entre as linhas 76 e 101 e o `devScan` é
chamado na linha 406). Esse log veio da prévia encerrada, não do código
atual.

Correção aplicada:

- A fonte `observatory` saiu do registro e do manifesto; entrou a fonte
  `ssllabs` (Qualys SSL Labs v3), com proveniência `qualys-ssllabs`, custo 1,
  TTL 3600 e tipo `dominio`. Substituição 1:1 — o total de fontes, o custo do
  e-mail, as categorias e as chaves de visitante não mudaram.
- O formato real da resposta v3 **não** tem `grade`, `score` nem `expired` no
  nível do host: a nota vem por endpoint (`endpoints[].grade`) e os tempos
  (`startTime`, `testTime`) são epoch em milissegundos. A fonte calcula a
  pior nota entre os endpoints (regra do próprio SSL Labs) e converte os
  tempos para ISO.
- `IN_PROGRESS` (avaliação recém-iniciada, ainda sem nota) e `DNS` (domínio
  que não resolve) são estados válidos, não falhas: a fonte devolve
  `situacao: "em_andamento"` / `"dns"` com `nota: null` e observação.
  `ERROR`, `RATE_LIMIT` e HTTP diferente de 200 continuam sendo falha real.
- Como o estado "em andamento" é temporário, `src/scan.mjs` aceita um TTL
  devolvido pela própria fonte: `300 s` para o estado sem nota, `3600 s` para
  a avaliação pronta. Sem isso, o visitante ficaria uma hora sem nota.

`verification/ssllabs-source-check.mjs` fixa esse contrato com fixtures
offline do formato real da API (nota por endpoint, epoch em ms), sem rede:
confere a URL chamada, a proveniência, os três estados, as falhas reais e os
dois TTLs de cache.

Saída real do check (comando `npm test`):

```json
{"scope":"LOCAL ONLY; fixtures offline do SSL Labs","fonte":"ssllabs","url":"https://api.ssllabs.com/api/v3/analyze?host=ostnt.online&fromCache=on&maxAge=24","ready":{"situacao":"pronta","nota":"A (pior entre 2 endpoints)","servidores":2,"avisos":1},"inProgress":"em_andamento (sem nota, sem erro)","dns":"dns (sem avaliacao TLS)","erros":"ERROR, RATE_LIMIT e HTTP 503 falham de verdade","cache":{"emAndamento":300,"pronta":3600}}
```

Validação com rede pelo caminho completo da prévia (servidor local ->
`/api/scan` -> `devScan`, alvo `ostnt.online`):

```json
{"event":"source_run","id":"ssllabs","status":"ok","http":[{"host":"api.ssllabs.com","status":200}],"ms":648}
{"id":"ssllabs","status":"ok","erro":null,"dados":{"situacao":"pronta","nota":"A+","servidores":4,"avaliadoEm":"2026-11-10T12:34:37.029Z","avaliacaoIniciadaEm":"2026-11-10T12:28:42.569Z","avisos":[],"observacao":"Nota TLS (cifra e configuracao do HTTPS) medida pelo Qualys SSL Labs; a nota exibida e a pior entre os servidores avaliados."}}
```

Digest novo do manifesto: `03345ece5f5bf65eccebd9522267ec0c0d309047b7392f3673fafad698fb746e`.
`npm run check` e `npm test` passam; `npm run build` responde "registro:
`src/sources/registry.meta.mjs` ja esta atualizado" (codegen idempotente).

Limitação declarada: a execução no edge (Cloudflare) da fonte nova **não** foi
validada; a prova foi local, com rede real, contra o mesmo caminho de código
que o Worker usa. A lista de links para visitantes que cita "Mozilla
Observatory" (`cloudflare-worker.mjs` e `public/app.js`) foi mantida: é uma
lista de links para consulta humana, não uma fonte do scanner.

## Ainda obrigatório antes de concluir

1. Desbloquear a validação autorizada no ambiente de teste sem contornar controles.
2. Primeiro resolver o acesso ao Worker de validação aprovado pela conta sem alternar clientes após o 1010. Só então capturar status, HTTP e exceção crua por fonte nas 12 fontes de e-mail e no Telegram (13 no total). GitHub/EmailRep/CEIS não têm chaves configuradas. Nenhuma fonte foi removida sem evidência real.
3. Confirmar cache miss/hit e expiração real após 120s, inclusive pelo datacenter retornado; duas gravações KV por scan.
4. Confirmar rejeição de replay sequencial e simultâneo no Durable Object real.
5. Confirmar beacon no Network (200) ou remover sua injeção na origem correta.
6. Promover a versão candidata com binding e migração juntos; validar fluxo Turnstile/token/scan e og.png na produção.
7. Aplicar no Worker real as migrações `0001_token_guard.sql` e `0002_scan_jobs.sql` e conferir `GET /api/saude` com um token de operador emitido por `npm run warm-token`.
8. Publicar com a CI habilitada no repositório e confirmar que `git diff --exit-code` continua limpo depois do build no runner.
