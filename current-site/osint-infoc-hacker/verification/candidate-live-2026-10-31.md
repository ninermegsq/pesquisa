# Validação real da candidata — 31/10/2026

Escopo: consultas reais pela interface autenticada em https://validation.ostnt.online/, Worker de validação e61c604307cb42d8b1f4ab7fc74ae8d7. Não são fixtures nem a versão antiga em produção. Captura baseada no relatório visível; códigos HTTP de cada fonte são os preservados pelo motor, não medição do status HTTP externo do /api/scan no Network.

## E-mail — 12 fontes, relatório concluído e parcial

| id | Resultado observado | Evidência |
|---|---|---|
| gravatar | ok | existe: não |
| pgp | ok | existe: não |
| gitlab | erro | HTTP 403: {"message":"403 Forbidden - Not authorized to access /api/v4/users"} |
| npm | ok | 0 correspondências exatas em amostra de 5; busca ampla 11201 |
| bluesky | ok | 0 menções literais em amostra de 5 |
| hudsonrock | ok | infectado: não; máquinas 0 |
| github | ok | 0 contas; token configurado respondeu |
| emailrep | erro | sem chave |
| crtsh | timeout | The operation was aborted due to timeout |
| wayback | timeout | The operation was aborted due to timeout |
| xon | erro | Formato XposedOrNot inesperado; corpo ainda não capturado |
| dns | ok | A/MX/TXT, SPF e DMARC renderizados |

Evento real de download JSON confirmado. Os resultados não demonstram identidade ou ausência universal de vazamentos.

## Domínio — 6 fontes, relatório concluído e parcial

| id | Resultado observado | Evidência |
|---|---|---|
| crtsh | erro | HTTP 503: {"error": "server busy (64 queries in flight)"} |
| wayback | timeout | The operation was aborted due to timeout |
| rdap | erro | HTTP 403, HTML; os primeiros 200 caracteres ficaram no relatório |
| observatory | ok | B+, score 80, 1 falho/11 aprovados |
| urlscan | ok | total 0 |
| dns | ok | A presente; MX/TXT ausentes, SPF/DMARC não encontrados |

Evento real de download CSV confirmado. Não houve 1010 explícito nesses relatórios. Não inferir 1010 do HTML RDAP truncado. Nenhuma classificação é agrupada por provedor.

## IP — 3 fontes, relatório concluído e parcial

| id | Resultado observado | Evidência |
|---|---|---|
| internetdb | ok | portas e hostnames renderizados |
| ipgeo | erro | HTTP 429: {"success":false,"message":"Rate limit exceeded","upgrade_url":"https://ipwhois.io/upgrade"} |
| asn | ok | ASN 15169, prefixo 8.8.8.0/24 |

Não houve retry da fonte em 429.

## CNPJ — 2 fontes, relatório concluído e parcial

| id | Resultado observado | Evidência |
|---|---|---|
| cnpj_br | ok | Minha Receita retornou razão, situação, CNAE e demais campos no formato esperado |
| ceis | erro | sem chave |

## Telefone fictício — 2 fontes, relatório concluído

| id | Resultado observado | Evidência |
|---|---|---|
| ddd | ok | DDD 11, SP e 64 municípios renderizados, fonte local sem rede |
| telegram | ok | existe: não no número fictício; parser executado no runtime real |

Aguardar render após clique foi necessário; um timeout da automação esperando botão não era timeout de fonte nem falha do scan.

## Nome genérico — 2 fontes, relatório concluído e parcial

| id | Resultado observado | Evidência |
|---|---|---|
| wikidata | erro | HTTP 403, HTML Wikimedia Error; corpo truncado no relatório |
| datajud | ok | total 0, processos vazios, sem erro 500 |

Os seis tipos e as 24 fontes foram exercitados. São 15 fontes com resposta interpretada e 9 com erro/timeout/chave ausente nesta rodada; isso não prova disponibilidade universal. Nenhuma fonte foi retirada ou declarada permanentemente bloqueada com base numa única rodada. Não houve 1010 explícito.

### Correção XON em andamento

Documentação oficial https://xposedornot.com/api_doc descreve {"Error":"Not found","email":null} como resposta de ausência. Adicionado tratamento explícito desse envelope, sem converter erros genéricos em ausência; proveniência versionada. Ainda requer repetição real para comprovar qual envelope a fonte devolve neste caso.

## Reteste após correção XON

- Candidata 4c6fc554202947adafdf956aa44bc07e implantada HTTP 200 somente em validação. Scan de e-mail concluiu; XON passou para resposta interpretada com total 0 e métricas de senhas indisponíveis. Isso confirma a correção do parser no caso real, sem inventar zeros para métricas não fornecidas.
- Repetição imediata do mesmo scan exibiu cache nos 12 acordeões de fontes, inclusive erros/timeouts. Primeiro uso da nova proveniência XON não usou o resultado anterior incompatível.
- Situação por fonte após reteste: 16 fontes responderam de forma interpretável; 8 permanecem com falha, timeout ou credencial ausente (gitlab, emailrep, crtsh, wayback, rdap, ipgeo, ceis, wikidata). Não afirmar que as 24 estão saudáveis.
- Telegram repetido exibiu cache; DDD não tem selo de cache porque é leitura local de custo zero.

## Quota real pela interface

Contagem de consultas concluídas nesta sessão/IP: e-mail, domínio, IP, CNPJ, telefone, nome, reteste e-mail, repetição e-mail, telefone, telefone = 10. A próxima tentativa exibiu “Limite atingido (10 scans por hora ou 60 por dia).” Não foram feitas novas consultas após a recusa. Isso comprova comportamento visível do limite horário no Worker implantado. O status/header Retry-After não foi capturado pelo Network nesta etapa; replay e limite diário continuam com prova apenas local. Não zerar contador nem trocar IP para contornar quota.

## Aceites ainda pendentes

- Resolver ou reclassificar as oito fontes com falhas; credenciais EmailRep/Transparência não disponíveis neste ambiente.
- Replay com mesmo token e Retry-After documentados na borda, além da expiração temporizada do cache de erros; os testes locais já passaram.
- Lighthouse mobile, beacon Network e todos os headers da versão candidata.
- TXT fallback está ausente da UI (há JSON/CSV); precisa implementação e validação.
- Versão com chaves reais e teste humano final antes de produção. Dummy está restrito à validação com Access.
