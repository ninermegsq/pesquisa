-- Migracao 0002: historico de scans para o painel de saude.
--
-- Guarda apenas contagens e o identificador de cada fonte. Alvo, e-mail e IP
-- nunca sao persistidos aqui: o painel de saude responde "quantas fontes
-- falharam", nunca "para quem".

CREATE TABLE IF NOT EXISTS jobs (
  job_id TEXT PRIMARY KEY,
  criado_em INTEGER NOT NULL,
  escopo TEXT NOT NULL,
  status TEXT NOT NULL,
  total_fontes INTEGER NOT NULL DEFAULT 0,
  ok_fontes INTEGER NOT NULL DEFAULT 0,
  falhas INTEGER NOT NULL DEFAULT 0,
  parcial INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS job_fontes (
  job_id TEXT NOT NULL,
  fonte TEXT NOT NULL,
  status TEXT NOT NULL,
  erro_codigo TEXT,
  ms INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (job_id, fonte)
);

CREATE INDEX IF NOT EXISTS jobs_criado_em ON jobs (criado_em);
