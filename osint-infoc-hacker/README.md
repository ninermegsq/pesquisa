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

## Arquivos

```text
/
├─ public/
│  ├─ index.html
│  ├─ obrigado.html
│  ├─ favicon.svg
│  └─ _headers
├─ netlify/functions/
│  ├─ token.js
│  └─ scan.js
├─ netlify.toml
├─ package.json
├─ .gitignore
└─ README.md
```

## Variáveis de ambiente

| Variável | Obrigatória | Finalidade |
| --- | --- | --- |
| `HMAC_SECRET` | Sim | Segredo HMAC-SHA256, aleatório e forte, usado para assinar tokens de scan. |
| `TURNSTILE_SECRET` | Sim | Chave **secreta** do Cloudflare Turnstile, verificada no servidor. |
| `TURNSTILE_SITE_KEY` | Sim | Chave **pública** do widget do Turnstile. Obtida por GET na Function `/token`; **não** é segredo. |
| `ALLOWED_ORIGINS` | Sim | Origens HTTP(S) exatas, separadas por vírgula. Ex.: `https://site.netlify.app,https://seudominio.com`. |
| `EMAILREP_KEY` | Não | API key opcional da EmailRep. Sem ela a checagem EmailRep aparece como indisponível. |
| `GITHUB_TOKEN` | Não | Token opcional de leitura da API GitHub; configure com `wrangler secret put GITHUB_TOKEN`. Sem ele, GitHub aparece indisponível. A resposta é cacheada por e-mail durante 24 horas. |
| `AWS_LAMBDA_JS_RUNTIME` | Conforme plano/ambiente | Caso necessário na Netlify, valor `nodejs20.x` para selecionar explicitamente runtime das Functions. |

**Nenhum segredo aparece no HTML.** A site key do Turnstile foi criada para divulgação pública; é impossível validar o Turnstile usando apenas o segredo no servidor sem configurar um widget no cliente.

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

## Funcionamento e privacidade

- `token.js` / rota Worker `/token`: checa Turnstile, assina token HMAC de uso único com TTL de 60 segundos e o vincula ao IP e ao SHA-256 do e-mail. O nonce consumido fica no KV; `GET` expõe apenas a site key pública com cache de 24 horas.
- `scan.js` / rota Worker `/scan`: exige `Origin` autorizada e token de uso único. Limita cada IP a 10 scans por hora e 60 por dia, respondendo `429` com `Retry-After`; faz consultas externas no servidor com timeout e fallback.
- O cache usa uma chave SHA-256 do e-mail e guarda os resultados por **até 24h**. O Netlify Blobs **não fornece expiração automática nativa**: o código valida timestamps ao ler, e dados antigos podem permanecer fisicamente armazenados até uma rotina de limpeza. Configure uma política de retenção e exclusão para produção de grande escala.
- O limitador de IP no Netlify Blobs tem consistência forte, mas **não é atômico** sob concorrência elevada. Para cotas rígidas, configure também limitação por WAF/Edge.
- A verificação da senha é independente: SHA-1 feito em WebCrypto localmente, envio só dos cinco primeiros caracteres do hash para `api.pwnedpasswords.com`, comparação local do sufixo. **A senha em texto puro não é enviada.**
- O aplicativo não executa analytics nem instala cookies. Entretanto **não é correto prometer ausência absoluta de registros ou retenção**: Netlify, Cloudflare e fornecedores externos podem manter logs. O texto de interface `zero log` é um slogan fornecido na especificação, **não uma garantia técnica auditada**; revise a comunicação pública antes de lançar.
- O scanner permite a consulta de informações públicas; utilize somente endereços próprios ou com autorização. Não armazena ou apresenta credenciais em texto puro.

## Limites conhecidos

- **XposedOrNot:** cerca de **100 chamadas/dia por IP** para os endpoints usados (além de limites por hora), conforme a [documentação oficial](https://xposedornot.com/api_doc).
- **GitHub:** a consulta só é feita quando `GITHUB_TOKEN` está configurado; sem ele, `availability.github` fica `false`. O resumo é cacheado por e-mail no KV durante 24 horas para reduzir chamadas compartilhadas.
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
