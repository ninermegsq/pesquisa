// As etapas do funil do painel admin.
//
// Fonte unica de verdade. Estas etapas sao as que o painel sabe ler
// (src/admin/telemetria.mjs), as que o modo local aceita
// (src/admin/local-db.mjs) e as que o banco remoto aceita depois da
// migracao (db/migrations/0001_admin.sql, admin_registrar_visita).
//
// Antes desta lista existir no banco, a validacao vivia so em JavaScript.
// Qualquer chamada direta a RPC (ou uma versao futura do Worker sem a
// checagem) gravava o que quisesse na coluna `etapa`, e o funil do painel
// enchia de etapas inventadas.
//
// Este arquivo mora sozinho, sem import, de proposito: os modulos que o
// usam dependem dele e nao uns dos outros (telemetria e local-db nao se
// importam), o que mantem o grafo de importacao sem ciclo.

export const ETAPAS = Object.freeze(['visita', 'scan', 'scan_concluido', 'falha', 'exportacao']);

export const etapaValida = etapa => ETAPAS.includes(String(etapa ?? ''));
