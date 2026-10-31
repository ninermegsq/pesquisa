# Revisão atual — código candidato

Sem promoção em produção. Este documento substitui os resumos de estado anteriores; os demais registros são históricos.

## Correções verificadas localmente

- Emissão de token com escopo correto da sitekey e cache legado com origin/argumentos corretos.
- Trava contra sitekey/secret de teste em produção; validação de hostname e par de chaves; suporte explícito à resposta dummy localhost apenas no ambiente de validação.
- Cotas persistentes e replay coordenados no mesmo Durable Object SQLite. KV recebe somente os dois espelhos de contadores; não é usado como cache de fontes. Cotas concorrentes não dependem da consistência eventual do KV.
- Validação de entrada com IP real, domínio por label, limites de tamanho, normalização brasileira de telefone e correção de DDD nacional 55.
- Erros HTTP preservam até 200 caracteres, relatório até 220; erros e timeouts duram 120s em cache. Troca de proveniência invalida resultado anterior. Fontes fora do orçamento são declaradas em meta.omitidas e deixam score parcial.
- Sem nenhuma fonte disponível, score INCONCLUSIVO. HTTP 503 do Telegram não vira falso resultado de conta inexistente.
- Frontend exibe mensagens error/erro, preserva os oito dorks, exporta JSON completo e CSV com severidade informativa, proveniência e timestamp. Fórmulas CSV são neutralizadas. Contagem de achados não é contagem de campos do CSV.
- Endpoint Observatory atualizado para POST /api/v2/scan no domínio oficial MDN. Diagnóstico GitHub distingue 401 de cota comprovada; outros erros mantêm status/corpo.
- Card renderizado a partir de og.html: og.jpg 1200x630, JPEG qualidade 88, 69609 bytes. Revisão visual confirmou "vazou" e "INFOC" e margens. PNG de renderização excedeu 300 KB, portanto adotado JPEG conforme especificação.

## Evidência de testes

### Runtime workerd local (Miniflare)

Todas as chamadas externas são fixtures explícitas, não consultas públicas nem evidência de borda. Worker, RPC do Durable Object SQLite e Cache API são executados pelo runtime local.

```text
BURST_RESULT {"accepted":10,"rejected":1,"scope":"local workerd, distinct tokens"}
```

```text
TTL_RESULT {"scope":"local workerd cache, not Cloudflare edge","first":"miss","immediate":"hit","after121seconds":"miss","errorBodyPreserved":true}
```

```text
RUNTIME_RESULT {"scope":"local workerd runtime; all upstream responses are fixtures","sixTypes":[{"tipo":"email","status":200,"fontes":12,"subrequests":16},{"tipo":"dominio","status":200,"fontes":6,"subrequests":9},{"tipo":"ip","status":200,"fontes":3,"subrequests":3},{"tipo":"cnpj","status":200,"fontes":2,"subrequests":2},{"tipo":"telefone","status":200,"fontes":2,"subrequests":1},{"tipo":"nome","status":200,"fontes":2,"subrequests":3}],"replay":429,"parallelReplay":[200,429],"eleventh":429,"retryAfter":true,"kvOnlyRateKeys":true}
```

A suíte também verifica arquivos públicos, token ausente, chaves KV somente de rate limit e mensagens com corpo. O teste de quota em Node SQLite com relógio controlado confirmou 10/hora, 60/dia, Retry-After diário e reset no novo dia; ele não simula passagem real de 24 horas na borda.

Frontend em VM com DOM/fetch simulados: JSON completo, CSV protegido, dorks, mensagens do backend e contagem de achados passaram. Testes de fontes cobriram 404 válidos, resposta HTML 200 rejeitada, DataJud 400 com um fallback, token GitHub inválido/quota, captura de corpo e modos de UA.

### Chamadas diretas reais pelo terminal

Esses resultados usam Node fetch identificado neste ambiente, não o IP do Worker. Não houve mudança de cliente para repetir um 1010. Não há evidência aqui de 1010 de fontes pela saída do Worker.

| ID | Resultado direto | Produção desta revisão |
| --- | --- | --- |
| gravatar | timeout | Não publicada |
| pgp | timeout | Não publicada |
| gitlab | timeout | Não publicada |
| npm | timeout | Não publicada |
| bluesky | timeout | Não publicada |
| xon | timeout | Não publicada |
| hudsonrock | timeout | Não publicada |
| github | erro (sem chave neste teste local; GitHub já configurado no Worker isolado) | Não publicada |
| emailrep | erro (sem chave neste teste local; GitHub já configurado no Worker isolado) | Não publicada |
| dns | timeout | Não publicada |
| crtsh | erro / HTTP 503 | Não publicada |
| wayback | timeout | Não publicada |
| rdap | timeout | Não publicada |
| observatory | Endpoint antigo 404; substituído por MDN v2 (ver abaixo) | Não publicada |
| urlscan | timeout | Não publicada |
| internetdb | ok / HTTP 200 | Não publicada |
| ipgeo | timeout | Não publicada |
| asn | ok / HTTP 200 | Não publicada |
| cnpj_br | ok / HTTP 200 | Não publicada |
| ceis | erro (sem chave neste teste local; GitHub já configurado no Worker isolado) | Não publicada |
| ddd | ok | Não publicada |
| wikidata | ok / HTTP 200 | Não publicada |
| datajud | timeout | Não publicada |
| telegram | Não executado diretamente em Node; parser exige HTMLRewriter do runtime | Não publicada |

Nova chamada real POST ao MDN v2 para o próprio site: HTTP 200; grade B+, score 80, testes falhos 1. Isso não altera nem substitui a avaliação securityheaders.com.

Nenhum timeout foi convertido em prova de bloqueio ou erro permanente. Não foram removidas fontes com base nesses resultados locais. Não há fontes movidas para browser nesta revisão.

## CLI e bloqueios pendentes

Wrangler oficial instalado: 4.156.0. whoami retornou "You are not authenticated". O conector Cloudflare funciona, mas não fornece automaticamente a sessão ao CLI. GitHub permanece conectado; não é necessário reenviar ZIP.

A documentação oficial e o CLI alertam que Durable Objects SQLite não são suportados diretamente por dev --remote. Não reduzir a proteção para adequar o teste: a validação remota completa requer implantação isolada/autenticada adequada para SQLite, mantendo a produção separada. O dry run valida o pacote sem publicar; não prova execução na borda.

O 403/1010 do acesso ao Worker público de validação e a rejeição automática de repetir por outro cliente continuam registrados. Não foram feitos novos acessos a esse endpoint bloqueado nesta revisão. Autenticação oficial e qualquer operação remota posterior precisam respeitar esse bloqueio; não presumir que login elimina a restrição.

## Ainda necessário para o aceite

- Validar a versão isolada na borda com autenticação oficial e sem contornar a restrição anterior.
- Conferir fonte por fonte, incluindo GitHub autenticado e Telegram real; resolver indisponibilidades persistentes com evidência.
- Comprovar cache de borda, corpos de erro, expiração e limites no ambiente publicado.
- Confirmar downloads JSON/CSV no navegador e fluxo real Turnstile; teste local dummy não substitui essa prova.
- Confirmar beacon /cdn-cgi/rum 200 ou remover sua injeção na origem correta; medir Lighthouse mobile.
- Conferir dados e headers da versão publicada e somente então promover com chaves reais e rollback disponível.

## Retomada de 31/10/2026

- Build, sintaxe e todas as suítes unitárias passaram novamente.
- workerd local repetido com seis tipos, replay sequencial e paralelo, burst 10/11, Retry-After, apenas contadores em KV e cache miss → hit → miss após 121 segundos. As fontes externas continuam sendo fixtures neste teste.
- Wrangler 4.156.0: deploy --dry-run do candidato passou; nenhuma publicação executada.
- Candidato salvo na branch codex/ostnt-hardening-20261031, separado de main.
- workers_dev e preview_urls desativados também no arquivo de validação, para não reabrir entrada pública no próximo deploy.
- Criado KV exclusivo ostnt-validation-rate-limit (e97462664ae64aaab17374b2c3f4936d). Config local de validação usa esse namespace; produção mantém o namespace anterior. Binding CACHE do Worker ostnt-validation atualizado e relido pela API (HTTP 200); GITHUB_TOKEN e TOKEN_GUARD preservados. Nenhuma invocação do endpoint bloqueado foi feita.
- Persistem as pendências de execução na borda, fontes reais, Turnstile no navegador, beacon e Lighthouse; não são aceitas como concluídas por estes testes locais.

## Candidato implantado no Worker isolado — 31/10/2026

- Upload administrativo aceito HTTP 200 em ostnt-validation. deployment_id b9a410b9ac9a494e8d5b857c635332ea; etag 19753a9e16fe128d04b2ff9a12d9563c5bfb418ad4e2977b59a8c2c567b52d1f.
- Bundle de wrangler deploy --dry-run: 326602 bytes. Primeiro upload rejeitado por corrupção de caracteres na transferência; montagem corrigida e segundo upload aceito.
- Configuração relida HTTP 200: APP_ENV validation, UA_MODE navegador, CACHE exclusivo e TOKEN_GUARD; GITHUB_TOKEN preservado; HMAC e secret dummy instalados apenas no ambiente isolado. Observability habilitada com logs persistentes.
- workers.dev e previews continuam desativados após upload. Não houve invocação remota nem contorno do bloqueio anterior. Aceite de API não comprova scans, cache ou cotas na borda.
- Produção não recebeu código nem configuração deste candidato.
- Navegador conectado local indisponível. Teste funcional iniciado na página de produção pelo navegador cloud: formulário carregou e scan pediu checkbox Turnstile “Confirme que é humano”. Aguardando interação manual; nenhum resultado de scan confirmado nesta etapa. Isso testa a versão anterior em produção, não o candidato.

## Verificação humana concluída e regressão de correlação — 31/10/2026

- Após a confirmação humana pelo usuário, o scan de produção concluiu: 13 fontes processadas, relatório parcial. Esta continua sendo a versão anterior, não o candidato isolado.
- Eventos de download JSON e CSV confirmados no navegador; painel de senha abriu.
- Observação real: npm trouxe 11202 resultados de busca ampla e Bluesky perfis sem correspondência literal ao alvo. Não são vínculos comprovados. Corrigido no candidato: npm exige e-mail exato em author/publisher/maintainers; Bluesky exige menção literal do e-mail em texto público, sem afirmar titularidade. Totais passam a contar apenas correspondências da amostra examinada; proveniência versionada invalida cache anterior.
- Testes de regressão excluem registros alheios e prefixos de e-mail e preservam correspondência exata; suite de fontes, build e sintaxe passaram. Correção ainda não implantada.

### Atualização de implantação e teste de senha

- Correção de correspondência exata implantada somente em ostnt-validation: HTTP 200, deployment_id a17e35b1860346649e5f9d11799237cc, etag 5384fb19d5d3ce41f170d7db35e7853ef698d2bf93b1d7b047069adba1b60200. Bindings e secrets herdados da configuração de validação; nenhuma rota aberta.
- Painel de senha da produção testado com valor fictício: respondeu “não encontrada — isso não garante que a senha seja segura.” Downloads JSON e CSV geraram eventos reais de download; conteúdo dos arquivos não foi revalidado nesta etapa.
- Aceite da candidata ainda depende de consultas reais no ambiente isolado por acesso autorizado. O scan e o painel acima pertencem à produção anterior.
