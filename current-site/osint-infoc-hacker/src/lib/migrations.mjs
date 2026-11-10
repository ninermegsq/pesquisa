// GERADO por scripts/build-migrations.mjs a partir de migrations/*.sql.
// Nao edite a mao: edite o arquivo .sql e rode `npm run build`.
// Conteudo deterministico: sem data, para que o build seja idempotente.

export const MIGRACOES = Object.freeze([
  Object.freeze({
    versao: 1,
    nome: "0001_token_guard.sql",
    slug: "token_guard",
    sql: "-- Migracao 0001: controle de uso unico do token de verificacao.\n--\n-- O nonce nunca guarda alvo, credencial ou IP: apenas o identificador opaco do\n-- token e o instante de expiracao. A versao do schema fica em schema_meta,\n-- para que as migracoes sejam aplicadas em ordem e uma unica vez.\n\nCREATE TABLE IF NOT EXISTS schema_meta (\n  versao INTEGER PRIMARY KEY,\n  nome TEXT NOT NULL,\n  aplicada_em INTEGER NOT NULL\n);\n\nCREATE TABLE IF NOT EXISTS used (\n  nonce TEXT PRIMARY KEY,\n  expires INTEGER NOT NULL\n);\n\nCREATE INDEX IF NOT EXISTS used_expires ON used (expires);"
  }),
  Object.freeze({
    versao: 2,
    nome: "0002_scan_jobs.sql",
    slug: "scan_jobs",
    sql: "-- Migracao 0002: historico de scans para o painel de saude.\n--\n-- Guarda apenas contagens e o identificador de cada fonte. Alvo, e-mail e IP\n-- nunca sao persistidos aqui: o painel de saude responde \"quantas fontes\n-- falharam\", nunca \"para quem\".\n\nCREATE TABLE IF NOT EXISTS jobs (\n  job_id TEXT PRIMARY KEY,\n  criado_em INTEGER NOT NULL,\n  escopo TEXT NOT NULL,\n  status TEXT NOT NULL,\n  total_fontes INTEGER NOT NULL DEFAULT 0,\n  ok_fontes INTEGER NOT NULL DEFAULT 0,\n  falhas INTEGER NOT NULL DEFAULT 0,\n  parcial INTEGER NOT NULL DEFAULT 0\n);\n\nCREATE TABLE IF NOT EXISTS job_fontes (\n  job_id TEXT NOT NULL,\n  fonte TEXT NOT NULL,\n  status TEXT NOT NULL,\n  erro_codigo TEXT,\n  ms INTEGER NOT NULL DEFAULT 0,\n  PRIMARY KEY (job_id, fonte)\n);\n\nCREATE INDEX IF NOT EXISTS jobs_criado_em ON jobs (criado_em);"
  }),
]);
