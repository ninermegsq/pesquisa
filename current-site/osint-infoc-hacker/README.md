# OSINT // infoc.hacker

![deploy na Cloudflare](https://img.shields.io/badge/deploy-Cloudflare%20Workers-f38020?style=flat-square)

**Autor:** [@infoc.hacker no Instagram](https://instagram.com/infoc.hacker) · **Apoie:** [MANTER O SITE NO AR — Cakto](https://pay.cakto.com.br/o9xx8id_1257625)

Scanner OSINT de exposição de e-mails. A interface usa **HTML/CSS/JavaScript nativos** e a publicação de produção usa **Cloudflare Workers**; as funções Netlify permanecem como alternativa. Sem framework ou SDK de terceiros no navegador (exceto Cloudflare Turnstile).

## Versão 1.2 — Morph Orb

- A busca segue o modelo anexado: o campo se desloca e se transforma em esfera durante a consulta; no fim, a esfera abre um cartão com o resumo.
- A animação acompanha as etapas reais do scanner, respeita a preferência por movimento reduzido e mantém o relatório detalhado abaixo da área principal.
- As consultas, o Turnstile, o rate limit e o cache continuam no backend. O site publicado usa `cloudflare-worker.mjs`, com os mesmos endpoints de scan.
- O pacote mantém as Netlify Functions para hospedagem alternativa. Elas não devem ser publicadas diretamente no Cloudflare sem a adaptação do Worker.

### Publicação atual

O domínio `ostnt.online` é servido pelo Cloudflare Worker `ostnt-migration`. Para atualizar a produção, publique `cloudflare-worker.mjs` no Worker existente, preservando os bindings e segredos já configurados. O ZIP contém o projeto editável e esse Worker. O repositório GitHub não publica automaticamente no Cloudflare.

Para hospedar pela Netlify, use `public/` e `netlify/functions/` e configure as variáveis listadas abaixo na conta Netlify correspondente. Essa é uma rota de hospedagem alternativa, não a publicação atual do domínio.

## Mapa de conexões e relatório em PDF

A visão principal do resultado é um **mapa-mundi em SVG puro**
(`public/mapa.js`, sem framework e sem bundler). Cada fonte consultada vira um
nó: ligado por um arco até o país do visitante (de `request.cf.country`),
com a resposta no tooltip e o clique abrindo o detalhe da fonte
(`data-fonte` no acordeão). Fonte que respondeu fica em brasa `#e6a274`;
fonte que **falhou** fica em vermelho `#f87171` com halo pulsando. A paleta é
a do site (fundo `#050505`, creme `#e7e6d9`, brasa, vermelho) — o mapa não
divergi do resto da interface. Os detalhes por fonte continuam acessíveis,
recolhidos em um único acordeão "DETALHES DAS FONTES".

O relatório em PDF (`public/relatorio.js`) é montado à mão (sem biblioteca de
PDF no projeto) e usa a mesma paleta. `verification/mapa-pdf-check.mjs`
confere os dois offline, carregando os scripts em um sandbox `node:vm`.

**As linhas saem separadas, não empilhadas.** Cada arco nasce num ponto
diferente do anel de despacho ao redor da origem; fontes que saem quase na
mesma direção formam um leque, e dentro do leque cada linha ganha uma faixa
lateral própria (deslocada perpendicularmente ao cordão), com uma passada
final que afasta qualquer curva ainda encostada na vizinha. O check fixa esse
comportamento: nenhuma célula de 4×4 px pode ter mais de 4 arcos e nenhuma
dupla de linhas anda colada. O `public/mapa.js` do pacote Netlify
(`../../osint-infoc-hacker/public/mapa.js`) é gerado a partir deste arquivo com
`npm run mapa:sync`; o check falha se as duas cópias divergirem.

O Worker serve `/mapa.js` e `/relatorio.js` como estáticos e o `index.html`
carrega os dois com `defer`.

## Arquivos

```text
/
├─ public/
│  ├─ index.html
│  ├─ app.js
│  ├─ mapa.js
│  ├─ relatorio.js
│  ├─ obrigado.html
│  ├─ favicon.svg
│  ├─ og.png
│  ├─ robots.txt
│  ├─ sitemap.xml
│  ├─ .well-known/security.txt
│  └─ _headers
├─ netlify/functions/
│  ├─ token.js
│  └─ scan.js
├─ netlify.toml
├─ package.json
├─ .gitignore
└─ README.md
```

O `public/` é a **única** fonte dos ativos estáticos: o Worker e o servidor
local servem `favicon.svg`, `robots.txt`, `sitemap.xml`,
`.well-known/security.txt` e `obrigado.html` a partir daí. Nenhuma cópia
desses arquivos fica embutida em `cloudflare-worker.mjs`.

## Variáveis de ambiente

| Variável | Obrigatória | Finalidade |
| --- | --- | --- |
| `HMAC_SECRET` | Sim | Segredo HMAC-SHA256, aleatório e forte, usado para assinar tokens de scan. |
| `TURNSTILE_SECRET` | Sim | Chave **secreta** do Cloudflare Turnstile, verificada no servidor. |
| `TURNSTILE_SITE_KEY` | Sim | Chave **pública** do widget do Turnstile. Obtida por GET na Function `/token`; **não** é segredo. |
| `ALLOWED_ORIGINS` | Sim | Origens HTTP(S) exatas, separadas por vírgula. Ex.: `https://site.netlify.app,https://seudominio.com`. |
| `EMAILREP_KEY` | Não | API key opcional da EmailRep. Sem ela a checagem EmailRep aparece como indisponível. |
| `GITHUB_TOKEN` | Não | Token opcional de leitura da API GitHub; configure com `wrangler secret put GITHUB_TOKEN`. Sem ele, GitHub aparece indisponível. A resposta é cacheada por e-mail durante 24 horas. |
| `DATAJUD_API_KEY` | Não | Chave opcional da API pública do DataJud/CNJ (fonte `datajud`, categoria nome). Sem ela a fonte responde `sem_chave` e o relatório **não** fica parcial. Configure com `wrangler secret put DATAJUD_API_KEY`; **nenhuma chave fica no código**. |
| `TRANSPARENCIA_KEY` | Não | Chave opcional da API do Portal da Transparência (sanções/CEIS). Sem ela a fonte CEIS responde `sem_chave` e o relatório **não** fica parcial. |
| `NUMVERIFY_API_KEY` | Não | Chave opcional da API Numverify/APILayer (fonte `numverify`, número de celular: validade, operadora, país, tipo de linha). **Sem ela a fonte não roda** e responde `sem_chave` — o relatório **não** fica parcial. A chave é emitida no painel da APILayer (`app.apilayer.com/signup/numverify/free`, produto *Number Verification API*): chave de outro produto é recusada com 401. A fonte usa primeiro a rota atual (`api.apilayer.com/number_verification/validate`, cabeçalho `apikey`) e, se o provedor recusar a credencial, tenta a rota antiga (`apilayer.net/api/validate`). Configure com `wrangler secret put NUMVERIFY_API_KEY`; **nenhuma chave fica no código**. |
| `NUMVERIFY_API_ROTA` | Não | Rota fixa da APILayer para a fonte `numverify`: `auto` (padrão — marketplace e, se recusarem a chave, a antiga), `marketplace` ou `legado`. Serve para não depender do degrau automático quando o provedor muda de rota. |
| `WARM_SECRET` | Não | Segredo do token de operação (aquecimento e painel de saúde). Tem precedência sobre `HMAC_SECRET`. Sem ele, `/api/saude` e o aquecimento respondem "não autorizado". |
| `SUPABASE_URL` | Sim (painel) | Endereço do banco do painel. Sem ele o painel responde "banco não configurado". |
| `SUPABASE_PUBLISHABLE_KEY` | Sim (painel) | Chave **publicável** do Supabase (`sb_publishable_...`). A proteção está nas policies RLS e nas funções `SECURITY DEFINER`; a chave de serviço **nunca** vai para o navegador nem para o Worker. |
| `CREDENCIAIS_MASTER_KEY` | Sim (painel) | Segredo que cifra as credenciais gravadas no painel (AES-256-GCM). É **segredo do Worker** (`wrangler secret put`), nunca var do `wrangler.toml`. Sem ele o painel sobe, mas nenhuma credencial pode ser gravada e o funil de visitas não registra nada. Ver `npm run mestre`. |
| `PROXY_GATEWAY_URL` | Não | Endereço do gateway de proxy rotativo. Sem ele o painel mostra `gateway_proxy: false` e as fontes marcadas como `usa_proxy` consultam direto. |
| `AWS_LAMBDA_JS_RUNTIME` | Conforme plano/ambiente | Caso necessário na Netlify, valor `nodejs20.x` para selecionar explicitamente runtime das Functions. |

**Nenhum segredo aparece no HTML.** A site key do Turnstile foi criada para divulgação pública; é impossível validar o Turnstile usando apenas o segredo no servidor sem configurar um widget no cliente.

## Painel admin (`/admin`)

O painel do operador fica em `https://ostnt.online/admin` (interface em
`public/admin.html` + `public/admin.js`) e a API em `/api/admin/*`
(`src/admin/`). Ele cobre os quatro requisitos do operador:

| Recurso | O que resolve |
| --- | --- |
| **Credenciais** | Gravar a chave de API de cada fonte, cifrada com AES-256-GCM. Precedência: **banco → variável de ambiente → `sem_chave`** — o que está no painel vence o que está no Worker. |
| **Fontes** | Ajustar por fonte: título, tipos, custo, TTL, proveniência, limite por minuto/dia, se usa proxy e o texto de **explicação de cada código de falha**. |
| **Proxies** | Lista de proxies e o gateway rotativo para as APIs limitadas por IP. |
| **Funil de visitas** | Contagem por etapa (`visita`, `scan`, `scan_concluido`, `falha`, `exportacao`), série por dia e a lista de falhas com a explicação de cada código. |

### A chave mestra

`CREDENCIAIS_MASTER_KEY` é o segredo que cifra as credenciais gravadas no
painel. Ele vive em **dois** lugares, e em nenhum deles no repositório:

1. como **segredo do Worker** (`wrangler secret put CREDENCIAIS_MASTER_KEY`),
   para que o código de produção decifre e use as chaves durante um scan;
2. como **arquivo local ignorado pelo git** (`.local/mestre.key`), para que o
   operador não perca o valor.

O banco **não** guarda a chave: guarda apenas o SHA-256 dela
(`admin_config`, chave `mestre`), que prova que quem está falando é o mesmo
Worker de antes. O script abaixo faz as duas coisas e **não imprime a chave** —
apenas a impressão digital (SHA-256 em 12 caracteres):

```bash
npm run mestre                 # cria .local/mestre.key se preciso, registra o hash e grava o secret
npm run mestre -- --so-chave   # só garante o arquivo local
npm run mestre -- --forcar     # regrava o hash no banco (quando a chave local foi trocada)
```

Sem a chave mestra o painel **sobe**, mas nenhuma credencial pode ser gravada e
a telemetria do funil não registra nada — é o motivo de o funil aparecer vazio.

### Sessão e proteção

O login (`POST /api/admin/login`) devolve um **token de sessão** (bearer) com
validade de 12 h, guardado na tabela `admin_sessoes`. Não há cookie, portanto
não há CSRF: o token fica na memória da página e vai no cabeçalho
`Authorization` (ou `X-Admin-Token`). Cada IP tem no máximo **10 tentativas de
login em 15 minutos**.

A senha nunca é guardada em texto puro: o banco guarda o hash e a verificação
acontece no servidor, em funções `SECURITY DEFINER` com
`search_path = public, extensions`.

### Rotas do painel

| Rota | Método | Auth | Observação |
| --- | --- | --- | --- |
| `/admin` | GET | — | Interface do painel. |
| `/api/admin/login` | POST | — | `{usuario, senha}` → token de sessão. |
| `/api/admin/logout` | POST | token | Encerra a sessão. |
| `/api/admin/painel` | GET | token | KPIs do funil, falhas, fontes, credenciais, proxies e o estado do ambiente (`banco`, `master_key`, `gateway_proxy`, `fontes_ajustadas`). |
| `/api/admin/credenciais` | GET/POST/DELETE | token | Lista, grava (cifrada) e remove a credencial de uma fonte. |
| `/api/admin/proxies` | GET/POST/DELETE | token | Lista, grava e remove proxies; `gateway` diz se o gateway rotativo está ativo. |
| `/api/admin/fontes` | GET/POST | token | Catálogo efetivo e ajuste por fonte (limites e explicações de falha). |

### Funil de visitas

As quatro primeiras etapas (`visita`, `scan`, `scan_concluido`, `falha`) são
registradas pelo próprio Worker. A quinta, **`exportacao`**, acontece no
navegador — por isso existe a rota pública `POST /api/evento`:

```bash
curl -s -X POST https://ostnt.online/api/evento \
  -H 'origin: https://ostnt.online' -H 'content-type: application/json' \
  -d '{"etapa":"exportacao","formato":"json"}'
```

A rota aceita **somente** `etapa = "exportacao"`, exige origem autorizada e
**não leva o alvo nem o conteúdo do relatório** — só o formato. O navegador
envia o aviso com `navigator.sendBeacon` (e `fetch` com `keepalive` como
alternativa), o que não interfere na experiência de quem exporta.

O IP nunca é gravado em texto puro: o Worker guarda o **HMAC-SHA256** do IP,
com sal (`HMAC_SECRET`/`WARM_SECRET`), e só os 32 primeiros caracteres hex.

### Proxy rotativo

`PROXY_GATEWAY_URL` aponta para o gateway que alterna o proxy a cada requisição
(`npm run gateway`). Sem essa variável, `gateway_proxy` aparece como `false` no
painel e as fontes marcadas como `usa_proxy` consultam direto. O
`scripts/proxy-gateway.mjs` sobe o gateway local; para produção ele precisa
rodar em um host alcançável a partir da Cloudflare.

## Publicação e deploy

1. Instale Node.js 20 e Netlify CLI (a CLI pode ser instalada globalmente em sua máquina; **não** é dependência do projeto).
2. No diretório do projeto execute `npm install` e `npm run check`.
3. Entre na conta com `netlify login` e vincule/crie o site com `netlify init` ou `netlify link`. Se criar via Netlify, associe seu repositório Git.
4. Crie um widget Turnstile no painel da Cloudflare e autorize os domínios de produção, incluindo o `*.netlify.app` selecionado. Guarde a site key e a secret key.
5. Execute os comandos abaixo, substituindo as credenciais e os domínios. O `ALLOWED_ORIGINS` precisa **incluir exatamente** a origem onde o navegador acessa o site.

```bash
npm install
npm run check
# Opcional conforme a especificação; não é necessário para deploy e não faz parte das dependências:
# npm i -D esbuild
# npx esbuild public/index.html --minify --outfile=/tmp/x.html
netlify env:set HMAC_SECRET "$(openssl rand -hex 32)"
netlify env:set TURNSTILE_SECRET "<secret>"
netlify env:set TURNSTILE_SITE_KEY "<site-key-publica>"
netlify env:set ALLOWED_ORIGINS "https://SEUDOMINIO.com,https://www.SEUDOMINIO.com"
# Opcional:
# netlify env:set EMAILREP_KEY "<chave>"
netlify deploy --prod
```

**Sobre esbuild:** o comando de exemplo `npx esbuild public/index.html` não é compatível com a minificação direta de HTML pelo esbuild. Como este projeto funciona sem build do HTML, ignore-o; instalar esbuild acrescentaria dependências não exigidas. A Netlify empacota as Functions automaticamente.

Para **git push**, dentro da raiz do projeto:

```bash
git init
git add .
git commit -m "feat: OSINT static app with Netlify Functions"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/SEU-REPOSITORIO.git
git push -u origin main
```

Para desenvolvimento local com Functions e Blobs isolados:

```bash
netlify dev
```

**Importante:** abrir `public/index.html` em `file://` exibe a interface, mas **não** torna o scan funcional: as duas Functions, os segredos, o Turnstile e o Netlify Blobs exigem `netlify dev` ou deploy real.

### Publicação no Cloudflare Worker (produção atual)

O domínio `ostnt.online` é servido pelo Worker `ostnt-migration`, descrito em
`wrangler.toml`. Publicar é:

```bash
npm run build                                    # gera os artefatos derivados
npm exec --yes wrangler@4 -- deploy --keep-vars
```

Duas regras evitam queda de produção:

- **`--keep-vars`**: `wrangler deploy` substitui o conjunto inteiro de
  `[vars]`. Tudo que existe no painel da Cloudflare e **não** está no
  `wrangler.toml` se perde. As variáveis de produção estão no `wrangler.toml`
  (`APP_ENV`, `UA_MODE`, `UA_NAVEGADOR`, `UA_CONTATO`, `ALLOWED_ORIGINS`, `UA`,
  `BUDGET_SUBREQ`, `TURNSTILE_SITE_KEY`, `SUPABASE_URL`,
  `SUPABASE_PUBLISHABLE_KEY`) e o `--keep-vars` é a segunda rede de proteção.
- **Fluxo de `exports`, sem `[[migrations]]`**: a classe `TokenGuard` é
  reexportada pelo entrypoint (`cloudflare-worker.mjs`:
  `export {TokenGuard} from './src/lib/token-guard.mjs'`). O Worker já foi
  publicado nesse fluxo e a Cloudflare **recusa** a volta para `migrations`
  (erro `100403`). O bloco `[[migrations]]` **não** deve ser reintroduzido. No
  lugar dele, o arquivo declara:

  ```toml
  [exports.TokenGuard]
  type = "durable-object"
  storage = "sqlite"
  ```

  Sem esse bloco a publicação falha com `provisioned_class_missing_from_config`
  (o namespace `2b571eaf617445d18834c6d682b19ac6` precisa estar declarado).

Os segredos (`HMAC_SECRET`, `TURNSTILE_SECRET`, `GITHUB_TOKEN`,
`CREDENCIAIS_MASTER_KEY`, …) **não** ficam no `wrangler.toml`: são gravados com
`wrangler secret put` e sobrevivem ao deploy.

## Desenvolvimento local (prévia sem Wrangler)

`npm run dev` **não** depende do Wrangler nem de conta da Cloudflare. Ele sobe um servidor Node puro (`scripts/dev-server.mjs`, sem dependências) que reaproveita o motor real de produção (`src/scan.mjs` + `src/sources/registry.mjs`) e serve `public/`.

```bash
npm run dev                # http://localhost:3000 (ou 5173/8080/4173/5000 se ocupado)
PORT=4000 npm run dev      # porta fixa
npm run dev -- --port 4000 # mesma coisa, por argumento
npm run dev -- --host 127.0.0.1
npm run dev -- --sem-fallback  # exige a porta pedida: sai com 1 se ela estiver ocupada
npm run dev:stop            # encerra o servidor de fundo registrado (preserva a prévia)
npm run dev:stop -- --todos # encerra todos os servidores, inclusive a prévia
npm run dev:restart         # sobe um servidor novo em segundo plano (porta efêmera)
npm run start              # alias de dev (prévias automáticas do editor)
npm run preview            # alias de dev
npm run check              # sintaxe de todos os arquivos
npm run check:novos-alvos  # contrato offline dos alvos novos (CPF, placa, nome)
npm run test               # cache-check, contract-check, codegen-check, migrations-check,
                           # telegram-source-check, ssllabs-source-check,
                           # osint-github-source-check, source-fix-check,
                           # novos-alvos-check, warm-check, worker-regression,
                           # dev-server-check, dev-manifesto-check, dev-process-check,
                           # dev-ownership-check, dev-preview-check, stats-check
npm run pesquisa:github    # ranking dos repositorios open source de OSINT (e-mail/telefone)
                           # na API publica de busca do GitHub, ordenado por estrelas
```

O servidor local imprime a URL da prévia no início:

```text
  Server running on http://localhost:3000
  NEXUS_PREVIEW_URL=http://localhost:3000
```

Se a porta pedida já estiver ocupada, o servidor **não termina**: ele cai para
outra porta livre e imprime a URL que de fato está no ar. É o que evita o erro
do editor "o servidor terminou antes de abrir a prévia". Para exigir a porta
pedida (e sair com código 1 se ela estiver ocupada), use `--sem-fallback`: a
mensagem lista `Portas tentadas:` e `PORT=<numero>`.

Um processo antigo do servidor de desenvolvimento continua segurando a porta
mesmo depois do código ter sido corrigido, mas já não derruba a prévia: o
servidor cai para outra porta livre e imprime a URL que está no ar.

**Porta reservada pelo editor.** Quando o editor abre a prévia, ele escolhe uma
porta livre de `127.0.0.1` e a passa em `PORT`; o servidor **precisa** abrir
exatamente essa porta, porque o editor só sonda a porta que reservou. Nesse
caso o servidor não cai para outra porta: ele espera até 45 s pela porta
reservada, assumindo instâncias anteriores deste mesmo projeto (inclusive as
vivas, que são deste projeto), e só em último caso abre uma porta efêmera
mantendo um vigia que toma a porta reservada assim que ela ficar livre. O
argumento `--port` mantém o comportamento antigo (fallback liberado e dono vivo
nunca derrubado).

**O manifesto gerado nunca mais derruba a prévia.** Antes de carregar o motor,
o servidor confere `src/sources/registry.meta.mjs` contra
`src/sources/registry.json` e regera o arquivo quando ele está velho
(`scripts/garantir-manifesto.mjs`). Um manifesto desatualizado já não derruba o
processo — ele é corrigido na hora, e a prévia abre normalmente. O
`dev-manifesto-check` cobre esse caminho: ele corrompe o arquivo gerado, sobe o
servidor e exige HTTP 200 na porta reservada com o arquivo já regerado.

**A prévia do editor é preservada por padrão.** Ela é um
`node scripts/dev-server.mjs` como qualquer outro — encerrá-la produz o erro
"o servidor terminou antes de abrir a prévia". Por isso:

```bash
npm run dev:stop                # encerra só o servidor de fundo registrado
npm run dev:stop -- --listar    # só lista os processos, sem encerrar
npm run dev:stop -- --pid 1234  # encerra um PID específico
npm run dev:stop -- --todos     # encerra todos (derruba a prévia de propósito)
npm run dev:restart             # sobe um servidor novo, desacoplado, já pronto
```

O `dev:stop` sem opção encerra apenas o servidor de fundo que o
`dev:restart` subiu, registrado em `%TEMP%\osint-dev-server.json`. Os demais
processos (a prévia do editor e os servidores de outra sessão) aparecem como
`preservados` na saída.

`npm run dev:restart` é o atalho que sobe um servidor novo **desacoplado** (o
processo sobrevive ao fim do comando), em **porta efêmera** — fora da lista
que a prévia usa (3000, 5173, ...), para não disputar porta com ela —, espera
a linha `NEXUS_PREVIEW_URL=`, confere que `/` responde 200 e imprime o
resultado:

```json
{"escopo":"LOCAL ONLY; servidor de desenvolvimento local","pid":688,"url":"http://localhost:49840","porta":49840,"statusRaiz":200,"estaticos":{"/favicon.svg":200,"/robots.txt":200,"/sitemap.xml":200,"/.well-known/security.txt":200,"/obrigado.html":200},"encerradosAntes":[7900],"preservados":[6180],"log":"C:\\Users\\USUARIO\\AppData\\Local\\Temp\\osint-dev-server.log"}
```

O log do servidor fica em `%TEMP%\osint-dev-server.log`.

O que é **local e simulado** (rótulo `LOCAL ONLY` nos testes e banner `AMBIENTE LOCAL` na página):

- Turnstile: shim no navegador, token fake aceito pelo servidor. Sem segredos reais.
- `caches.default`, KV, Durable Object e `HTMLRewriter` em memória. Nada persiste entre reinícios.
- Token HMAC assinado com segredo efêmero por execução; `ALLOWED_ORIGINS` fica restrito a `localhost`/`127.0.0.1`/`[::1]`.
- Rate limit por sessão, para não queimar a cota real do IP.
- Fontes externas dependem da rede da sua máquina; em teste offline o resultado volta parcial.

O que **não** muda: `cloudflare-worker.mjs`, `wrangler.toml`, `public/` e as Netlify Functions continuam intactos. O Worker real é executado só com `npm run dev:worker` / `npm run dev:validation`, que exigem Wrangler instalado (`npm i -D wrangler`), `npx wrangler login` e os secrets do Worker.

## Funcionamento e privacidade

- `token.js` / rota Worker `/token`: checa Turnstile, assina token HMAC de uso único com TTL de 60 segundos e o vincula ao IP e ao SHA-256 do e-mail. O nonce consumido fica em Durable Object SQLite no Worker; `GET` expõe apenas a site key pública com cache de 24 horas.
- `scan.js` / rota Worker `/scan`: exige `Origin` autorizada e token de uso único. Limita cada IP a 10 scans por hora e 60 por dia, respondendo `429` com `Retry-After`; faz consultas externas no servidor com timeout e fallback.
- O cache usa uma chave SHA-256 do e-mail e guarda os resultados por **até 24h**. O Netlify Blobs **não fornece expiração automática nativa**: o código valida timestamps ao ler, e dados antigos podem permanecer fisicamente armazenados até uma rotina de limpeza. Configure uma política de retenção e exclusão para produção de grande escala.
- O limitador de IP no Netlify Blobs tem consistência forte, mas **não é atômico** sob concorrência elevada. Para cotas rígidas, configure também limitação por WAF/Edge.
- A verificação da senha é independente: SHA-1 feito em WebCrypto localmente, envio só dos cinco primeiros caracteres do hash para `api.pwnedpasswords.com`, comparação local do sufixo. **A senha em texto puro não é enviada.**
- O aplicativo não executa analytics nem instala cookies. Entretanto **não é correto prometer ausência absoluta de registros ou retenção**: Netlify, Cloudflare e fornecedores externos podem manter logs. O texto de interface `zero log` é um slogan fornecido na especificação, **não uma garantia técnica auditada**; revise a comunicação pública antes de lançar.
- O scanner permite a consulta de informações públicas; utilize somente endereços próprios ou com autorização. Não armazena ou apresenta credenciais em texto puro.

## Limites conhecidos

- **XposedOrNot:** cerca de **100 chamadas/dia por IP** para os endpoints usados (além de limites por hora), conforme a [documentação oficial](https://xposedornot.com/api_doc).
- **CNPJ.ws:** a base pública (`publica.cnpj.ws`) aceita **3 consultas por minuto/IP**; a 4ª devolve HTTP 429 com `retry-after: 60`. Por isso a fonte `cnpj_br` cai no Minha Receita quando o limite é atingido — o limite do provedor não vira relatório parcial. A consulta usa sempre a base pública (`publica.cnpj.ws`): o token comercial saiu do projeto e a fonte não exige credencial. Os dados do CNPJ.ws têm defasagem de cerca de um mês.
- **GitHub:** a consulta só é feita quando `GITHUB_TOKEN` está configurado; sem ele, `availability.github` fica `false`. No Worker, o resumo é cacheado por e-mail na Cache API durante 24 horas para reduzir chamadas compartilhadas.
- **Busca do GitHub (`npm run pesquisa:github`):** a API pública de busca permite **10 consultas por minuto sem token** e 30 com token. O script espera a janela abrir (`x-ratelimit-reset`) e repete; só depois de duas tentativas registra o aviso e segue com o que tem. O ranking é uma fotografia do momento da execução.
- **Numverify/APILayer:** a fonte `numverify` é declarada com **credencial obrigatória**: sem `NUMVERIFY_API_KEY` ela responde `sem_chave` e o relatório **não** fica parcial (a fonte não rodou). É a única fonte de telefone que depende de chave. Medido em 2026-11-20: a rota antiga (`apilayer.net/api/validate?access_key=…`) devolve **HTTP 401 `invalid_access_key`** para chave emitida no painel atual, e a rota atual (`api.apilayer.com/number_verification/validate`, cabeçalho `apikey`) devolve **HTTP 401 `Invalid authentication credentials`** — resposta idêntica à de uma chave inválida. A chave precisa ser a do produto *Number Verification API* do painel `app.apilayer.com/signup/numverify/free` (plano gratuito: 100 requisições por dia). A fonte tenta a rota atual primeiro e a antiga como reserva; `NUMVERIFY_API_ROTA` fixa uma delas. A recusa do provedor vira mensagem com a orientação, sem despejar o corpo cru da resposta no relatório.
- **Checagens de cadastro de e-mail (`email_registro`):** os 8 endpoints públicos respondem se o endereço está **em uso** naquele serviço — isso **não** identifica quem controla o e-mail, e o resultado muda conforme o serviço. Um site bloqueado vira "indisponível" isolado; se nenhum dos 8 responder, a fonte falha de verdade em vez de devolver "nada encontrado".
- **CPF (BrasilAPI):** medido ao vivo em 2026-11-11, o provedor **não publica o cadastro completo** (nome, nascimento, filiação, endereço): ele responde `{"cpf":"…","isValid":true,"rf":7,"ufs":["ES","RJ"]}`, ou `{"isValid":false}`, ou 404 quando o CPF não consta da base. A fonte publica exatamente o que recebeu, e `existe` fica **nulo** quando o provedor valida os dígitos mas não afirma se o CPF existe. Formato desconhecido vira erro, nunca dado inventado.
- **Placa (Consultar Placa v2):** é a única API de placa **viva** medida em 2026-11-11, e ela **exige credencial do operador** (`CONSULTARPLACA_CREDENCIAL`, no formato `email:api_key`, Basic Auth). Sem a credencial a fonte responde `sem_chave` e o relatório **não** fica parcial. A consulta é paga (R$ 0,31 por placa na data da medição) e o provedor oferece uma placa de teste gratuita, `AAA0000`, com dados fictícios. O provedor anterior (`apicarros.com`, apresentado como SINESP) está **morto**: responde HTTP 200 sem JSON, com o domínio estacionado.
- **SINESP oficial:** o host `cidadao.sinesp.gov.br` resolve (189.9.194.154), mas **não aceitou conexão a partir da máquina de verificação** nas portas 80, 443 e 8443, enquanto outros hosts `.gov.br` responderam normalmente (Receita 200, gov.br 301, Detran-SP 302). É uma limitação deste ambiente de teste, não prova de que o serviço esteja fora do ar.
- **"não encontrado" ≠ seguro**. Uma ausência de resultados não elimina risco, e falhas de APIs devem ser tratadas como resultados inconclusivos.
- APIs de terceiros podem mudar formatos, preços, restrições de CORS, políticas de consulta ou disponibilidade. As chamadas externas de investigação são feitas pela Function (com exceção do teste anônimo de senha diretamente do navegador).
- A CSP inclui `frame-src https://challenges.cloudflare.com`, ajuste necessário além do cabeçalho original para permitir o iframe do Turnstile, conforme a documentação oficial da Cloudflare.
- `TXT` e o serviço inferido do registro **não provam** o uso atual de um produto. A pontuação é heurística e não é avaliação de vulnerabilidade comprovada.
- Os dados de InternetDB são associados ao **IP do registro A**; serviços podem estar em CDN ou hospedagem compartilhada. Vulnerabilidades do IP podem não pertencer ao domínio investigado.
- A lista entregue no enunciado contém **77** itens (15 + 19 + 20 + **23**, não 24). Para cumprir **78 / 9 / 4 / 0** sem inventar uma URL, foi incluído **EmailRep** na categoria 4, ferramenta cuja URL e deep link já aparecem no próprio enunciado.
- O enunciado descreve **nove** checagens e exige prefixo `[n/8]`, duas instruções incompatíveis. O log utiliza `[n/9]` para refletir honestamente as nove etapas. As consultas são paralelizadas em uma única Function; o log atualiza quando chegam os resultados, sem fingir chamadas individuais inexistentes.
- O requisito de `0 CHAVES` refere-se à experiência do **visitante** (não fornece chave). O operador precisa de duas credenciais de segurança do servidor e uma site key pública; EmailRep é opcional.
- O selo/badge acima é apenas visual; não confirma que o projeto já foi publicado.

## Verificação recomendada antes da produção

1. Cheque o site em telas de 375 px, 768 px e desktop. Os acordeões devem começar fechados.
2. Envie um e-mail inválido: a Function não deve ser chamada.
3. Verifique as duas etapas do Turnstile; erros 401, 403, 429 devem ser tratados sem quebrar a página.
4. Faça duas consultas iguais e confirme `cached: true` na segunda, pelo DevTools.
5. No painel do navegador confirme ausência de chaves privadas, cookies próprios e requisições indevidas fora da CSP.
6. Verifique que a falta de uma API mostra **indisponível**, não "0 vazamentos" como resultado comprovado.

Projeto está pronto para ser versionado e implantado **após configurar a Netlify e Cloudflare**. Não há deploy automático nem acesso prévio às suas contas.

## Motor de fontes

`POST /api/scan` recebe `alvo` e token assinado de uso único emitido após Turnstile. Resultados em `caches.default`, com prefixo `https://ostnt.online/__cache/<id>/<alvo>` (componentes codificados); a rota pública desse prefixo responde 404. Sucesso usa o TTL da fonte; erros e timeouts usam 120 segundos. Cache é local ao datacenter e best-effort. KV (OSINT_KV, fallback CACHE) guarda somente limites: duas escritas por scan aceito. Tokens usam Durable Object SQLite para rejeitar replay atomicamente, sem escritas no KV. O orçamento é de 38 subrequests externos declarados; e-mail seleciona 13 fontes e custo 24, telefone seleciona 4 fontes e custo 2 (`telegram` 1, `ddd` 0, `phone_footprint` 0, `numverify` 1), CPF seleciona 2 fontes e custo 1 (`cpf_valida` 0, `cpf_brasilapi` 1), placa seleciona 2 fontes e custo 1 (`placa_footprint` 0, `placa_consultarplaca` 1) e nome seleciona 3 fontes e custo 13 (`wikidata` 1, `datajud` 2, `nome_perfil` 10). Telegram consulta somente telefone: o número vai para o formato internacional (código 55 em números nacionais de 10 ou 11 dígitos) e a fonte extrai o título e a descrição da página pública de `t.me`. O resultado é `paginaPublica`, **não** "a conta existe": o Telegram entrega a mesma página de contato para qualquer número, e a existência da conta só é resolvida no aplicativo — a fonte registra essa limitação em `observacao`. A migração `token-guard-v1` precisa acompanhar o deploy; conteúdo sem o binding TOKEN_GUARD falha de forma fechada.

A nota de segurança do HTTPS vem do **Qualys SSL Labs** (`ssllabs`), que substituiu o Mozilla Observatory: a API pública do Observatory foi descontinuada e todas as rotas `/api/*` respondem 404. A API v3 do SSL Labs não traz nota no nível do host — ela vem por endpoint (`endpoints[].grade`) —, então a fonte publica a **pior nota entre os servidores avaliados**, que é a própria regra do provedor. Enquanto a avaliação não foi publicada, a fonte devolve `situacao: "em_andamento"` (sem nota e sem erro) com TTL próprio de 300 segundos, para que a consulta seguinte encontre a nota; com a avaliação pronta, vale o TTL da fonte (3600 s).

### Fontes trazidas da pesquisa no GitHub (2026-11-11)

`npm run pesquisa:github` consulta a API pública de busca do GitHub (10
consultas, `sort=stars`) e devolve o ranking dos repositórios open source de
OSINT por e-mail e telefone. Na última execução real: **220 repositórios
únicos**, com `sundowndev/phoneinfoga` (18.526 estrelas), `laramies/theHarvester`
(18.290), `megadose/holehe` (15.611) e `antoniaci/blackbird` (10.090) no topo.

Os repositórios do topo são CLI em Go/Python, e o runtime de produção é um
Cloudflare Worker. "Instalar" aqui foi **portar a técnica** em JavaScript
próprio, sem copiar código nem dados (os portados são GPL ou não têm licença
declarada):

- `email_registro` (holehe + blackbird): consulta 8 endpoints públicos que
  respondem se o e-mail está em uso — Duolingo, ProtonMail, WordPress,
  Twitter, Spotify, Adobe, Firefox e Freelancer. Todos foram verificados ao
  vivo nos dois sentidos. Um site bloqueado vira "indisponível" isolado; se
  nenhum responder, a fonte falha de verdade.
- `phone_footprint` (PhoneInfoga): normalização E.164, formato nacional com
  DDD, país, links de WhatsApp/Telegram e as buscas públicas por categoria
  (redes sociais, SMS descartável, reputação, pessoas). **Nenhuma chamada de
  rede**: as buscas são links, não consultas.
- `numverify` (PhoneInfoga): validade, operadora, país e tipo de linha do
  número, via Numverify/APILayer. Precisa de `NUMVERIFY_API_KEY`; sem a chave
  responde `sem_chave` e o relatório não fica parcial. Usa a rota atual da
  APILayer (cabeçalho `apikey`) com a rota antiga como reserva.

O relatório completo da pesquisa — ranking, mapa repositório → técnica
portada e o descarte de cada candidato com a medição — está em
`verification/github-osint.md`.

### Alvos novos: CPF, placa e nome completo

O scanner passou a aceitar **CPF**, **placa** e **nome completo**, com cinco
fontes novas (o total foi de 27 para 32):

| Fonte | Tipo | Custo | TTL | Credencial | O que entrega |
| --- | --- | --- | --- | --- | --- |
| `cpf_valida` | cpf | 0 | 0 | nenhuma | Validação local dos dígitos verificadores; **nenhuma** chamada de rede |
| `cpf_brasilapi` | cpf | 1 | 86400 | nenhuma | Situação do CPF na base pública (BrasilAPI): dígitos verificadores, região fiscal e UFs — **sem** nome, nascimento, filiação ou endereço, que o provedor não publica |
| `placa_footprint` | placa | 0 | 0 | nenhuma | Formato da placa (Mercosul/antiga) e links das buscas públicas; **nenhuma** chamada de rede |
| `placa_consultarplaca` | placa | 1 | 86400 | `CONSULTARPLACA_CREDENCIAL` | Cadastro público do veículo (API Consultar Placa v2): modelo, marca, ano, cor, município/UF e dados técnicos |
| `nome_perfil` | nome | 10 | 86400 | nenhuma | Perfis públicos de nomes de usuário derivados do nome completo (técnica do Maigret) |

O que essas fontes **não** dizem — e o relatório registra na fonte:

- A validação de CPF prova apenas que os dígitos verificadores batem. Um CPF
  válido não é um CPF existente.
- O 404 do provedor vira "ausência na base consultada", nunca "não existe":
  ausência em uma base não é prova de inexistência.
- **A placa identifica o veículo, não o titular.** Nenhum provedor público
  consultado aqui devolve o nome do proprietário; os links entregues são
  consultas manuais em documentos e anúncios.
- A API de placa aceita apenas os formatos `AAA0000` e `AAA09A00`. Uma placa
  Mercosul (`ABC1D23`) é recusada pelo provedor com HTTP 400; a fonte repassa
  o erro, sem inventar dado.
- Um perfil com o mesmo nome **não** prova identidade: homônimos são comuns,
  e a fonte diz isso no próprio resultado.

Quando nenhum site de perfil responde, a fonte **falha de verdade** (o
provedor está fora do ar) em vez de devolver "nada encontrado" — a diferença
entre "não achei" e "não consegui perguntar" é o que separa um relatório
honesto de um relatório vazio.

A detecção do alvo (`src/lib/alvo.mjs`) reconhece a placa nos dois formatos
(LLLNLNN e LLLNNNN) e não confunde telefone com placa. Nenhum cadastro é feito
e nenhuma conta é criada: são apenas GETs públicos.

O aceite com **rede real** foi feito em **2026-11-11** (`npm run aceite:novos-alvos`)
e mudou três coisas: o parser da BrasilAPI passou a publicar os três formatos
**medidos** (e não um cadastro completo que o provedor não entrega), a fonte de
veículo trocou de provedor — o antigo estava morto — e a rota do Keybase foi
corrigida de `/_api/1.0/…` (404 em toda requisição) para `/_/api/1.0/…`. O que
**continua sem verificação**: o caminho de sucesso da API de placa (exige uma
conta paga do operador), a execução no edge da Cloudflare e a rota do SINESP,
que não aceitou conexão desta máquina. O contrato de parsing, o tratamento do
404, do 401 e da falha real continuam verificados offline — ver
`verification/novos-alvos-check.mjs` (na cadeia do `npm test`).

Chaves opcionais, somente no servidor:
```sh
wrangler secret put GITHUB_TOKEN
wrangler secret put EMAILREP_KEY
wrangler secret put TRANSPARENCIA_KEY
wrangler secret put DATAJUD_API_KEY
wrangler secret put NUMVERIFY_API_KEY
wrangler secret put CONSULTARPLACA_CREDENCIAL
```

A credencial do Consultar Placa é o **e-mail da conta como usuário e a api_key
como senha**, no formato `email:api_key` (Basic Auth).

A chave do Numverify sai do painel da APILayer, no produto *Number
Verification API* (`app.apilayer.com/signup/numverify/free`); uma chave de
outro produto da APILayer é recusada com HTTP 401 pela rota de validação de
telefone.

Sem essas chaves, as fontes correspondentes respondem com o código `sem_chave` ou `sem_token` e o relatório **não** é marcado como parcial: a fonte não rodou, o restante das consultas continua valendo.

A fonte `cnpj_br` não exige credencial: ela consulta o CNPJ.ws pela base
pública e usa o Minha Receita como reserva (o token comercial saiu do
projeto). CPF, placa e nome completo passaram a fazer parte do escopo (ver "Alvos novos: CPF, placa e nome completo" acima). Nomes são consultas públicas não conclusivas; o nome informado não confirma identidade. A placa identifica o veículo, não o titular: nenhum provedor público consultado aqui devolve o nome do proprietário. JSON e CSV incluem proveniência e timestamp.

### Rotas expostas pelo Worker

| Rota | Método | Observação |
| --- | --- | --- |
| `/api/scan` | POST | **Única** rota de scan. Motor v1.3 (`src/scan.mjs`). |
| `/api/saude` | GET | Painel de saúde, exige token de operador. |
| `/api/evento` | POST | Aviso do funil de visitas (`exportacao`). Exige origem autorizada e `etapa = "exportacao"`. |
| `/api/admin/*` | GET/POST/DELETE | Painel do operador. Exige token de sessão, exceto o login. |
| `/admin` | GET | Interface do painel do operador. |
| `/.netlify/functions/token` | GET/POST | Emissão e consumo de token do Turnstile. Continua porque `public/app.js` ainda a chama. |
| `/`, `/app.js`, `/og.png`, `/favicon.svg`, `/obrigado.html`, `/robots.txt`, `/sitemap.xml`, `/.well-known/security.txt` | GET | Estáticos e páginas. |

A rota legada `/.netlify/functions/scan` **não existe mais** no Worker: o motor
antigo (v1.2) foi removido do arquivo e a única forma de consultar o scanner é
`POST /api/scan`. O `verification/worker-regression.mjs` fixa essa regra — se a
rota legada voltar, o check falha.

## Endurecimento do scanner

Cinco camadas, todas verificadas por `verification/` e executadas offline.

### 1. Contrato de resultado e taxonomia de erro (`src/contract.mjs`)

Um único lugar define o formato de uma fonte consultada e o significado de cada
falha. Códigos: `sem_chave`, `sem_token`, `erro_rede`, `timeout`, `http`,
`formato`, `erro`.

- `sem_chave` e `sem_token` são **falhas de configuração** do operador: a fonte
  não rodou, o relatório não fica parcial.
- Os demais códigos são falha real e marcam o relatório como parcial.
- `classificarErro()` transforma qualquer exceção em um código da taxonomia;
  `normalizarFonte()` devolve sempre o mesmo formato de resultado;
  `saudeDe()` resume o scan (`ok`, `indisponiveis`, `por_configuracao`, `parcial`).

### 2. Manifesto das fontes (`src/sources/registry.json`)

Os metadados das 32 fontes (título, tipos, custo, TTL, proveniência, credencial
opcional) vivem em um JSON legível. `scripts/build-registry.mjs` gera
`src/sources/registry.meta.mjs` de forma determinística e
`src/sources/registry.mjs` valida cada implementação contra o manifesto no
carregamento do módulo: divergência de tipo, custo, TTL, proveniência ou
credencial interrompe o Worker na hora do build, não no meio de uma consulta.
O manifesto também proíbe, por construção, qualquer fonte que exija chave do
visitante.

### 3. Migrações do Durable Object (`migrations/*.sql`)

O schema do `TOKEN_GUARD` é versionado em arquivos `.sql` revistos.
`scripts/build-migrations.mjs` empacota as migrações em `src/lib/migrations.mjs`
(o runtime do Worker não lê arquivos) e `src/lib/sql-migrations.mjs` aplica
cada versão uma única vez, registrando em `schema_meta`.

- `0001_token_guard.sql`: nonces de uso único e expiração.
- `0002_scan_jobs.sql`: histórico de scans (`jobs`/`job_fontes`), com retenção
  de 7 dias.

Nada de alvo, e-mail ou IP é persistido: só contagens, identificador de fonte e
instantes.

### 4. Painel de saúde e identificador de job

Cada scan devolve `meta.job_id` (UUID), o cabeçalho `x-job-id` e um resumo
`saude` + `fonte_saude` (status por fonte). O painel agregado fica em
`GET /api/saude`, protegido por token de operador.

### 5. Token de operação (`X-Warm-Token`)

Credencial do operador assinada com HMAC-SHA256 (`WARM_SECRET`, ou
`HMAC_SECRET`), com validade máxima de 24 horas, comparação em tempo
constante e escopo fixo:

| Escopo | Uso | Amarração |
| --- | --- | --- |
| `aquecimento` | `POST /api/scan` sem consumir o token do visitante | o alvo (hash SHA-256) |
| `operador` | `GET /api/saude` | nenhuma |

O alvo nunca aparece em texto claro no token. Emita um token com:

```bash
npm run warm-token -- --escopo operador --ttl 3600
npm run warm-token -- --escopo aquecimento --alvo exemplo@dominio.com --ttl 900
```

Depois de emitir, use o header:

```bash
curl -s -H "X-Warm-Token: <token>" https://ostnt.online/api/saude
```

### Verificação contínua

`.github/workflows/ci.yml` (raiz do repositório) roda `npm run check`,
`npm test`, `npm run build` e `npm run check:build`, e falha se a árvore não
estiver limpa depois do build — o build tem que ser idempotente. O
`check:build` confere os três artefatos derivados (presença, versionamento e
diff), exige a árvore inteira limpa e roda o build de novo para provar que ele
não muda nada. `.github/workflows/deploy.yml` publica o Worker somente por
despacho manual, com confirmação digitada.

`npm run check` na raiz verifica a sintaxe de todos os arquivos `.mjs`/`.js` do
Worker **e** da variante Netlify (`osint-infoc-hacker/`), por meio de
`scripts/check-syntax.mjs`. `npm test` roda dezesseis checks offline; o
`dev-process-check` sobe o servidor local como processo filho e confirma que ele
permanece vivo, imprime `NEXUS_PREVIEW_URL`, serve a interface com 200, cai
para outra porta quando a pedida está ocupada e sai com 1 no modo estrito
(`--sem-fallback`).

## Estado da verificação em 2026-10-30

Consulte `verification/status.md`. Testes locais não comprovam disponibilidade das fontes nem cache de edge. A versão candidata ainda não substituiu o Worker de produção.

### Worker de validação isolado

`wrangler.validation.toml` define um worker separado e usa a sitekey de teste, que aceita qualquer visitante. Instale o secret de teste **somente** nesse worker por ambiente; nunca copie a `TURNSTILE_SITEKEY` de teste nem o secret correspondente para `ostnt-migration`. A chave pública real segue no binding `TURNSTILE_SITE_KEY` do Worker de produção. O endpoint `/token` usa `TURNSTILE_SITEKEY` quando definido, registra `TURNSTILE_SITEKEY de teste em uso` para chaves iniciadas em `1x0000` e exige que o hostname retornado pelo siteverify corresponda ao hostname da requisição.

### Evidência HTTP e identificação por endpoint

Respostas HTTP não bem-sucedidas têm os primeiros 200 caracteres do corpo copiados por `clone()`, sem consumir a resposta original. `falhar` preserva status e corpo na exceção; a mensagem do relatório comporta 220 caracteres. Logs privados incluem a exceção associada ao id da fonte. A captura não classifica automaticamente respostas como bloqueio 1010.

`crtsh`, `cnpj_br` e `ddd` devem ser classificados individualmente, usando resposta e corpo observados em cada endpoint. Compartilhar o host BrasilAPI não comprova compartilhar uma regra de bloqueio. Os logs disponíveis não comprovam execução dessas três fontes.

Trocar de biblioteca ou runtime (por exemplo, curl para Playwright) é troca de cliente. Alterar somente User-Agent no mesmo fetch do Worker é alteração de header e pode alterar sua assinatura declarada. Essa distinção técnica não elimina restrições de acesso ou rejeições de revisão automática. O experimento A/B solicitado permanece pendente devido à rejeição anterior de tentativas de contornar o 1010; nenhum resultado A/B é declarado.

### Seleção de User-Agent

| Modo | Header enviado por ctx | Configuração |
| --- | --- | --- |
| `identificado` | `env.UA` (identificação do scanner como fallback) | Padrão quando UA_MODE está ausente; configuração de produção |
| `navegador` | `env.UA_NAVEGADOR` | Somente configuração de validação |

alterar o modo muda apenas o header User-Agent; o cliente HTTP permanece fetch do runtime

A produção permanece em `identificado` até decisão explícita. A configuração de validação contém `UA_MODE = "navegador"`; sua ativação e chamadas reais continuam pendentes da restrição registrada para o 1010. O modo inválido e a ausência de UA_NAVEGADOR no modo navegador geram erro explícito.

### Limitações dos provedores e 1010

O operador relatou: "1010 é reputação de IP de saída do Worker; a mitigação é troca de provedor, não ajuste de UA". Essa atribuição causal ainda não foi comprovada pelos registros disponíveis neste ambiente. UA_MODE permanece configurado como identificado em produção; a mudança de UA não é tratada como solução comprovada.

| ID | Mudança | Motivo e evidência |
| --- | --- | --- |
| `ddd` | BrasilAPI DDD substituída por snapshot local Anatel (67 DDDs) | Elimina chamadas de rede; não depende de provar bloqueio do antigo endpoint |
| `cnpj_br` | BrasilAPI CNPJ substituída por Minha Receita; agora **CNPJ.ws na frente** e Minha Receita de reserva | Resposta real do `publica.cnpj.ws` (HTTP 200, `situacao=Ativa`) na sonda de rede real; o endpoint público aceita 3 consultas por minuto/IP, então o 429 cai na reserva em vez de virar falha |
| `crtsh` | crt.sh substituído por Subdomain Center | Troca solicitada pelo operador; novo endpoint retornou 503/server busy no teste local, pendente de sucesso e teste no Worker |

Nenhuma fonte foi movida ao browser nem removida nesta etapa. Cada endpoint é classificado pelo próprio resultado. CORS do BrasilAPI CNPJ foi observado como `*`; o HEAD de crt.sh retornou 502 sem header CORS, portanto seu suporte permanece inconclusivo. Resultados completos e limites da comprovação estão em `verification/provider-switch.md`.

O snapshot de DDD foi obtido de https://www.anatel.gov.br/dadosabertos/PDA/Codigo_Nacional/PGCN.csv em 2026-10-30; o hash SHA-256 está em `src/data/ddd.mjs`. O arquivo conserva cidades de UFs distintas para DDDs compartilhados. É uma versão estática que precisa de atualização deliberada; não promete dados mais novos que o arquivo obtido.

Referências dos novos adaptadores: https://docs.minhareceita.org/como-usar/ e https://github.com/ARPSyndicate/docs . Subdomain Center retorna amostra anônima, não inventário completo; o adaptador limita o resultado a 60 subdomínios.

Rechecagem do Subdomain Center com o mesmo curl/UA: timeout após 20 segundos e zero bytes, sem resposta HTTP do destino. Somado ao 503 anterior, o provedor continua sem sucesso comprovado; não está classificado como 1010. O Worker de validação permanece com rota pública e previews desligados; sua configuração de UA no repositório ainda não foi aplicada no serviço. O aceite pela saída do Worker permanece pendente.
