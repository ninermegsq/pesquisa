# Troca de provedores — 2026-10-30

Estado: código candidato; não promovido a produção. Nenhum novo scan foi executado no Worker bloqueado.

## Provedores dos alvos novos: CPF, placa e nome (2026-11-11)

As cinco fontes novas (CPF, placa e nome completo) foram escolhidas a partir
da pesquisa em repositórios open source de OSINT e das sondas de rede
(`verification/probe-novos-provedores.mjs` — `npm run probe:novas` —,
`verification/probe-placa-rotas.mjs` — `npm run probe:placa-rotas` —,
`verification/probe-alcance-gov.mjs` — `npm run probe:alcance` — e
`verification/probe-consultarplaca-doc.mjs` — `npm run probe:placa-doc`).
Nenhuma das sondas grava algo no projeto.

| Provedor | Fonte | Papel | Estado medido em 2026-11-11 |
| --- | --- | --- | --- |
| BrasilAPI `GET /api/cpf/v1/{cpf}` | `cpf_brasilapi` | situação do CPF na base pública | **vivo e medido**: 200 em 272 ms (`11144477735`), 200 em 44 ms com `isValid:false` (`11111111111`), 200 em 109 ms (`52998224725`) |
| GitHub, GitLab, Hacker News, Keybase, Dev.to | `nome_perfil` | perfis por nome de usuário derivado (Maigret) | **vivos e medidos**: 9 perfis em 2 usuários × 5 sites — 10 respostas válidas, 1 consulta sem perfil (dev.to 404), 0 indisponível |
| Consultar Placa v2 `GET https://api.consultarplaca.com.br/v2/consultarPlaca?placa=…` | `placa_consultarplaca` | cadastro público do veículo | **vivo, com Basic Auth obrigatório**: 401 sem credencial e 401 com credencial inválida; a documentação é pública e responde 200 |
| SINESP `cidadao.sinesp.gov.br` | — | — | **inacessível desta máquina**: resolve para 189.9.194.154, mas `UND_ERR_CONNECT_TIMEOUT` nas portas 443, 80 e 8443, enquanto Receita (200), gov.br (301) e Detran-SP (302) respondem |
| API-Carros `apicarros.com` (rota do pacote `sinesp-api`) | `placa_sinesp` (desativada) | cadastro público do veículo | **morta**: o domínio está estacionado (103.224.182.242) e responde HTTP 200 sem JSON |
| FIPE `veiculos.fipe.org.br/api/veiculos/v1/placa/...` | — | — | **descartada como provedor**: as rotas de placa responderam 404 (a raiz do site responde 200) |
| Tabela FIPE Brasil `www.tabelafipebrasil.com` | — | — | **descartada**: HTTP 403 atrás do desafio do Cloudflare ("Just a moment...") |
| SOAP do SERPRO `soap.ws.placa.service.sinesp.serpro.gov.br` | — | — | **descartada**: o host não resolve (ENOTFOUND) |

O provedor da placa passou a ser a **API Consultar Placa v2**. O contrato foi
lido na documentação oficial do próprio provedor
(`https://docs.consultarplaca.com.br/llms.txt` e as páginas `.md`), não
inferido: **Basic Auth**, com o **e-mail da conta como usuário e a api_key como
senha**; `GET /v2/consultarPlaca?placa=…`; sucesso em HTTP 200 com
`status:"ok"`, `data_solicitacao` e `dados.informacoes_veiculo.dados_veiculo`
(placa, chassi, modelo, marca, anos, cor, segmento, espécie, combustível,
procedência, município, UF) e `dados_tecnicos` (tipo de veículo, sub-segmento,
potência, cilindradas). Erros vêm em `status:"erro"` com `tipo_do_erro`:
`placa_nao_encontrada`, `chassi_nao_encontrado`, `informacao_nao_encontrada`,
`servico_indisponivel` e `credito_insuficiente`. O limite declarado é de **120
requisições por minuto** e a consulta avulsa de informações básicas custa
**R$ 0,31** (1 a 1.000 consultas/mês; R$ 0,25 com pacote de créditos).

O provedor do CPF é a **BrasilAPI**, que expõe `GET /api/cpf/v1/{cpf}` sem
autenticação. O que ela **não** faz foi medido: o provedor devolve
`{cpf, isValid, rf, ufs}` — **sem nome, nascimento, filiação ou endereço** — ou
`{isValid:false}`, ou 404. A fonte publica exatamente o que recebeu: quando o
provedor valida os dígitos mas não afirma se o CPF existe, `existe` fica
**nulo**, e não vira "não existe" nem "existe". O 404 significa "o CPF não
consta na base consultada" e vira `existe:false` com observação explícita —
**ausência na base não é prova de inexistência**. A fonte `cpf_valida` faz a
validação dos dígitos verificadores localmente, sem rede, e é ela que
sinaliza que um CPF é de teste.

Para o nome, a técnica portada é a do **Maigret** (o repositório de busca por
nome completo mais usado da comunidade): o nome vira candidatos de nome de
usuário e cada candidato é consultado em cinco sites públicos. Nenhum cadastro
é feito e nenhuma conta é criada. O limite é deliberado: **2 usuários × 5
sites = 10 subrequests**, dentro do orçamento de 38 do scan.

O que os provedores **não** entregam, e o código declara no próprio resultado:

- Nenhum provedor de placa devolve o **titular** do veículo. A fonte
  `placa_consultarplaca` entrega modelo, marca, ano, cor, município/UF e dados
  técnicos, e diz no `observacao` que o provedor não informa o dono. (O
  provedor tem uma rota separada de "proprietário atual", que custa R$ 6,90 e
  não faz parte desta fonte.)
- Um perfil com o mesmo nome **não** prova identidade. `nome_perfil` registra
  isso no resultado.
- O provedor de placa só aceita os formatos `AAA0000` e `AAA09A00`. O
  detector local reconhece `LLLNLNN` (Mercosul) e `LLLNNNN`; uma placa
  Mercosul chega ao provedor e é recusada com HTTP 400 ("Placa informada é
  invalida…"). A fonte repassa o erro do provedor, sem inventar dado.

**Aceite com rede real (2026-11-11):** executado em
`verification/aceite-novos-alvos.mjs` (`npm run aceite:novos-alvos`) — **9 de
9 alvos conformes, 0 divergentes**. Ele mede os três caminhos da fonte de
veículo: sem credencial (a fonte responde `sem_chave` **sem** chamar a rede),
com credencial inválida (o provedor responde **HTTP 401**, o que prova que o
Basic Auth chega nele) e com a credencial do operador (sem conta do operador
neste ambiente, a fonte volta a responder `sem_chave` — o caminho de sucesso
**segue sem prova**). A placa de teste gratuita do provedor é a `AAA0000`,
que devolve dados fictícios sem consumir crédito.

Correções que o aceite obrigou: o parser da BrasilAPI (falha em toda resposta
real, porque exigia `nome`/`nascimento`), a troca do provedor de placa (o
anterior estava morto) e a rota do Keybase (`/_api/1.0/…` → `/_/api/1.0/…`).
O detalhe está em `verification/status.md`.

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

A credencial do CNPJ.ws comercial saiu do projeto: a fonte `cnpj_br` usa
sempre a base pública (`publica.cnpj.ws`), sem cabeçalho de credencial, e o
manifesto voltou a declarar `requer: null` para ela — a ausência de
credencial não vira `sem_chave`/`sem_token`. O manifesto continua sendo a fonte da verdade — o
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
