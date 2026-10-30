# Verificação — 2026-10-30

Estado: NÃO CONCLUÍDO. Código candidato, não promovido a produção.

## Evidência real obtida

- GET/HEAD https://ostnt.online/: 200, HSTS `max-age=31536000`.
- CSP em produção contém `static.cloudflareinsights.com` em script-src e `cloudflareinsights.com` em connect-src. Sem unsafe-inline em script-src.
- robots em produção: User-agent *, Allow /, Sitemap https://ostnt.online/sitemap.xml. Nenhum comentário content-signals estava presente no arquivo local ou resposta observada; nada foi removido.
- DOM de navegador: beacon injetado externamente ao HTML do repositório. Sem violação de CSP nos logs consultados. O recurso de navegador disponível não expõe Network, portanto NÃO há prova de POST /cdn-cgi/rum 200.
- Configuração da zona: rum=off; lista de sites Web Analytics retornou vazia. A origem da injeção ainda precisa ser identificada antes de alterar outra configuração.
- og.png: captura da interface existente, 1200x630, PNG. Incluído no build do Worker candidato; ainda não validado publicado.
- Worker isolado ostnt-validation criado na conta do projeto, com CACHE e TOKEN_GUARD; endpoint de teste exige credencial temporária e restringe o alvo ao e-mail autorizado. Nenhum segredo de produção foi copiado. A rota workers.dev e Version URLs desse Worker foram desligadas depois do 403; nenhum scan real chegou ao handler.
- Stream da API de tail conectado (mesmo backend de wrangler tail, não execução do CLI). CLI local não dispõe de credencial.
- Primeira tentativa autenticada ao preview: HTTP 403, Cloudflare 1010. Nenhuma execução das fontes foi observada no tail. Revisão automática bloqueou a tentativa de mudar de cliente HTTP; não há resultados reais de fontes a declarar. Depois desse bloqueio, foi preparado o arquivo `wrangler.validation.toml` com sitekey de teste e o hostname de validação para uso somente fora da produção.
- As URLs de versão não são geradas para Workers com classes Durable Object; a documentação também informa que version URLs não expõem wrangler tail. O teste usa um Worker de validação implantado, distinto do editor/playground/wrangler dev.

## Verificação local (não é aceite de produção)

Comando: `node verification/cache-check.mjs`

```json
{"scope":"LOCAL ONLY; not upstream or edge validation","successTTL":86400,"errorTTL":120,"timeoutTTL":120,"cacheHit":true,"sourceKVWrites":0,"scanKVWrites":2,"emailSources":12,"emailSubrequests":16,"offlineStatus":200,"partial":true}
```

Sintaxe de Worker, registry e app.js verificada com node --check.

## Ainda obrigatório antes de concluir

1. Desbloquear a validação autorizada no ambiente de teste sem contornar controles.
2. Primeiro resolver o acesso ao Worker de validação aprovado pela conta sem alternar clientes após o 1010. Só então capturar status, HTTP e exceção crua por fonte nas 12 fontes de e-mail e no Telegram (13 no total). GitHub/EmailRep/CEIS não têm chaves configuradas. Nenhuma fonte foi removida sem evidência real.
3. Confirmar cache miss/hit e expiração real após 120s, inclusive pelo datacenter retornado; duas gravações KV por scan.
4. Confirmar rejeição de replay sequencial e simultâneo no Durable Object real.
5. Confirmar beacon no Network (200) ou remover sua injeção na origem correta.
6. Promover a versão candidata com binding e migração juntos; validar fluxo Turnstile/token/scan e og.png na produção.
