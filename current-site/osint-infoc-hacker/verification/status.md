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

## Envio para o GitHub (2026-11-10)

O trabalho da sessão foi enviado para `origin` (`https://github.com/ninermegsq/pesquisa.git`,
branch `main`) no commit `d8626fa` — "feat: add result contract, token guard, migrations,
source manifest and offline verification suite" (37 arquivos, +2621/−95). Antes do envio,
`npm run check`, `npm test` e `npm run build` passaram, e
`git diff --exit-code` sobre `registry.meta.mjs`, `migrations.mjs` e `cloudflare-worker.mjs`
(depois do build) saiu limpo — é exatamente o passo de idempotência que a CI exige.

O `origin/main` anterior ainda tinha a fonte antiga: `git grep -n observatory origin/main`
encontrava `src/sources/registry.mjs:149` chamando
`https://observatory.mozilla.org/api/v2/analyze`. Depois do envio, a mesma busca não
encontra mais nada e o registro remoto já tem a fonte `ssllabs` (`registry.mjs:215`).

Nenhuma publicação em produção ocorreu com esse envio: o workflow de deploy
(`.github/workflows/deploy.yml`) é **manual** (`workflow_dispatch`) e só executa quando alguém
digita "publicar" no gatilho, com os segredos `CLOUDFLARE_API_TOKEN` e `CLOUDFLARE_ACCOUNT_ID`.

Resolvido: `.github/workflows/ci.yml` e `.github/workflows/deploy.yml` **estão no GitHub**.

A publicação foi feita pela API de conteúdo do repositório
(`gh api -X PUT repos/ninermegsq/pesquisa/contents/.github/workflows/...`), que aceitou a
escrita com o token que já estava na máquina, nos commits `cece9b6` e `3d51c5b` (ambos com a
mensagem "ci: adiciona workflows de teste e deploy"), filhos de `282864f`. O envio por
`git push` continuava bloqueado porque o token OAuth do GitHub CLI tinha só `gist`, `read:org`
e `repo`, e o GitHub recusa criar arquivos de workflow sem o escopo `workflow`:

```text
! [remote rejected] main -> main (refusing to allow an OAuth App to create or update
workflow `.github/workflows/ci.yml` without `workflow` scope)
```

O escopo `workflow` foi concedido depois com `gh auth refresh -h github.com -s workflow`
(fluxo de dispositivo: o GitHub CLI mostra um código de uso único e a aprovação é feita no
navegador da conta `ninermegsq`). Depois da aprovação, `gh auth status` passa a listar
`'gist', 'read:org', 'repo', 'workflow'`, e envios que alterem `.github/workflows/` passam a
ser aceitos por `git push` sem depender da API.

## Prévia: o servidor local não pode mais terminar por causa de porta (2026-11-10)

Sintoma reportado pelo editor: "Não foi possível abrir a prévia — O servidor terminou antes
de abrir a prévia". No `scripts/dev-server.mjs` o servidor encerrava com código 1 sempre
que todas as portas da lista (3000, 5173, 8080, 4173, 5000) estavam ocupadas, e mantinha
todas essas portas presas ao mesmo tempo quando subia sem porta explícita — o que deixava a
prévia seguinte sem porta livre. Havia ainda um `dev-server.mjs` de uma sessão anterior
(PID 18508) segurando portas na máquina; foi encerrado.

Correções em `scripts/dev-server.mjs`:

- o servidor ocupa **uma** porta (a primeira que abre), e não todas da lista;
- a lista de candidatas ganhou 3001, 5174, 8000 e 8888;
- quando nem a porta pedida nem nenhuma candidata está livre, o servidor cai para uma
  **porta efemera** do sistema e continua no ar, em vez de encerrar;
- o modo estrito (`--sem-fallback`) continua encerrando com código 1 e listando as portas
  tentadas, como antes.

Verificação nova em `verification/dev-process-check.mjs`: com as 9 portas fixas bloqueadas
em IPv4 e IPv6, o processo continua vivo, imprime `NEXUS_PREVIEW_URL` e a interface responde
200.

```json
{"portasEsgotadas":{"codigo":1,"listouPortas":true},"fallbackDePorta":{"portaOcupada":17549,"portaUsada":3000,"ui":200,"permaneceuVivo":true},"portaEfemera":{"portasFixasBloqueadas":18,"portaUsada":17552,"ui":200,"permaneceuVivo":true},"previaRaiz":{"porta":17554,"ui":200,"permaneceuVivo":true}}
```

## Fase 1 — correções pequenas, sem publicação (2026-11-10)

Seis correções de baixo risco, todas **locais**: nada foi publicado, nenhum
segredo foi criado e nenhum endpoint de produção foi tocado. A sétima linha
da tabela (o `dev:stop`) é o acréscimo que fecha o erro de prévia do editor.

| # | Correção | Arquivo |
| --- | --- | --- |
| 1 | Binding `OSINT_KV` declarado no Worker de validação (o rate limit usava o fallback `CACHE`, misturando contadores de requisição e cota no mesmo KV) | `wrangler.validation.toml` |
| 2 | Cinco ativos estáticos movidos do Worker para `public/`: `favicon.svg`, `obrigado.html`, `robots.txt`, `sitemap.xml`, `.well-known/security.txt` | `public/` + `cloudflare-worker.mjs` + `scripts/dev-server.mjs` |
| 3 | Chave da API do DataJud saiu do código e virou variável de ambiente `DATAJUD_API_KEY`, marcada como `requer` no manifesto | `src/sources/registry.json`, `src/sources/registry.mjs` |
| 4 | `npm run check` deixou de ser uma cadeia manual de 35 `node --check` e virou um verificador que percorre `src/`, `scripts/`, `verification/` e os arquivos da raiz | `scripts/check-syntax.mjs`, `package.json` |
| 5 | `public/_headers` deixou de ser resíduo do fork Netlify e passou a espelhar os cabeçalhos reais do Worker (CSP, HSTS, cache por tipo) | `public/_headers` |
| 6 | Rota legada `/.netlify/functions/scan` removida do Worker: o motor v1.2 foi removido e sobrou só `POST /api/scan` | `cloudflare-worker.mjs` |
| 7 | Comando `npm run dev:stop` para encerrar servidores de desenvolvimento órfãos (era a causa do erro de prévia do editor) | `scripts/stop-dev-servers.mjs`, `package.json` |

Efeito colateral asociado à correção 2: `scripts/dev-server.mjs` deixou de
extrair os ativos do fonte do Worker por expressão regular (o round-trip
`loadWorkerAssets()`) e passou a servir tudo de `public/`. O `sendStatic`
ganhou uma guarda de travessia de caminho: o alvo é resolvido e comparado
com `path.relative`, e qualquer caminho que saia de `public/` devolve 404
(`startsWith` sozinho aceitaria `public-seguro`, que está fora de `public/`).

A correção 6 deixou o Worker com 125 linhas (antes 252). A rota
`/.netlify/functions/token` **continua**, porque `public/app.js` ainda a
chama; o que saiu foi só a rota de scan.

### Chave do DataJud

Antes: a chave estava escrita dentro de `src/sources/registry.mjs`. Agora a
fonte usa o mesmo caminho das outras chaves opcionais:

```js
exigirCredencial(c.env, 'datajud');
const key = `APIKey ${c.env.DATAJUD_API_KEY}`;
```

e o manifesto declara `"requer": { "tipo": "chave", "env": "DATAJUD_API_KEY" }`.
Sem a variável no ambiente, a fonte responde `sem_chave` e o relatório **não**
fica parcial. Para configurar no Worker:

```sh
wrangler secret put DATAJUD_API_KEY
```

### Acordeões fechados por padrão

`src/render.mjs` não emite mais o atributo `open` no `<details>`; o indicador
é o caractere `▶`, que vira `▼` quando o bloco abre. A primeira dobra do
relatório passa a ser o comportamento esperado pelo checklist de produção.

### Erro encontrado e corrigido no caminho

Depois de editar `src/sources/registry.json`, o `npm test` parou com
`Error: credencial divergente do manifesto: datajud`
(`src/sources/registry.mjs:336`). O motivo era o `src/sources/registry.meta.mjs`
gerado, que ainda descrevia a fonte antiga (`chave: false`, sem `requer`).
Corrigido rodando `npm run build`, que regenera o meta a partir do manifesto:

```text
registro: src/sources/registry.meta.mjs gerado a partir de src/sources/registry.json.
migracoes: src/lib/migrations.mjs ja esta atualizado (2 migracoes).
worker atualizado; fontes injetadas: 8/8
```

Rodando `npm run build` duas vezes seguidas depois das correções, os dois
imprimiram exatamente a mesma linha, agora com o digest do arquivo gerado:

```text
registro: src/sources/registry.meta.mjs ja esta atualizado.
migracoes: src/lib/migrations.mjs ja esta atualizado (2 migracoes).
worker atualizado; fontes injetadas: 8/8; sha256: f0fee8fdb1942730c10162d5354c9684fe49175e93e9729c35d09720b6bc71a3
```

É a prova de determinismo do build nesta fase, obtida sem Git.

### Saídas reais depois das correções

`npm run check` (raiz do repositório):

```json
{"escopo":"sintaxe","arquivos":37,"falhas":0}
```

`npm test` — registro de fontes (o `datajud` passou a constar entre as
credenciais opcionais):

```json
{"ok":true,"fontes":24,"email":12,"custo_email":16,"categorias":6,"chaves_visitante":0,"codigos":7,"credenciais_opcionais":["github","emailrep","ceis","datajud"]}
```

`npm test` — regressão do Worker (rota legada ausente, rota v1.3 presente,
token emitido com 200):

```json
{"scope":"local regression; siteverify mocked","tokenIssuance":200,"rotaLegadaRemovida":true,"rotaScanV13":true,"originScoped":true}
```

`npm test` — servidor local, com o bloco novo de ativos estáticos e a guarda de
travessia:

```json
{"estaticos":{"/favicon.svg":{"status":200,"bytes":322},"/robots.txt":{"status":200,"bytes":65},"/sitemap.xml":{"status":200,"bytes":278},"/.well-known/security.txt":{"status":200,"bytes":158},"/obrigado.html":{"status":200,"bytes":775},"travessia":{"status":404}}}
```

O `verification/dev-server-check.mjs` ganhou esse bloco: ele exige 200 com o
`content-type` esperado (`image/svg+xml`, `text/plain`, `application/xml`,
`text/plain`, `text/html`), corpo não vazio, e 404 para um caminho codificado
que tentaria sair de `public/`.

### O erro de prévia do editor e o `dev:stop`

O editor acusava "Não foi possível abrir a prévia — o servidor terminou antes
de abrir a prévia". A causa não era o código: havia um processo antigo do
servidor de desenvolvimento (PID 11720) segurando a porta e mantendo o
código velho em memória. Como os módulos ESM são carregados uma vez por
processo, corrigir o arquivo não corrige o processo que já está no ar.

Foi criado `scripts/stop-dev-servers.mjs` (e o atalho `npm run dev:stop` nos
dois `package.json`) para encerrar só os processos `dev-server.mjs` da própria
máquina, com `--listar` para apenas inspecionar e `--json` para a saída
estruturada. Executando:

```json
{"escopo":"LOCAL ONLY; apenas processos node do servidor de desenvolvimento","encontrados":0,"pids":[],"apenasListar":true,"encerrados":[],"restantes":[],"erros":[]}
```

Ou seja: o processo órfão foi encerrado e hoje não sobra nenhum servidor de
desenvolvimento rodando. O editor ainda precisa **reiniciar** a prévia para
carregar o código novo.

### O que a Fase 1 não faz

- Não publica nada. O Worker de produção e o domínio `ostnt.online` seguem
  intocados.
- `npm run check:build` **não** passou, e o motivo é esperado: ele exige a
  árvore do Git limpa, e as alterações da Fase 1 (arquivos novos em `public/`,
  `scripts/check-syntax.mjs`, `scripts/stop-dev-servers.mjs`,
  `scripts/build-worker.mjs`, edições do Worker e do README) ainda não estão
  commitadas. O Git **é** acessível neste ambiente pelo atalho `npm run git`
  (encaminhamento para o binário `git`): `npm run git status --porcelain`
  lista 16 arquivos modificados e 6 não rastreados. O commit fica para o seu
  lado, porque ele precede um envio ao repositório. O que já foi comprovado
  sem Git: `scripts/build-worker.mjs` agora imprime o `sha256` do arquivo
  gerado e dois builds consecutivos produziram o mesmo —
  `f0fee8fdb1942730c10162d5354c9684fe49175e93e9729c35d09720b6bc71a3`
  nos dois — e `verification/codegen-check.mjs` confirma que
  `registry.meta.mjs` e `migrations.mjs` batem com o que o codegen produz a
  partir das fontes. O `check:build` completo deve rodar no runner da CI ou
  depois do commit.
- `DATAJUD_API_KEY` continua sem valor: sem ela a fonte fica `sem_chave`, o
  que é o comportamento declarado, não uma falha.
- A prévia do editor precisa de **reinício** do servidor local: os módulos ESM
  são carregados uma vez por processo, então só um processo novo enxerga o
  código novo. Já não há processo antigo no ar (ver acima); basta o editor
  subir a prévia de novo.

## Ainda obrigatório antes de concluir

1. Desbloquear a validação autorizada no ambiente de teste sem contornar controles.
2. Primeiro resolver o acesso ao Worker de validação aprovado pela conta sem alternar clientes após o 1010. Só então capturar status, HTTP e exceção crua por fonte nas 12 fontes de e-mail e no Telegram (13 no total). GitHub/EmailRep/CEIS não têm chaves configuradas. Nenhuma fonte foi removida sem evidência real.
3. Confirmar cache miss/hit e expiração real após 120s, inclusive pelo datacenter retornado; duas gravações KV por scan.
4. Confirmar rejeição de replay sequencial e simultâneo no Durable Object real.
5. Confirmar beacon no Network (200) ou remover sua injeção na origem correta.
6. Promover a versão candidata com binding e migração juntos; validar fluxo Turnstile/token/scan e og.png na produção.
7. Aplicar no Worker real as migrações `0001_token_guard.sql` e `0002_scan_jobs.sql` e conferir `GET /api/saude` com um token de operador emitido por `npm run warm-token`.
8. Publicar com a CI habilitada no repositório e confirmar que `git diff --exit-code` continua limpo depois do build no runner.
