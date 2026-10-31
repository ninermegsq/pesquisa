# Troca de provedores — 2026-10-30

Estado: código candidato; não promovido a produção. Nenhum novo scan foi executado no Worker bloqueado.

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

O aceite permanece incompleto: Subdomain Center não respondeu com sucesso nos testes disponíveis, e não há execução comprovada do novo motor na saída do Worker. Remoção ou migração ao browser por 1010 não foi acionada, pois não se observou 1010 nos provedores alternativos.
