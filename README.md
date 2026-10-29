# OSINT — Turnstile em ostnt.online

Integração completa do formulário existente com Cloudflare Turnstile e Netlify
Functions. A chave pública `0x4AAAAAAFrCL8A3Pa1kzDsB` está no HTML. O segredo é lido
somente de `process.env.TURNSTILE_SECRET` no backend.

## Estrutura para deploy

```text
public/
  index.html              # formulário, widget e fetch
  cinematic-orb.js         # timeline e esfera de partículas
  cinematic-orb.css        # tema escuro, perolado e verde-esmeralda
  _headers                # CSP compatível com Turnstile
  favicon.svg
  obrigado.html
netlify/functions/
  token.js                # valida Siteverify e autoriza o scanner
  scan.js                 # scanner existente, protegido por token HMAC
test/turnstile.test.js     # testes automatizados com Siteverify simulado
netlify.toml
package.json
package-lock.json
.env.example              # nomes de variáveis, sem segredos
```

O ZIP original foi mantido como referência. O deploy usa os arquivos extraídos
na raiz deste repositório, não o ZIP nem a pasta temporária do onboarding.

## Cloudflare

1. Abra **Turnstile** e selecione o widget da chave pública informada.
2. Em **Hostname Management**, autorize `ostnt.online` e `ostnt.netlify.app`, sem protocolo ou caminho.
3. Selecione **Widget Mode: Managed** e salve. O modo é configurado no painel;
   não existe atributo HTML `data-mode="managed"`.
4. Copie a **Secret Key** desse mesmo widget para o campo seguro da Netlify.
   Não coloque esse valor no HTML, no Git ou em mensagens.

## Variáveis na Netlify

No projeto que atende ostnt.online, abra **Project configuration → Environment
variables → Add a variable**. Configure o contexto **Production** e o escopo
**Functions** (ou todos os escopos, conforme as opções do plano):

| Nome | Valor |
| --- | --- |
| `TURNSTILE_SECRET` | Secret Key real do widget; marque como segredo. |
| `HMAC_SECRET` | Segredo aleatório forte do scanner existente. Preserve o atual se já configurado. |
| `ALLOWED_ORIGINS` | `https://ostnt.online,https://ostnt.netlify.app` (também é o padrão do código). |
| `TURNSTILE_HOSTNAMES` | `ostnt.online,ostnt.netlify.app` (também é o padrão do código). |

Se precisar de um HMAC_SECRET novo, execute `openssl rand -hex 32` na sua máquina
e cole o resultado apenas no campo seguro da Netlify. Não substitua um segredo
existente sem necessidade. O scanner usa esse segredo para autorizar consultas
após a validação do Turnstile. `TURNSTILE_SITE_KEY` não é necessária, pois a chave
pública está no HTML. `EMAILREP_KEY` continua opcional.

### Verificação de segredos no build

Se `TURNSTILE_SITE_KEY` estiver cadastrada como segredo na Netlify, o scanner
pode bloquear sua chave pública no HTML ou na documentação. O netlify.toml
exclui **somente `TURNSTILE_SITE_KEY`** dessa verificação com
`SECRETS_SCAN_OMIT_KEYS`. Essa chave é pública por definição do Turnstile.
O scanner permanece ativo para os segredos reais, incluindo
`TURNSTILE_SECRET` e `HMAC_SECRET`. Não exclua essas duas variáveis.
Como o frontend já contém a site key, a variável `TURNSTILE_SITE_KEY` é opcional
e também pode ser removida do painel, sem remover `TURNSTILE_SECRET`.

Se também usar www, autorize `www.ostnt.online` no widget e configure:

```text
ALLOWED_ORIGINS=https://ostnt.online,https://www.ostnt.online
TURNSTILE_HOSTNAMES=ostnt.online,www.ostnt.online
```

## Deploy

Conecte este repositório ao projeto Netlify correto. Base directory: raiz do
repositório; Build command: `npm run check && npm test`; Publish directory:
`public`; Functions directory: `netlify/functions`. O netlify.toml já define
essas opções e Node.js 20; o npm instala as dependências do package-lock.json.
Confirme `ostnt.online` em **Domain management** e HTTPS ativo.

Envie os arquivos ao GitHub e inicie um novo deploy depois de salvar as variáveis.
Alternativamente, com a CLI autenticada e vinculada ao projeto correto, execute
`netlify deploy --build --prod`. Arrastar somente public para o Netlify Drop não
publica as Functions e não é suficiente para esta integração.

## Fluxo implementado

1. O visitante informa um e-mail válido e clica em SCAN.
2. O frontend carrega `https://challenges.cloudflare.com/turnstile/v0/api.js`
   com `?render=explicit` e renderiza o widget dentro do formulário, lendo
   `data-sitekey="0x4AAAAAAFrCL8A3Pa1kzDsB"`, com a ação `scan`.
3. O callback captura o token. Um fetch POST para `/.netlify/functions/token`
   envia JSON `{ "cfToken": "..." }`.
4. A Function envia POST para
   `https://challenges.cloudflare.com/turnstile/v0/siteverify` com URLSearchParams:
   `secret`, `response` e, quando disponível, `remoteip`.
5. Só aceita `success: true`, hostname autorizado e ação `scan`. Retorna
   `{ "success": true, "token": "..." }`, incluindo uma autorização HMAC de
   60 segundos vinculada ao IP, enviada pelo frontend à Function scan.
6. Falha de verificação retorna 401; indisponibilidade/configuração ausente 503;
   origem negada 403; JSON/token inválido 400; método incompatível 405.

O segredo nunca é retornado. O GET de token retorna somente a chave pública.
Tokens Turnstile são de uso único e expiram em cinco minutos. Cada tentativa
cria um novo widget/token; erros, expiração e tempo limite permitem nova tentativa.
A CSP em public/_headers permite scripts, frames e conexões da Cloudflare.

## Desenvolvimento e verificação

Com Node.js 20 e a Netlify CLI instalados:

```bash
npm ci
npm run check
npm test
cp .env.example .env
# Preencha os segredos apenas no .env local, que é ignorado pelo Git.
netlify dev
```

Para localhost, ajuste ALLOWED_ORIGINS à origem exata do navegador e configure
TURNSTILE_HOSTNAMES. Use um widget separado autorizado para desenvolvimento ou as
chaves oficiais de teste da Cloudflare apenas em configuração local. A chave
pública do frontend deve corresponder ao segredo usado; não publique chaves de
teste. O formulário de produção já está configurado para ostnt.online.

No ambiente cloud preparado, a CLI em /workspace/onboarding-tools pode precisar
de `--offline --internal-disable-edge-functions`; o projeto usa apenas Functions
Node.js. Esse ajuste não é necessário no deploy.

Os testes simulam Siteverify e verificam o contrato da chamada, sucesso e
rejeições, incluindo expiração/duplicação, hostname, ação e falhas externas.
Não substituem uma verificação real com as chaves configuradas na Netlify.

Após o deploy, conclua o widget em https://ostnt.online e confira no DevTools
um POST token com status 200 e success:true. Confirme que tokens inválidos ou
expirados não iniciam o scanner e que não há segredos nas respostas públicas.
Netlify Blobs e APIs externas continuam necessários para o scanner completo;
falhas nessas fontes não significam falha do Turnstile.


## Design cinematográfico

Veja [DESIGN.md](DESIGN.md) para as fases da animação, cores, integração com o
scanner, acessibilidade e reprodução dos testes de navegador. Não é necessário
React, shadcn ou Tailwind para publicar esta adaptação na stack HTML/JS existente.


## Erro 404 ao instalar o ZIP

O ZIP de código-fonte contém public/index.html, e não index.html na raiz. O deploy
manual por arrastar não executa o build nem empacota as Netlify Functions. Arrastar
o ZIP de código inteiro pode causar o 404 mostrado pelo Netlify. Arrastar somente
public publica apenas a interface, sem o scanner serverless.

Para publicar tudo no projeto existente:

1. Em Deploys, use a opção para conectar/importar um repositório Git (o nome da
   opção varia no painel). Escolha ninermegsq/pesquisa, branch
   codex/site-cinematico. Essa branch contém o código extraído; a main antiga
   contém apenas o ZIP original e não é a branch preparada para esse build.
2. Base directory: raiz (deixe vazio). Build command: npm run check && npm test.
   Publish directory: public. Functions directory: netlify/functions.
3. Preserve TURNSTILE_SECRET e HMAC_SECRET configurados no mesmo projeto. Atualize
   ALLOWED_ORIGINS e TURNSTILE_HOSTNAMES conforme a tabela acima, caso existam.
4. Autorize ostnt.netlify.app no widget Managed da Cloudflare, além de ostnt.online.
5. Inicie um novo deploy e confirme que a página e a Function token respondem.

Alternativa com CLI: extraia o pacote, entre na pasta que contém netlify.toml,
execute npm ci, netlify login, netlify link (selecione o projeto ostnt existente)
e netlify deploy --build --prod. O deploy por CLI/Git inclui as Functions.
