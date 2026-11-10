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
npm run dev:stop           # encerra servidores de desenvolvimento deixados no ar
npm run dev:restart        # encerra os antigos e sobe um novo em segundo plano
npm run start              # alias de dev (usado por prévias automáticas)
npm run preview            # alias de dev
npm run check              # sintaxe de todos os arquivos .mjs/.js (walker)
npm test                   # verificações offline (contrato, cache, dev-server, CI)
npm run build              # gera registro e migrações e injeta public/ no Worker
npm run check:build        # prova que o build é idempotente (árvore limpa)
npm run warm-token -- --escopo operador   # emite um token de operação
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

Um servidor antigo em execução continua segurando a porta e mantém o código
antigo em memória (os módulos ESM são carregados uma vez por processo). Para
encerrá-lo: `npm run dev:stop` (ou `npm run dev:stop -- --listar` para só
listar os processos).

Para resolver isso em um comando só — encerrar os servidores antigos, subir um
novo desacoplado (sobrevive ao fim do comando), imprimir a URL e conferir que a
página responde 200:

```bash
npm run dev:restart
npm run dev:restart -- --port 4000   # porta fixa
```

A saída é um JSON com `url`, `pid`, `statusRaiz` e o status de cada ativo
estático. O log do servidor fica em `%TEMP%\osint-dev-server.log`.

## Verificação contínua

- `.github/workflows/ci.yml` roda `check`, `test`, `build` e a prova de
  idempotência do build (`npm run check:build`) a cada push ou pull request.
- `.github/workflows/deploy.yml` publica o Worker **somente** por despacho
  manual e exige confirmação digitada mais os segredos
  `CLOUDFLARE_API_TOKEN` e `CLOUDFLARE_ACCOUNT_ID`.
