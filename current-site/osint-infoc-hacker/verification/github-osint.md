# Pesquisa no GitHub: OSINT de e-mail e telefone (2026-11-11)

Pedido atendido: *pesquisar no GitHub o repositório de puxada de dados via
e-mail e número de celular, com mais estrelas, e instalar aqui em nosso
sistema*.

## 1. Como a pesquisa foi feita (reprodutível)

O ranking abaixo não é de memória: sai da API pública de busca do GitHub, com
`sort=stars`. O script que o produz está no repositório e é versionado:

```bash
npm run pesquisa:github        # raiz do repositorio
# ou, dentro do projeto:
npm --prefix current-site/osint-infoc-hacker run pesquisa:github
```

- `current-site/osint-infoc-hacker/scripts/github-osint-pesquisa.mjs`
- 10 consultas: `osint email`, `email osint tools`, `phone number osint`,
  `phone number reconnaissance`, `email breach check`,
  `osint tool email phone`, `phone osint investigation`,
  `osint email domain harvest`, `osint email username domain`,
  `theharvester osint`.
- Consolida por nome completo, ordena por estrelas e imprime JSON com estrelas,
  forks, linguagem, licença (SPDX), data do último push, descrição e URL.
- **Rate limit**: a busca pública permite 10 requisições por minuto sem
  autenticação. O script lê `x-ratelimit-reset`, espera a janela abrir e repete
  a consulta; só depois de duas tentativas registra o aviso e segue com o que
  tem. Com `GITHUB_TOKEN` no ambiente o limite sobe para 30/min.
- Execução usada neste documento: `2026-11-11T10:07:47Z`, **sem
  autenticação**, 220 repositórios únicos, 140 com licença declarada, nenhum
  aviso pendente.

## 2. Ranking medido (top 20 de 220)

| # | Repositório | Estrelas | Forks | Linguagem | Licença | O que faz |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | [sundowndev/phoneinfoga](https://github.com/sundowndev/phoneinfoga) | 18.526 | 6.309 | Go | GPL-3.0 | Investigação de número de telefone (scanners local, Google, Numverify, OVH) |
| 2 | [laramies/theHarvester](https://github.com/laramies/theHarvester) | 18.290 | 2.733 | Python | GPL-2.0 | Coleta de e-mails, subdomínios e nomes por domínio |
| 3 | [megadose/holehe](https://github.com/megadose/holehe) | 15.611 | 2.027 | Python | GPL-3.0 | Verifica em que sites o e-mail está cadastrado |
| 4 | [antoniaci/blackbird](https://github.com/antoniaci/blackbird) | 10.090 | 1.462 | Python | (sem licença) | Procura contas por usuário/e-mail em redes sociais |
| 5 | [alpkeskin/mosint](https://github.com/alpkeskin/mosint) | 6.075 | 664 | Go | MIT | OSINT automatizado de e-mail |
| 6 | [kaifcodec/user-scanner](https://github.com/kaifcodec/user-scanner) | 5.605 | 593 | Python | MIT | Suíte e-mail + usuário (MCP) |
| 7 | [khast3x/h8mail](https://github.com/khast3x/h8mail) | 5.375 | 621 | Python | (NOASSERTION) | Caça a senhas em breaches a partir do e-mail |
| 8 | [TermuxHackz/X-osint](https://github.com/TermuxHackz/X-osint) | 2.864 | 356 | Python | GPL-3.0 | Framework de OSINT (e-mail, telefone, VIN) |
| 9 | [bhavsec/reconspider](https://github.com/bhavsec/reconspider) | 2.864 | 371 | Python | GPL-3.0 | Framework OSINT (IP, e-mail, sites, organizações) |
| 10 | [martinvigo/email2phonenumber](https://github.com/martinvigo/email2phonenumber) | 2.828 | 315 | Python | MIT | Descobre telefone a partir do e-mail |
| 11 | [thewhiteh4t/pwnedOrNot](https://github.com/thewhiteh4t/pwnedOrNot) | 2.677 | 345 | Python | MIT | Senhas de e-mails comprometidos |
| 12 | [megadose/ignorant](https://github.com/megadose/ignorant) | 2.160 | 322 | Python | GPL-3.0 | Telefone cadastrado em sites |
| 13 | [AzizKpln/Gokboru_Intel](https://github.com/AzizKpln/Gokboru_Intel) | 2.141 | 311 | Python | MIT | Informações de telefone |
| 14 | [HackUnderway/SearchPhone](https://github.com/HackUnderway/SearchPhone) | 2.112 | 284 | Python | MIT | Telefone em Google, GitHub, Numverify, Reddit, DuckDuckGo |
| 15 | [iojw/socialscan](https://github.com/iojw/socialscan) | 1.875 | 226 | Python | MPL-2.0 | Biblioteca de consulta de usuário/e-mail em plataformas |
| 16 | [Yvesssn/DetectDee](https://github.com/Yvesssn/DetectDee) | 1.841 | 234 | Go | Apache-2.0 | Contas por usuário, e-mail ou telefone |
| 17 | [KatrielMoses/MailAccess](https://github.com/KatrielMoses/MailAccess) | 1.772 | 150 | Python | MIT | OSINT de e-mail em 5.000+ plataformas |
| 18 | [Ekultek/WhatBreach](https://github.com/Ekultek/WhatBreach) | 1.699 | 229 | Python | (sem licença) | E-mails em breaches, databases e pastes |
| 19 | [Clats97/ClatScope](https://github.com/Clats97/ClatScope) | 1.611 | 225 | Python | (NOASSERTION) | OSINT amplo (geo, DNS, WHOIS, telefone, e-mail) |
| 20 | [SharadKumar97/OSINT-SPY](https://github.com/SharadKumar97/OSINT-SPY) | 1.563 | 215 | Python | GPL-3.0 | Scan de e-mail/domínio/IP/organização |

O ranking completo (40 posições) sai no JSON do script.

## 3. O que foi realmente instalado no sistema

Os repositórios acima são, em sua maioria, **CLI em Go ou Python**. O scanner
publicado é um **Cloudflare Worker**: o runtime de produção não tem Python nem
Go, e o motor tem contrato próprio (manifesto, custo em subrequests, TTL,
taxonomia de erro). "Instalar" aqui significou **portar a técnica**, reescrevendo
em JavaScript próprio dentro de `src/sources/registry.mjs`, sem copiar código,
lista de dados nem payload de nenhum repositório. Três fontes novas:

| Fonte nova | Repositório de origem | Técnica portada | Custo | TTL | Observação |
| --- | --- | --- | --- | --- | --- |
| `email_registro` | `megadose/holehe` (15.611★) e `antoniaci/blackbird` (10.090★) | Consultar endpoints públicos que respondem se o e-mail já está em uso | 8 | 6 h | 8 sites; cada um isolado (`indisponivel` não derruba os outros) |
| `phone_footprint` | `sundowndev/phoneinfoga` (18.526★) — scanners `local` e `googlesearch` | Formatos do número (E.164, nacional com DDD, país) e links de busca por categoria | 0 | 0 | Nenhuma chamada de rede: os "dorks" são links para o Google, não consultas |
| `numverify` | `sundowndev/phoneinfoga` — scanner `numverify` (`suppliers/numverify.go`) | Validade, operadora, país e tipo de linha do número | 1 | 12 h | Numverify/APILayer; credencial **obrigatória** (`NUMVERIFY_API_KEY`) |

### 3.1 `email_registro` — as 8 checagens de cadastro

Todos os 8 endpoints foram **verificados ao vivo nesta máquina, nos dois
sentidos** (e-mail com cadastro e e-mail inexistente), com o User-Agent de
produção. Nenhum deles cria conta nem dispara e-mail de recuperação: são
consultas de disponibilidade.

| Site | Método | Endpoint | Sinal de "cadastrado" | Sinal de "não cadastrado" |
| --- | --- | --- | --- | --- |
| Duolingo | GET | `www.duolingo.com/2017-06-30/users?email=` | `users` com 1+ item | `users` vazio |
| ProtonMail | GET | `api.protonmail.ch/pks/lookup?op=index&search=` | corpo `info:1:1` (chave PGP) | corpo `info:1:0` |
| WordPress | GET | `public-api.wordpress.com/rest/v1.1/users/{email}/auth-options?http_envelope=1` | `body.email_verified === true` | `body.error` |
| Twitter | GET | `api.twitter.com/i/users/email_available.json?email=` | `taken === true` | `taken === false` |
| Spotify | GET | `spclient.wg.spotify.com/signup/public/v1/account?validate=1&email=` | `status === 20` | `status === 1` |
| Adobe | POST | `auth.services.adobe.com/signin/v2/users/accounts` | array com 1+ conta | array vazio |
| Firefox | POST | `api.accounts.firefox.com/v1/account/status` | `exists === true` | `exists === false` |
| Freelancer | POST | `www.freelancer.com/api/users/0.1/users/check` | **HTTP 409** + `EMAIL_TAKEN` | HTTP 200 + `status:"success"` |

Três armadilhas medidas e tratadas no código: o **WordPress responde HTTP 200
nos dois sentidos** (o sinal está no corpo, não no status); o **Freelancer
responde 409 no caso positivo** (um `if(!r.ok) throw` ingênuo transformaria o
achado em falha); o **ProtonMail responde `text/plain`** (um parse JSON
quebraria).

Sem nenhuma resposta utilizável, a fonte **falha de verdade** (`nenhuma
checagem de cadastro respondeu`) em vez de entregar um "nada encontrado" sem
evidência. O relatório rotula o resultado como disponibilidade do endereço
**naquele serviço**, não como identidade de quem o controla.

### 3.2 `phone_footprint` — o scanner local e o de busca do PhoneInfoga

O `local_scanner.go` e o `googlesearch_scanner.go` do PhoneInfoga foram lidos
na fonte e portados: normalização E.164, prefixo de país (tabela própria, com
BR em 55), formato nacional `(11) 99999-9999`, links diretos de WhatsApp e
Telegram, e as 4 categorias de dork do upstream — Redes sociais, SMS
descartável, Reputação, Pessoas — mais busca geral (número solto e número em
arquivo). As buscas são **links para o Google**, não consultas: nada é enviado
a serviço nenhum com o número.

### 3.3 `numverify` — o scanner Numverify do PhoneInfoga

O upstream usa `https://api.apilayer.com/number_verification/validate` com
header `Apikey`. Medido nesta máquina: essa rota responde **401 sem chave**, e
`apilayer.net/api/validate` também (corpo `{"success":false,"error":{"code":
101,"type":"invalid_access_key"}}`). A fonte usa a forma documentada do
Numverify (`apilayer.net/api/validate?access_key=…&number=…`) e é declarada
no manifesto com **credencial obrigatória**: sem `NUMVERIFY_API_KEY` ela
responde `sem_chave` (falha de configuração — o relatório **não** fica
parcial).

## 4. O que NÃO foi portado — e por quê (com a medição)

| Repositório/técnica | Decisão | Motivo medido |
| --- | --- | --- |
| OVH (`suppliers/ovh.go` do PhoneInfoga) | fora | A API responde **HTTP 400** para `es` e `br`; só `fr`, `be`, `gb`, `ch` respondem. Seria no-op para número brasileiro |
| Google CSE (scanner do PhoneInfoga) | fora | Exige **duas** variáveis de ambiente (chave + contexto de pesquisa) e uma cota; o projeto é de zero chave de visitante. A entrega equivalente é o link de busca por categoria em `phone_footprint` |
| theHarvester | fora | Coleta e-mail por **domínio** com wordlists e Bing/Google — o scanner investigate um **alvo informado**, não um domínio inteiro |
| h8mail / pwnedOrNot / WhatBreach | fora | Caça a senha em breach por serviço pago ou local; o projeto já tem fonte de breach pública (Hudson Rock) e não faz SMTP local |
| email2phonenumber, Gokboru_Intel, SocialPwned, WebSift, iKy, MailFinder | fora | Trabalham por nome/domínio/varredura de site — fora do escopo do scanner (alvo: e-mail, telefone, CNPJ, domínio, IP, nome já suportados) |
| ignorant (2.160★) | fora | Cadastro de **telefone** em sites (o inverso do holehe). Depende de endpoints que, na medição, não responderam de forma estável, e o ganho sobre `email_registro` é pequeno |
| Endpoints de cadastro que rejeitaram a máquina | fora | `vsco` 403, `tellonym` 403, `rocketreach` 404, `coroflot` 403, `envato` 403, `patreon` 404, `strava` 404, `pinterest` 403, `diigo` 403 (desafio Cloudflare), `codepen` 403, `keybase` 219, `snapchat` 405, `vrbo` 429 (bot), `office365` autodiscover (instável), `wattpad` (sem sinal), `duckduckgo` (sem sinal) |
| Endpoints que **enviam** e-mail de recuperação ou **criam** conta | fora por decisão | Efeito colateral no alvo: nada de disparo de mensagem ou cadastro fantasma, mesmo "para testar" |

## 5. Licenças — o que não foi copiado

Todos os repositórios portados são GPL-2.0/GPL-3.0 ou não têm licença
declarada (`blackbird`: sem licença; `h8mail`: NOASSERTION). A licença do
código **ported** é a do próprio projeto, não a do repositório consultado.
Nenhuma linha de código, nenhuma lista de sites e nenhum payload foi copiado:
os 8 endpoints foram reescritos do zero e **reverificados ao vivo**, e as
tabelas de país e de dorks do PhoneInfoga foram reescritas de forma enxuta
(~90 países, BR em primeiro; 5+6+6+5 sitios por categoria).

Para quem quiser o binário original: os três repositórios rodam localmente em
Python/Go (`pip install holehe`, `go install …`, `git clone theHarvester`) e
são a rota correta para uso offline, fora do edge.

## 6. Prova offline

`verification/osint-github-source-check.mjs` (na cadeia do `npm test`, sem
rede) fixa o contrato das três fontes: metadados do manifesto, as 8 URLs e os
8 métodos exatos, o resultado positivo e negativo, o site bloqueado isolado, a
falha real quando nenhum site responde, zero chamada de rede em
`phone_footprint`, e `sem_chave`/`HTTP 401` no `numverify`.

Saída real (`npm test`):

```json
{"scope":"LOCAL ONLY; fixtures offline das respostas ao vivo","fontes":["email_registro","phone_footprint","numverify"],"email_registro":{"checagens":8,"positivo":"8 cadastrado","negativo":"0 cadastrado","bloqueado":"7 checagens seguem","todosBloqueados":"falha real"},"phone_footprint":{"chamadasDeRede":0,"e164":"+5511999999999","nacional":"(11) 99999-9999","categorias":5},"numverify":{"semChave":"sem_chave","comChave":"resposta valida","chaveInvalida":"HTTP 401"}}
```

Contagem do registro depois da integração (`npm test`):

```json
{"ok":true,"fontes":27,"email":13,"custo_email":24,"categorias":6,"chaves_visitante":0,"codigos":7,"credenciais_opcionais":["github","emailrep","cnpj_br","ceis","numverify","datajud"]}
```

## 7. Limitações declaradas

- O ranking é uma **fotografia de 2026-11-11**; as estrelas mudam todo dia.
  A busca do GitHub é limitada a 10/min sem token — o script espera a janela,
  mas uma execução longa pode registrar aviso.
- "Portar" não é "instalar o binário": o comportamento é equivalente no que a
  técnica entrega, mas cada implementação tem os próprios limites.
- A verificação ao vivo dos 8 endpoints foi feita **desta máquina**, com o
  User-Agent de produção, e não pela saída do Worker no Cloudflare. O padrão
  de bloqueio pode ser diferente no edge — a execução no edge continua sem
  prova (item 2 da lista "ainda obrigatório" em `verification/status.md`).
- "Cadastrado" significa que o endereço **está em uso** naquele serviço. Não
  identifica quem controla o e-mail, e os serviços podem mudar de resposta a
  qualquer momento.
- `numverify` só funciona com `NUMVERIFY_API_KEY` configurada; sem a chave a
  fonte responde `sem_chave` e o relatório não fica parcial.
