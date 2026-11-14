-- Migracao 0003: contador de tentativas de login do painel admin.
--
-- A chave e o HMAC do endereco de origem (identificador opaco de 32
-- caracteres), nunca o endereco em claro: nem a tabela, nem o indice e nem
-- o nome do objeto guardam o endereco de origem.
--
-- Uma linha por origem, com o total de tentativas gastas na janela e o
-- instante em que a janela expira. O contador satura em MAX_TENTATIVAS + 1,
-- que e o que marca a origem como bloqueada.

CREATE TABLE IF NOT EXISTS login_tentativas (
  chave TEXT PRIMARY KEY,
  tentativas INTEGER NOT NULL DEFAULT 0,
  ate INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS login_tentativas_ate ON login_tentativas (ate);
