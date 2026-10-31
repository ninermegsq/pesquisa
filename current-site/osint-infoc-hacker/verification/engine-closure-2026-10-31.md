# Fechamento do motor — candidata, 31/10/2026

Produção intacta. Upload exclusivo de ostnt-validation aceito pela API Cloudflare:
`deployment_id: 9013df76b0614ff19244bf07e1b3f1ba`.
Acesso ao hostname de validação redirecionou ao login Cloudflare Access; sessão anterior expirou.
Scans reais da nova revisão, tail e cache de borda ainda pendentes. Não promover.

## Evidência local

- npm run test:unit: passou (fixtures; não comprova upstream).
- closure-check: retry só 429/503, 2 segundos, Retry-After respeitado, falhas 401/403/404 sem retry.
- wrangler deploy --dry-run --minify: passou.
- workerd local, upstreams simulados: seis tipos HTTP 200.
- E-mail: 9 fontes no Worker e crt.sh/HackerTarget como 1 fonte lógica no navegador; total final 10.
- Replay sequencial e concorrente: 429; concorrente [200,429].
- Burst: 10 aceitos, 1 rejeitado; 11º HTTP429 com Retry-After.
- Cache local: TTL sucesso/falha e hit passaram; duas escritas KV de quota, nenhuma para dados.
- Teste temporizado de 121s desta revisão ainda não repetido na borda.

## Restrições verificadas

OpenSanctions exige chave: HTTP401, `{"detail":"No API key provided."}`.
Sem essa chave não é possível cumprir sanções em CNPJ limpo/sancionado; fonte não ativada.
17NAS documenta consulta ao próprio IP, não ao alvo arbitrário; não integrado.
RDAP .br negou acesso HTTP403, cabeçalho Nicbr-Permission-Denied:1, corpo vazio.
Não encaminhar recusa explícita de acesso via reserva.
Presend RDAP/headers/e-mail tiveram 200 e CORS *, por endpoint. Reservas cliente implementadas,
mas teste de navegador autenticado pendente. crt.sh e HackerTarget também tiveram CORS * e corpo válido.

O arquivo provider-probes-2026-10-31.json preserva status, cabeçalhos e corpos locais.
Não classificar timeout como 1010. Não afirmar que chamadas locais reproduzem o Worker.

## Pendências de aceite

- Rodada real de seis tipos com tail; remover fontes persistentemente indisponíveis após evidência.
- Cache miss/hit/expiração121s na borda; fontes cliente repetem consulta, não usam Cache API.
- Verificar eventual beacon injetado; não existe beacon/token no HTML do projeto.
- OG JPEG final revisto visualmente, 1200x630, 69609 bytes; PNG antigo ainda não regenerado.
- Sanções sem acesso; terceira reserva IPGEO inexiste no endpoint documentado.
- Promoção bloqueada; manter Turnstile de teste somente na candidata e preservar ambiente de validação.
