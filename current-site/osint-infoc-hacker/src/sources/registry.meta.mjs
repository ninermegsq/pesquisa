// GERADO por scripts/build-registry.mjs a partir de src/sources/registry.json.
// Nao edite a mao: edite o manifesto e rode `npm run build`.
// Conteudo deterministico: sem data de geracao, para que o build seja idempotente.

export const REGISTRY_META = Object.freeze({
  versao: 1,
  digest: "c8cb3fa72aa1505e6b2cc83439d20efcc98ae96c828970bd2a63ca4e1600649d",
  fontes: Object.freeze({
    "gravatar": Object.freeze({
      id: "gravatar",
      titulo: "Gravatar",
      tipos: Object.freeze(["email"]),
      custo: 1,
      ttl: 86400,
      provenance: "gravatar-public-profile",
      chave: false,
      requer: null
    }),
    "pgp": Object.freeze({
      id: "pgp",
      titulo: "PGP",
      tipos: Object.freeze(["email"]),
      custo: 1,
      ttl: 604800,
      provenance: "keys-openpgp",
      chave: false,
      requer: null
    }),
    "gitlab": Object.freeze({
      id: "gitlab",
      titulo: "GitLab",
      tipos: Object.freeze(["email"]),
      custo: 1,
      ttl: 21600,
      provenance: "gitlab-graphql-search",
      chave: false,
      requer: null
    }),
    "npm": Object.freeze({
      id: "npm",
      titulo: "npm",
      tipos: Object.freeze(["email"]),
      custo: 1,
      ttl: 21600,
      provenance: "npm-registry",
      chave: false,
      requer: null
    }),
    "bluesky": Object.freeze({
      id: "bluesky",
      titulo: "Bluesky",
      tipos: Object.freeze(["email"]),
      custo: 1,
      ttl: 21600,
      provenance: "bsky-public-api",
      chave: false,
      requer: null
    }),
    "telegram": Object.freeze({
      id: "telegram",
      titulo: "Telegram",
      tipos: Object.freeze(["telefone"]),
      custo: 1,
      ttl: 3600,
      provenance: "telegram-tme",
      chave: false,
      requer: null
    }),
    "xon": Object.freeze({
      id: "xon",
      titulo: "Breaches e senhas",
      tipos: Object.freeze(["email"]),
      custo: 2,
      ttl: 43200,
      provenance: "xposedornot",
      chave: false,
      requer: null
    }),
    "hudsonrock": Object.freeze({
      id: "hudsonrock",
      titulo: "Infostealer",
      tipos: Object.freeze(["email"]),
      custo: 1,
      ttl: 43200,
      provenance: "hudson-rock-cavalier",
      chave: false,
      requer: null
    }),
    "github": Object.freeze({
      id: "github",
      titulo: "GitHub",
      tipos: Object.freeze(["email"]),
      custo: 1,
      ttl: 86400,
      provenance: "github-users-api",
      chave: false,
      requer: Object.freeze({"tipo":"token","env":"GITHUB_TOKEN","opcional":false})
    }),
    "emailrep": Object.freeze({
      id: "emailrep",
      titulo: "Reputacao",
      tipos: Object.freeze(["email"]),
      custo: 1,
      ttl: 43200,
      provenance: "emailrep",
      chave: false,
      requer: Object.freeze({"tipo":"chave","env":"EMAILREP_KEY","opcional":false})
    }),
    "email_registro": Object.freeze({
      id: "email_registro",
      titulo: "Cadastro de e-mail",
      tipos: Object.freeze(["email"]),
      custo: 8,
      ttl: 21600,
      provenance: "holehe-blackbird-cadastro",
      chave: false,
      requer: null
    }),
    "dns": Object.freeze({
      id: "dns",
      titulo: "DNS e e-mail",
      tipos: Object.freeze(["email","dominio"]),
      custo: 4,
      ttl: 300,
      provenance: "google-doh",
      chave: false,
      requer: null
    }),
    "crtsh": Object.freeze({
      id: "crtsh",
      titulo: "Subdominios",
      tipos: Object.freeze(["email","dominio"]),
      custo: 1,
      ttl: 43200,
      provenance: "subdomain-center",
      chave: false,
      requer: null
    }),
    "wayback": Object.freeze({
      id: "wayback",
      titulo: "URLs historicas",
      tipos: Object.freeze(["email","dominio"]),
      custo: 1,
      ttl: 43200,
      provenance: "wayback-cdx",
      chave: false,
      requer: null
    }),
    "rdap": Object.freeze({
      id: "rdap",
      titulo: "RDAP",
      tipos: Object.freeze(["dominio"]),
      custo: 1,
      ttl: 86400,
      provenance: "rdap",
      chave: false,
      requer: null
    }),
    "ssllabs": Object.freeze({
      id: "ssllabs",
      titulo: "SSL Labs",
      tipos: Object.freeze(["dominio"]),
      custo: 1,
      ttl: 3600,
      provenance: "qualys-ssllabs",
      chave: false,
      requer: null
    }),
    "urlscan": Object.freeze({
      id: "urlscan",
      titulo: "urlscan",
      tipos: Object.freeze(["dominio"]),
      custo: 1,
      ttl: 21600,
      provenance: "urlscan-public",
      chave: false,
      requer: null
    }),
    "internetdb": Object.freeze({
      id: "internetdb",
      titulo: "Exposicao",
      tipos: Object.freeze(["ip"]),
      custo: 1,
      ttl: 3600,
      provenance: "shodan-internetdb",
      chave: false,
      requer: null
    }),
    "ipgeo": Object.freeze({
      id: "ipgeo",
      titulo: "Rede",
      tipos: Object.freeze(["ip"]),
      custo: 1,
      ttl: 86400,
      provenance: "ipwhois",
      chave: false,
      requer: null
    }),
    "asn": Object.freeze({
      id: "asn",
      titulo: "ASN",
      tipos: Object.freeze(["ip"]),
      custo: 1,
      ttl: 86400,
      provenance: "team-cymru-dns",
      chave: false,
      requer: null
    }),
    "cnpj_br": Object.freeze({
      id: "cnpj_br",
      titulo: "Empresa",
      tipos: Object.freeze(["cnpj"]),
      custo: 2,
      ttl: 86400,
      provenance: "cnpj-ws-publica+minha-receita-cnpj",
      chave: false,
      requer: Object.freeze({"tipo":"token","env":"CNPJWS_TOKEN","opcional":true})
    }),
    "ceis": Object.freeze({
      id: "ceis",
      titulo: "Sancoes",
      tipos: Object.freeze(["cnpj"]),
      custo: 1,
      ttl: 86400,
      provenance: "portal-transparencia-ceis",
      chave: false,
      requer: Object.freeze({"tipo":"chave","env":"TRANSPARENCIA_KEY","opcional":false})
    }),
    "ddd": Object.freeze({
      id: "ddd",
      titulo: "Regiao",
      tipos: Object.freeze(["telefone"]),
      custo: 0,
      ttl: 0,
      provenance: "anatel-pgcn-snapshot-2026-10-30",
      chave: false,
      requer: null
    }),
    "phone_footprint": Object.freeze({
      id: "phone_footprint",
      titulo: "Rastreio de telefone",
      tipos: Object.freeze(["telefone"]),
      custo: 0,
      ttl: 0,
      provenance: "phoneinfoga-local-dorks",
      chave: false,
      requer: null
    }),
    "numverify": Object.freeze({
      id: "numverify",
      titulo: "Validade do numero",
      tipos: Object.freeze(["telefone"]),
      custo: 1,
      ttl: 43200,
      provenance: "numverify-apilayer",
      chave: false,
      requer: Object.freeze({"tipo":"chave","env":"NUMVERIFY_API_KEY","opcional":false})
    }),
    "wikidata": Object.freeze({
      id: "wikidata",
      titulo: "Wikidata",
      tipos: Object.freeze(["nome"]),
      custo: 1,
      ttl: 604800,
      provenance: "wikidata-sparql",
      chave: false,
      requer: null
    }),
    "datajud": Object.freeze({
      id: "datajud",
      titulo: "Processos",
      tipos: Object.freeze(["nome"]),
      custo: 2,
      ttl: 86400,
      provenance: "cnj-datajud",
      chave: false,
      requer: Object.freeze({"tipo":"chave","env":"DATAJUD_API_KEY","opcional":false})
    }),
    "cpf_valida": Object.freeze({
      id: "cpf_valida",
      titulo: "CPF",
      tipos: Object.freeze(["cpf"]),
      custo: 0,
      ttl: 0,
      provenance: "cpf-dv-local",
      chave: false,
      requer: null
    }),
    "cpf_brasilapi": Object.freeze({
      id: "cpf_brasilapi",
      titulo: "Cadastro de CPF",
      tipos: Object.freeze(["cpf"]),
      custo: 1,
      ttl: 86400,
      provenance: "brasilapi-cpf-v1",
      chave: false,
      requer: null
    }),
    "placa_footprint": Object.freeze({
      id: "placa_footprint",
      titulo: "Rastreio de placa",
      tipos: Object.freeze(["placa"]),
      custo: 0,
      ttl: 0,
      provenance: "placa-mercosul-local",
      chave: false,
      requer: null
    }),
    "placa_sinesp": Object.freeze({
      id: "placa_sinesp",
      titulo: "Veiculo",
      tipos: Object.freeze(["placa"]),
      custo: 1,
      ttl: 86400,
      provenance: "sinesp-apicarros",
      chave: false,
      requer: null
    }),
    "nome_perfil": Object.freeze({
      id: "nome_perfil",
      titulo: "Perfis",
      tipos: Object.freeze(["nome"]),
      custo: 10,
      ttl: 86400,
      provenance: "maigret-perfil-publico",
      chave: false,
      requer: null
    }),
  })
});
