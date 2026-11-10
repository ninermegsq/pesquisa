-- Migracao 0001: controle de uso unico do token de verificacao.
--
-- O nonce nunca guarda alvo, credencial ou IP: apenas o identificador opaco do
-- token e o instante de expiracao. A versao do schema fica em schema_meta,
-- para que as migracoes sejam aplicadas em ordem e uma unica vez.

CREATE TABLE IF NOT EXISTS schema_meta (
  versao INTEGER PRIMARY KEY,
  nome TEXT NOT NULL,
  aplicada_em INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS used (
  nonce TEXT PRIMARY KEY,
  expires INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS used_expires ON used (expires);
