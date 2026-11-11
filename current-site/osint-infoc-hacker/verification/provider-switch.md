# Troca de provedores — 2026-10-30

Estado: código candidato; não promovido a produção. Nenhum novo scan foi executado no Worker bloqueado.

## Provedores dos alvos novos: CPF, placa e nome (2026-11-11)

As cinco fontes novas (CPF, placa e nome completo) foram escolhidas a partir
da pesquisa em repositórios open source de OSINT e da sonda
`verification/probe-novos-provedores.mjs` (`npm run probe:novas`), que mede
os candidatos e **não** grava nada no projeto.

| Provedor | Fonte | Papel | Estado do aceite |
| --- | --- | --- | --- |
| BrasilAPI `GET /api/cpf/v1/{cpf}` | `cpf_brasilapi` | cadastro público do CPF | **pendente** de rede real nesta rodada |
| SINESP / API-Carros `GET https://apicarros.com/v1/consulta/{placa}/json` | `placa_sinesp` | cadastro público do veículo | **pendente** de rede real nesta rodada |
| GitHub, GitLab, Hacker News, Keybase, Dev.to | `nome_perfil` | perfis por nome de usuário derivado (Maigret) | **pendente** de rede real nesta rodada |
| FIPE `veiculos.fipe.org.br/api/veiculos/v1/placa/...` | — | — | **descartado** como provedor: as rotas responderam 404 |

O provedor da placa é o **SINESP**, na rota usada pelo pacote open source
`sinesp-api` (o mesmo endpoint que os repositórios de consulta de placa
usam). O parser segue o formato documentado dessa API: o veículo vem em
`data.vehicle` (com `vehicle` aceito como alternativa) e traz modelo, ano,
cor, município e UF. O **FIPE foi medido** antes: `v1`, `v2`, com e sem
hífen, e a rota de placa inexistente responderam **404**; as rotas de marca e
modelo também. Ele ficou somente como link de consulta humana dentro de
`placa_footprint`.

O provedor do CPF é a **BrasilAPI**, que expõe `GET /api/cpf/v1/{cpf}` sem
autenticação. O 404 da API significa "o CPF não consta na base consultada" e
vira `existe:false` com observação explícita — **ausência na base não é
prova de inexistência**. A fonte `cpf_valida` faz a validação dos dígitos
verificadores localmente, sem rede, e é ela que sinaliza que um CPF é de
teste.

Para o nome, a técnica portada é a do **Maigret** (o repositório de busca por
nome completo mais usado da comunidade): o nome vira candidatos de nome de
usuário e cada candidato é consultado em cinco sites públicos. Nenhum cadastro
é feito e nenhuma conta é criada.

O que os provedores **não** entregam, e o código declara no próprio resultado:

- Nenhum provedor público de placa devolve o **titular** do veículo. A fonte
  `placa_sinesp` entrega modelo, ano, cor e município/UF do registro e diz no
  `observacao` que o provedor não informa o dono.
- Um perfil com o mesmo nome **não** prova identidade. `nome_perfil` registra
  isso no resultado.

**Aceite pendente:** a máquina estava **sem internet** durante a implementação
deste bloco. O contrato foi verificado offline
(`verification/novos-alvos-check.mjs`, na cadeia do `npm test`), mas as
respostas reais dos provedores acima **não** foram observadas nesta rodada.
Para concluir o aceite:

```bash
npm run probe:novas   # sonda dos provedores candidatos (CPF, placa, nome, sites de perfil)
npm run probe:live    # sonda de rede real de todas as 32 fontes (inclui cpf e placa)
```

## Troca do provedor de CNPJ: CNPJ.ws na frente (2026-11-10)

O provedor de CNPJ passou a ser o **CNPJ.ws**, com o Minha Receita de reserva.
O endpoint público (`GET https://publica.cnpj.ws/cnpj/{cnpj}`) não exige
autenticação e devolve o estabelecimento completo — razão social, CNAE, situação
cadastral, endereço, e-mail e telefone — mais a lista de sócios.

Medições com rede real, neste ambiente:

| Chamada | HTTP | Resultado |
| --- | --- | --- |
| `GET https://publica.cnpj.ws/cnpj/00000000000191` | 200 | Cadastro do Banco do Brasil com `situacao_cadastral: "Ativa"`, 183–436 ms |
| 4ª chamada dentro do mesmo minuto | 429 | `retry-after: 60`; cabeçalhos `x-ratelimit-limit` / `x-ratelimit-remaining` / `x-ratelimit-reset` |
| `GET https://publica.cnpj.ws/cnpj/00000000000000` (CNPJ inválido) | 400 | Corpo `CNPJ inválido` |
| `GET https://comercial.cnpj.ws/cnpj/00000000000191` sem token | 401 | A base paga exige token |
| `GET https://comercial.cnpj.ws/cnpj/00000000000191` com token inválido | 401 | Idem |

A base pública funciona e é mais completa que o Minha Receita (traz e-mail e
telefone do estabelecimento, que viram pivos de e-mail e telefone), mas aceita
**3 consultas por minuto por IP** — e a saída do Worker é compartilhada. A
fonte `cnpj_br` foi reescrita para consultar o CNPJ.ws primeiro e cair no
Minha Receita quando o primário falha (429, 5xx, timeout ou formato
inesperado). `existe:false` só sai quando **os dois** provedores dizem que o
CNPJ não existe. A proveniência ficou `cnpj-ws-publica+minha-receita-cnpj` e o
custo da fonte é 2 (dois provedores possíveis).

O token comercial (`CNPJWS_TOKEN`) é **opcional**: quando existe, a consulta
vai para `comercial.cnpj.ws` com o cabeçalho `x_api_token`; sem ele, a base
pública continua sendo usada. Para o manifesto, isso é um campo novo,
`requer.opcional`: a credencial só melhora o resultado e a sua ausência não
vira `sem_chave`/`sem_token`. O manifesto continua sendo a fonte da verdade — o
carregamento do módulo falha se a implementação e o manifesto divergirem, e a
divergência agora distingue `exigirCredencial(` (obrigatória) de
`credencialOpcional(` (melhoria).

Na sonda de rede real das 24 fontes (`npm run probe:live`), a fonte respondeu
`publica.cnpj.ws` com HTTP 200 em 487 ms, `situacao=Ativa`, sem precisar do
reserva:

```json
{"id":"cnpj_br","tipo":"cnpj","alvo":"00000000000191","status":"ok","resumo":"situacao=Ativa","http":[{"host":"publica.cnpj.ws","status":200}],"ms":487}
```

Limitação declarada: a execução no edge (saída do Worker no Cloudflare) segue
sem prova; a medição de 429 por IP foi feita nesta máquina.

## Atualização (2026-11-10): sonda de rede real das 24 fontes

Os testes do projeto são todos **offline** (eles substituem `globalThis.fetch`
pelas fixtures) e, por isso, não provavam disponibilidade dos provedores. Foi
criada uma sonda de rede separada (`verification/live-source-probe.mjs`,
atalho `npm run probe:live`, fora da suíte offline) que chama cada fonte com
rede real.

Resultado da primeira passagem (27 consultas):

```json
{"consultas":27,"responderam":18,"falharam":5,"bloqueadas_por_credencial":["github","emailrep","ceis","datajud"]}
```

As 5 falhas reais e a causa encontrada por diagnóstico ao vivo:

| Fonte | Sintoma | Causa comprovada | Correção |
| --- | --- | --- | --- |
| `gitlab` | HTTP 403 `Not authorized to access /api/v4/users` | A rota `GET /api/v4/users?search=` exige autenticação; o GraphQL de `users` também exige permissão. A busca pública que responde é a de **projetos** (`projects(search:)`), que alcança o e-mail publicado na descrição/README do projeto | Rota trocada para o GraphQL de projetos; proveniência `gitlab-users-api` → `gitlab-graphql-search` (manifesto + implementação juntos) |
| `crtsh` | timeout de 9 s (dois alvos) | O Subdomain Center responde, mas em 0,3 s a 19 s (medido) e às vezes devolve 503 `server busy (64 queries in flight)` | Timeout de 9 s → 20 s. O 503 continua sendo falha real |
| `wayback` | HTTP 503 `Internet Archive: Temporarily Offline` (e-mail) e timeout (domínio) | A listagem de URLs (CDX) está degradada; a API de disponibilidade responde em ~0,6 s | Cada chamada da listagem passa a cair em `archive.org/wayback/available`, com TTL próprio de 900 s, para retomar a listagem completa em breve |

O diagnóstico ainda encontrou um **bug de ruído** na fonte `npm` (não era uma
falha de rede): a busca textual devolvia o total cru do provedor
(`total: 34489` para qualquer e-mail inexistente), o que viraria uma
pontuação alta sem nenhum dado real. A fonte passou a contar e listar apenas
os pacotes cujo mantenedor (`package.maintainers`) usa exatamente o e-mail
consultado.

Resultado da segunda passagem, depois das correções (27 consultas):

```json
{"consultas":27,"responderam":23,"falharam":0,"bloqueadas_por_credencial":["github sem_token","emailrep sem_chave","ceis sem_chave","datajud sem_chave"]}
```

Nenhuma das 23 consultas que respondeu depende de segredo do operador; as 4
restantes são as fontes que declaradamente exigem credencial opcional e
respondem `sem_chave`/`sem_token` sem marcar o relatório como parcial.

Leituras positivas confirmadas com rede real:

- `gitlab`: `projects(search: "<e-mail publicado>")` devolveu o projeto que
  publica o e-mail na descrição (HTTP 200, ~0,6 s). Com um e-mail inexistente
  devolve `total=0`.
- `npm`: para `sindresorhus@gmail.com` a busca devolveu `total=18577` do
  provedor, dos quais 48 dos 50 pacotes lidos têm este mantenedor
  (`somebody`, `type-fest`, `email-regex`, `execa`, `@sindresorhus/is`, …);
  para `ljharb@gmail.com`, 49 de 50. Para `teste@example.com`, 0.
- `crtsh`: 200 em 0,3 s (domínio) e 0,4 s (e-mail).
- `wayback`: o CDX respondeu 200 em 7,2 s (domínio) e caiu no fallback de
  disponibilidade em 20,8 s (e-mail) — ou seja, os dois caminhos foram
  exercitados.

A fonte `xon` foi conferida separadamente porque reportou 9 brechas para
`teste@example.com`: é o provedor respondendo isso mesmo (corpo com
`"breaches":[["Nitro","Canva",...]]`, HTTP 200); para `admin@ostnt.online` e
para `nao-existe-zzz@exemplo.com` o mesmo endpoint devolve
`{"Error":"Not found"}` e a fonte reporta 0. Ou seja, o rótulo novo está
correto: ele reflete o que o provedor informa.

Limitação declarada: a sonda roda **neste ambiente de execução**, não pela
saída do Worker no Cloudflare, e não substitui o item 2 da lista
“ainda obrigatório”. A execução no edge continua não validada.

## Evidência anterior (2026-10-30)

Todas as chamadas HTTP abaixo usaram curl e o mesmo UA identificado: `ostnt.online scanner (+https://ostnt.online)`. Estes resultados pertencem ao ambiente local de execução, não à saída de rede do Worker.

| Endpoint | HTTP | Corpo/resultado | Classificação |
| --- | --- | --- | --- |
| https://www.anatel.gov.br/dadosabertos/PDA/Codigo_Nacional/PGCN.csv | 200 | CSV, 5565 registros; 67 DDDs | Snapshot de dados estáticos obtido |
| https://minhareceita.org/11222333000181 | 200 | JSON válido de CNPJ, com qsa e campos cadastrais | Provedor alternativo respondeu neste ambiente |
| https://api.subdomain.center/?domain=ostnt.online | 503 | `{"error": "server busy (64 queries in flight)"}` | Indisponibilidade temporária; não é 1010 |

## HEAD de CORS

Comandos executados com `-sSI --max-time 20`, `Origin: https://ostnt.online` e UA identificado. Linhas de status abaixo excluem o 200 do túnel do proxy.

crt.sh, URL `https://crt.sh/?q=%25.exemplo.com&output=json`:

```text
HTTP/2 502
```

Saída do filtro `access-control`: vazia. A resposta 502 observada não comprova a política de CORS de uma resposta normal do endpoint.

BrasilAPI CNPJ, URL `https://brasilapi.com.br/api/cnpj/v1/11222333000181`:

```text
HTTP/2 200
access-control-allow-origin: *
```

Essa evidência aplica-se ao endpoint de CNPJ; não classifica o antigo endpoint DDD.

## Código e testes

- `ddd`: custo 0; todos os 67 DDDs executados localmente com fetch e Cache API proibidos pelo teste. Resultado: zero chamadas. Snapshot preserva todas as cidades fornecidas e UFs múltiplas quando presentes; a UF principal é DF no 61 e a UF majoritária nos demais. Não infere localização atual de um telefone.
- `cnpj_br`: CNPJ.ws na frente e Minha Receita de reserva (o Minha Receita substituiu a BrasilAPI antes). Proveniência `cnpj-ws-publica+minha-receita-cnpj`, custo 2. O adaptador normaliza os dois formatos para o mesmo contrato e limita a lista de sócios a 20 no relatório, mantendo o total do cadastro.
- `crtsh`: Subdomain Center substitui crt.sh, id mantido para compatibilidade. Proveniência `subdomain-center`; parser de array de strings deduplica, limita a 60 e rejeita nomes fora do domínio. Teste de parsing usa fixture e não comprova disponibilidade real. A resposta 503 salva preservou corpo/status no erro.
- A documentação oficial do Subdomain Center informa amostra anônima de até 500 nomes e limite anônimo de 5 chamadas/minuto/IP; o relatório limita essa amostra a 60. Não representa enumeração completa.
- Nenhuma fonte foi movida ao browser ou removida: não houve 1010 observado nos provedores alternativos neste ambiente. O CNPJ.ws deixou de ser um fallback condicionado a 1010 em Minha Receita: ele virou o provedor primário, com o Minha Receita como reserva para o limite de 3 consultas por minuto/IP da base pública.

## Pendências reais

Confirmar respostas pela saída do Worker e capturar corpo/id nesse ambiente. A rejeição anterior bloqueou mudar de cliente após 403/1010 no acesso ao Worker de validação; essa observação não prova 1010 de uma fonte. O relato externo de A/B negativo de UA não foi reproduzido aqui nem prova isoladamente a causa do bloqueio.

## Rechecagem no mesmo cliente e UA

Nova chamada de `curl` ao mesmo endpoint `https://api.subdomain.center/?domain=ostnt.online`, com UA identificado e timeout de 20 segundos: exit code 28, status de destino `000`, zero bytes recebidos. A linha HTTP 200 disponível pertence exclusivamente ao túnel do proxy. Não houve corpo da API a registrar nesta tentativa. Não é evidência de 1010 nem de ausência de CORS. Não houve troca de cliente ou UA entre essas tentativas.

Consulta autenticada à API de gerenciamento Cloudflare confirmou no Worker `ostnt-validation`: `enabled: false`, `previews_enabled: false`; bindings `CACHE`, `GITHUB_TOKEN` e `TOKEN_GUARD`. UA_MODE/UA_NAVEGADOR preparados no arquivo de configuração ainda não estão instalados nesse Worker. Essa consulta não executou nenhuma fonte.

O aceite de rede das fontes foi refeito depois das correções (ver o topo
deste arquivo: 27 consultas, 23 responderam e 0 falharam). O aceite no
**edge** do Cloudflare segue incompleto: não há execução comprovada do motor
na saída do Worker de produção. Remoção ou migração ao browser por 1010 não
foi acionada, pois não se observou 1010 nos provedores alternativos.
