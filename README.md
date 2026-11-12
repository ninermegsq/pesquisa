# OSINT // InfoC Hacker

Versão do site com a interface Morph Orb e animação de pesquisa. O domínio `ostnt.online` roda no Cloudflare Workers.

- [Baixar o projeto completo](./osint-infoc-hacker-desktop-v2.zip)
- [Abrir os arquivos-fonte](./osint-infoc-hacker/)
- Worker publicado no Cloudflare: [`cloudflare-worker.mjs`](./osint-infoc-hacker/cloudflare-worker.mjs)

O ZIP inclui o HTML/CSS/JavaScript e as funções para hospedagem alternativa na Netlify. Para a produção atual, use o Worker do Cloudflare; ele mantém Turnstile, consultas e cache no servidor. O GitHub ainda não publica automaticamente no Cloudflare.

## Estrutura do repositório

```text
/
├─ .github/workflows/     # CI (verificação local) e deploy manual
├─ current-site/
│  └─ osint-infoc-hacker/ # Worker em produção: src/, public/, migrations/, verification/
├─ osint-infoc-hacker/     # variante Netlify (Functions) e o Worker empacotado
└─ package.json            # comandos do repositório (delegam para current-site/)
```

## Comandos

Todos os comandos rodam na raiz e não precisam de instalação: o projeto não
tem dependências de runtime (só Node 20+).

```bash
npm run dev                # servidor local de desenvolvimento (prévia)
npm run dev -- --port 4000 # porta fixa
npm run dev:stop           # encerra o servidor de fundo que o dev:restart subiu
npm run dev:stop -- --todos  # encerra todos os servidores (inclusive a prévia do editor)
npm run dev:restart        # sobe um servidor novo em segundo plano (porta efêmera)
npm run start              # alias de dev (usado por prévias automáticas)
npm run preview            # alias de dev
npm run check              # sintaxe de todos os arquivos .mjs/.js (walker)
npm test                   # verificações offline (contrato, cache, dev-server, CI)
npm run build              # gera registro e migrações e injeta public/ no Worker
npm run check:build        # prova que o build é idempotente (árvore limpa)
npm run mapa:sync          # gera o public/mapa.js do pacote Netlify a partir do canônico
npm run warm-token -- --escopo operador   # emite um token de operação
npm run mestre             # chave mestra do painel (arquivo local + secret do Worker + hash no banco)
npm run check:admin        # contrato offline do painel admin
npm run gateway            # gateway de proxy rotativo (local)
```

O build é idempotente: rodá-lo duas vezes não altera nenhum arquivo, e a CI
falha se a árvore não estiver limpa depois do build. `npm run check:build`
confere isso: os três artefatos derivados precisam existir, estar versionados
e sem diff; a árvore inteira precisa estar limpa; e o build é rodado de novo
para provar que ele não muda nada.

Se a porta pedida para a prévia já estiver ocupada, o servidor local não
termina: ele cai para outra porta livre e imprime a URL real
(`NEXUS_PREVIEW_URL=`). Para exigir a porta pedida, use
`npm run dev -- --port 4000 --sem-fallback`.

**A prévia do editor nunca é derrubada por engano.** A prévia é um
`node scripts/dev-server.mjs` como qualquer outro: encerrá-la produz o erro
"o servidor terminou antes de abrir a prévia". Por isso `npm run dev:stop`
encerra **apenas** o servidor de fundo registrado por `npm run dev:restart`
(%TEMP%\osint-dev-server.json) e **preserva** a prévia e os servidores de
outra sessão. Para encerrar tudo, inclusive a prévia, use
`npm run dev:stop -- --todos`.

Um servidor antigo em execução continua segurando a porta e mantém o código
antigo em memória (os módulos ESM são carregados uma vez por processo), mas
isso já não derruba a prévia: o servidor cai para outra porta livre. Para
listar os processos sem encerrar nada: `npm run dev:stop -- --listar`.

Para subir um servidor novo, desacoplado (sobrevive ao fim do comando), com o
código da hora, imprimir a URL e conferir que a página responde 200:

```bash
npm run dev:restart
npm run dev:restart -- --porta 4000   # porta fixa
```

O servidor de fundo sobe em **porta efêmera**, fora da lista de portas que a
prévia usa (3000, 5173, ...): os dois convivem sem disputar porta. A saída é
um JSON com `url`, `pid`, `porta`, `statusRaiz` e o status de cada ativo
estático. O log do servidor fica em `%TEMP%\osint-dev-server.log`.

## Mapa de conexões

A visão principal do resultado não é mais a lista de fontes: é um **mapa-mundi em
SVG** (`current-site/osint-infoc-hacker/public/mapa.js`) onde cada fonte
consultada vira um nó ligado por um arco até o país do visitante. Fonte que
respondeu fica em brasa (`#e6a274`); fonte que **falhou** fica em vermelho
(`#f87171`), com halo pulsando. Clicar no nó abre o detalhe da fonte; o país
vem de `request.cf.country` no Worker.

Sem framework: é SVG gerado em JavaScript puro, com a mesma paleta do site
(fundo `#050505`, creme `#e7e6d9`, brasa `#e6a274`, vermelho `#f87171`). O
relatório em PDF (`public/relatorio.js`) usa a mesma paleta e é montado à mão
(sem biblioteca de PDF).

Os detalhes por fonte continuam acessíveis, recolhidos em um único acordeão
("DETALHES DAS FONTES"). A verificação offline está em
`verification/mapa-pdf-check.mjs` (`npm run check:mapa`).

**As linhas saem separadas, não empilhadas.** Cada arco nasce num ponto
diferente do anel de despacho ao redor da origem; fontes que saem quase na
mesma direção formam um leque, e dentro do leque cada linha recebe uma faixa
lateral própria (deslocada perpendicularmente ao cordão). Uma passada final
afasta qualquer curva que ainda encoste na vizinha. O check fixo esse
comportamento: nenhuma célula de 4×4 px pode ter mais de 4 arcos e nenhuma
dupla de linhas pode andar colada. O `public/mapa.js` do pacote Netlify é
gerado a partir deste arquivo (`npm run mapa:sync`); o check falha se as duas
cópias divergirem.

## Painel admin

O operador tem um painel em `https://ostnt.online/admin` (interface em
`current-site/osint-infoc-hacker/public/admin.html`) com a API em
`/api/admin/*`. Ele permite **configurar a chave de API de cada fonte**
(cifrada com AES-256-GCM; precedência banco → variável de ambiente →
`sem_chave`), **ver quais chaves estão ativas**, os **limites de requisição**
por fonte, o **proxy rotativo** para as APIs limitadas por IP, o **funil de
visitas** (`visita` → `scan` → `scan_concluido` → `falha` → `exportacao`) e a
**explicação de cada falha**.

A chave que cifra as credenciais (`CREDENCIAIS_MASTER_KEY`) vive como segredo
do Worker e como arquivo local ignorado pelo git (`.local/mestre.key`); o banco
guarda apenas o SHA-256 dela. `npm run mestre` configura as três pontas sem
imprimir o valor.

O detalhe completo (rotas, sessão, chave mestra, funil, proxy e as regras de
publicação do Worker) está em
[`current-site/osint-infoc-hacker/README.md`](./current-site/osint-infoc-hacker/README.md).

## Verificação contínua

- `.github/workflows/ci.yml` roda `check`, `test`, `build` e a prova de
  idempotência do build (`npm run check:build`) a cada push ou pull request.
- `.github/workflows/deploy.yml` publica o Worker **somente** por despacho
  manual e exige confirmação digitada mais os segredos
  `CLOUDFLARE_API_TOKEN` e `CLOUDFLARE_ACCOUNT_ID`.
