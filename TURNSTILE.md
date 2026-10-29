# Integração com o widget Turnstile existente

Site key mantida: `0x4AAAAAAFrCL8A3Pa1kzDsB`. Modo: Managed.
Superfície protegida: formulário de scan, ação `scan`.
Backend existente: POST /.netlify/functions/token, seguido de scan somente
com autorização HMAC válida. Destino do segredo: TURNSTILE_SECRET nas
Functions do projeto Netlify. Nenhum novo widget foi criado.

## Configuração na conta Cloudflare

No painel Cloudflare → Turnstile → widget da site key acima → Hostname Management,
confirme os hostnames exatos em que este site será aberto:

- ostnt.online
- ostnt.netlify.app

Não inclua protocolo, caminho ou curingas. Se www.ostnt.online também for usado,
autorize esse hostname e acrescente sua origem/hostname na Netlify. Não autorize
todos os sites netlify.app. Uma alteração no código não modifica a lista da
Cloudflare. Preserve Managed e use a Secret Key do mesmo widget.

## Configuração na Netlify

Em Production e com escopo Functions, preserve ou configure:

- TURNSTILE_SECRET: Secret Key desse widget, apenas no campo seguro do painel.
- HMAC_SECRET: segredo forte já usado pelo scanner; preserve o atual.
- ALLOWED_ORIGINS: https://ostnt.online,https://ostnt.netlify.app
- TURNSTILE_HOSTNAMES: ostnt.online,ostnt.netlify.app

As duas listas já têm esses padrões no código, mas valores cadastrados no painel
têm precedência. Nunca inclua localhost nas listas de produção. Não cole segredos
no chat. TURNSTILE_SITE_KEY é pública e não é usada como segredo do servidor.
Não troque a site key por chaves de teste no deploy de produção.

## Como a integração funciona

O script oficial é carregado diretamente de challenges.cloudflare.com. Antes de
renderizar, o cliente aguarda turnstile.ready. O widget é renderizado uma vez,
com execution=execute, e é executado apenas no envio do formulário. O callback
envia um token novo no campo JSON cf-turnstile-response; o backend também aceita
cfToken dos clientes antigos ainda abertos.

Após qualquer tentativa, turnstile.reset(widgetId) é chamado antes de liberar
o próximo envio. Não há retry automático concorrente com o controle do formulário.
Os callbacks de erro, expiração e timeout deixam o formulário disponível para
nova tentativa. Escape cancela o cliente e renova o widget. O widget fica fora
do campo animado e não é tornado inerte pela animação cinematográfica.

O backend chama Siteverify com POST application/x-www-form-urlencoded, timeout
de 10 segundos, secret e response, e remoteip obtido do contexto Netlify. Só
emite autorização quando success === true, action === scan e hostname é
exatamente um dos autorizados. Tokens Turnstile são de uso único; toda tentativa
é enviada ao Siteverify. A validação não é removida nem substituída por mocks.

## Diagnóstico

A antiga mensagem “Falha de verificação do Turnstile” era emitida pelo callback
no navegador, antes da chamada ao backend, e descartava o código da Cloudflare.
Agora o código e a orientação aparecem no próprio formulário, sem expor tokens.

| Resultado | Causa e ação |
| --- | --- |
| Cloudflare 110200 | Hostname não autorizado no widget. Adicione o hostname exibido em Hostname Management. |
| Cloudflare 110100 / 110110 / 400020 | Chave pública inválida ou inexistente. Confira o widget da site key. |
| Cloudflare 400070 | Widget desativado. Confira a conta Cloudflare. |
| Cloudflare 400021 | Região da site key não corresponde ao script. Confira a configuração da Cloudflare. |
| Cloudflare 200500 | Iframe não carregou. Verifique bloqueios a challenges.cloudflare.com na rede/navegador. |
| Cloudflare 200100 | Relógio ou cache. Confira data/hora do dispositivo e recarregue. |
| Cloudflare 110600 / 110620 | Tempo esgotado. Envie novamente para obter um token novo. |
| turnstile_secret_missing / invalid | Configure a Secret Key do mesmo widget em TURNSTILE_SECRET nas Functions. |
| turnstile_hostname_mismatch | Confira TURNSTILE_HOSTNAMES na Netlify, além da lista do widget na Cloudflare. |
| turnstile_token_expired | Token expirado ou reutilizado; uma nova tentativa gera outro. |
| turnstile_action_mismatch | Página/token de outra ação; recarregue o frontend publicado. |
| scan_secret_missing | Falta HMAC_SECRET nas Functions; essa chave é independente do Turnstile. |

Não conclua que a causa é hostname ou segredo apenas pela mensagem genérica da
versão antiga. O código específico distingue uma falha do widget de uma falha
na validação pelo backend. Um 401 isolado de Private Access Token no console
pode ser normal se o widget conclui e entrega um token válido.

## Validação

Os testes de contrato simulam respostas de Siteverify e verificam sucesso,
rejeição/replay, segredo inválido, hostname, ação e indisponibilidade. Os testes
de navegador verificam ready, execução explícita, renovação, mensagens de erro
e o bloqueio das chamadas ao backend quando o widget falha.

Esses testes não comprovam a configuração da conta Cloudflare ou do deploy.
Após publicar, abra o domínio real, conclua uma verificação e confirme POST token
200 com success:true. Reenvie a mesma requisição de verificação uma vez e confirme
401 por timeout-or-duplicate. Não publique ou compartilhe o token capturado.
A integração real só está validada quando sucesso e rejeição de replay forem
observados com um token novo do widget de produção no backend publicado.

## Fontes oficiais

- Fluxo solicitado: https://developers.cloudflare.com/turnstile/spin/prompt.md
- Fonte oficial desse fluxo consultada nesta sessão (o host de documentação foi bloqueado pela rede): https://github.com/cloudflare/cloudflare-docs/blob/production/public/turnstile/spin/prompt.md
- Renderização: https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/
- Códigos: https://developers.cloudflare.com/turnstile/troubleshooting/client-side-errors/error-codes/

A etapa de recuperação automática de um segredo de widget existente requer CLI
canônica aprovada, autenticação na conta e confirmação do destino do segredo.
Ela não foi executada: não há essas credenciais nesta sessão, e o projeto já usa
o destino Netlify acima. A confirmação e gravação dos valores no painel devem
ocorrer pelo fluxo seguro da plataforma, sem passar o segredo por mensagens.
