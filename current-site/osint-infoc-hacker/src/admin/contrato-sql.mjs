// Contrato entre o painel (JavaScript) e o banco do painel (Postgres).
//
// Este modulo e a lista unica das RPCs que o painel chama no banco. O
// codigo em src/admin/local-db.mjs implementa a MESMA superficie para o
// modo local (banco em memoria), e db/migrations/0001_admin.sql implementa
// a MESMA superficie no Postgres.
//
// Por que a lista vive aqui: o painel tem tres implementacoes da mesma
// interface (local, Postgres e, no limite, o codigo que chama a RPC) e
// nada obrigava as tres a concordarem no nome e na ordem dos parametros.
// Um parametro trocado de lugar no SQL e no modo local produzia um erro
// silencioso: o painel gravava a credencial no campo errado.
//
// Esta lista e verificada contra o SQL por verification/sql-admin-check.mjs.

export const ASSINATURAS_PUBLICAS = Object.freeze([
  'admin_mestre_hash',
  'admin_bootstrap',
  'admin_mestre_ok',
  'admin_login',
  'admin_sessao',
  'admin_logout',
  'admin_senha_trocar',
  'admin_credenciais_leitura',
  'admin_credenciais_uso',
  'admin_credenciais_salvar',
  'admin_credenciais_apagar',
  'admin_proxies_leitura',
  'admin_proxies_uso',
  'admin_proxies_salvar',
  'admin_proxies_apagar',
  'admin_registrar_visita',
  'admin_registrar_evento',
  'admin_painel',
  'admin_fontes_leitura',
  'admin_fontes_salvar'
]);
