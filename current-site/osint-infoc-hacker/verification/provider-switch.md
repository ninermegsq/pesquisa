# Troca de provedores — 2026-10-30

Estado: código candidato; não promovido a produção. Nenhum novo scan foi executado no Worker bloqueado.

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
- `cnpj_br`: Minha Receita substitui BrasilAPI. O adaptador foi executado contra a resposta HTTP 200 salva e manteve o formato. Proveniência atualizada para `minha-receita-cnpj`.
- `crtsh`: Subdomain Center substitui crt.sh, id mantido para compatibilidade. Proveniência `subdomain-center`; parser de array de strings deduplica, limita a 60 e rejeita nomes fora do domínio. Teste de parsing usa fixture e não comprova disponibilidade real. A resposta 503 salva preservou corpo/status no erro.
- A documentação oficial do Subdomain Center informa amostra anônima de até 500 nomes e limite anônimo de 5 chamadas/minuto/IP; o relatório limita essa amostra a 60. Não representa enumeração completa.
- Nenhuma fonte foi movida ao browser ou removida: não houve 1010 observado nos provedores alternativos neste ambiente. O fallback CNPJ.ws fica condicionado a 1010 confirmado em Minha Receita, que ainda não ocorreu no teste disponível.

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
