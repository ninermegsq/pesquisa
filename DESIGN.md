# MorphOrb — adaptação cinematográfica

A referência enviada pelo proprietário em Texto colado.txt foi adaptada para DOM,
CSS e Canvas na aplicação existente. A geometria, curvas Bézier, seis rastros,
16 anéis de partículas, quatro programas de iluminação, varredura, vórtice,
pulsação e timelines vêm da referência. O texto trazia apenas keyframes CSS;
as superfícies, aurora, iluminação, layout e estados foram completados aqui.

Não foi feita uma migração para React/TypeScript/shadcn. O site continua sem
bundler obrigatório: public/cinematic-orb.js contém JavaScript diretamente
executável, encapsulado para não colidir com o scanner. O widget do Turnstile
fica fora do campo que se transforma para permanecer clicável durante o scan.

## Cores e comportamento

- Fundo carvão `#08090b`, superfícies escuras, partículas peroladas RGB(235,235,235).
- Resolução em verde-esmeralda RGB(52,211,153), `#34d399`, conforme a referência.
- Campo-pílula com aurora, brilho suave, resposta à digitação e envio com seta.
- Launch: campo se contrai; esfera prateada voa em curva com seis rastros.
- Assemble/think: esfera de pontos se monta e alterna programas de iluminação.
- Resolve: onda verde percorre as partículas após a resposta real da API.
- Condense: vórtice concentra a esfera, com pulso e halo verde.
- Unfold: esfera se abre em cartão; texto aparece por palavra com desfoque.
- Answered/reset: resumo real, resultados existentes e retorno animado ao campo.

A animação não inventa resultados. A aprovação do Turnstile continua obrigatória;
a API e o scanner continuam iguais. Uma fonte indisponível permanece identificada
como indisponível. O resumo usa os dados e a disponibilidade retornados pela API.
Falhas interrompem a sequência de sucesso, mostram erro e liberam nova tentativa.
Escape cancela a espera e o fetch do cliente e retorna ao campo. Cancelar o fetch
não garante interromper uma Function que já esteja executando no servidor.

Prefers-reduced-motion usa as transições simplificadas da referência. Partículas
param em abas ocultas e retomam ao voltar. O formulário mantém rótulos, foco,
mensagens ao leitor de tela e Turnstile interativo. O resumo só recebe foco após
estar visível; o campo fica inerte durante a animação. Não há imagens externas ou
novas bibliotecas de produção. Layouts verificados: 375, 768, 1024 e 1440 px.

## Arquivos e testes

- public/cinematic-orb.css: tokens, superfícies e layout responsivo.
- public/cinematic-orb.js: timeline, renderizador e adaptador window.CinematicOrb.
- public/index.html: ligação de begin/finish/fail/reset ao scanner e cancelamento.
- scripts/test-cinematic.cjs: regressão em Chromium com APIs e Turnstile simulados.

Para repetir o teste de navegador, inicie `netlify dev` em um terminal, instale
Playwright separadamente e rode (ajuste CHROMIUM_PATH ao navegador instalado):

```bash
npm install --prefix /tmp/cinematic-browser-tools --no-save playwright@1.56.1
NODE_PATH=/tmp/cinematic-browser-tools/node_modules \
CHROMIUM_PATH=/usr/bin/chromium \
BASE_URL=http://127.0.0.1:8888 \
node scripts/test-cinematic.cjs
```

O teste verifica todas as fases, envio inválido, respostas de sucesso e falha,
Escape, nova consulta, acordeões, movimento reduzido, ausência de erros JS e
transbordamento horizontal. Capturas são salvas em /tmp/cinematic-check ou
ARTIFACT_DIR. `npm run check` e `npm test` validam também os scripts e o contrato
do Turnstile. Os testes usam fixtures e não consultam dados pessoais reais.
A publicação e a verificação com credenciais reais na Netlify continuam separadas.
