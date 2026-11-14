// Aplicacao das migracoes do Durable Object.
//
// Fica separado de token-guard.mjs para poder ser testado fora do runtime
// do Cloudflare: a funcao recebe o objeto `sql` e a lista de migracoes, e nao
// depende de nada da plataforma.

export const TABELA_META = 'schema_meta';

// Aplica as migracoes na ordem, uma vez cada, registrando a versao aplicada.
// Devolve as versoes aplicadas nesta chamada (vazio quando ja estavam todas).
export function aplicarMigracoes(sql, migracoes, agora = Date.now()) {
  if (!sql || typeof sql.exec !== 'function') throw new Error('aplicarMigracoes: executor sql invalido');
  if (!Array.isArray(migracoes) || !migracoes.length) throw new Error('aplicarMigracoes: nenhuma migracao informada');
  sql.exec(`CREATE TABLE IF NOT EXISTS ${TABELA_META} (versao INTEGER PRIMARY KEY, nome TEXT NOT NULL, aplicada_em INTEGER NOT NULL)`);
  const aplicadas = [];
  for (const migracao of migracoes) {
    const versao = Number(migracao?.versao);
    if (!Number.isInteger(versao) || versao < 1) throw new Error('aplicarMigracoes: versao de migracao invalida');
    // A leitura precisa tolerar zero linhas. O cursor do Cloudflare lanca
    // ("Expected exactly one result from SQL query, but got no results")
    // quando `.one()` nao acha exatamente uma linha, e num banco recem-criado
    // a migracao ainda NAO esta registrada: e o caso normal do primeiro
    // start, nao um erro. Por isso a busca e feita por `.toArray()[0]`, que
    // devolve `undefined` quando nada casa.
    const registrada = sql.exec(`SELECT versao FROM ${TABELA_META} WHERE versao = ?`, versao).toArray()[0];
    if (registrada && Number(registrada.versao) === versao) continue;
    const sqlTexto = String(migracao?.sql || '').trim();
    if (!sqlTexto) throw new Error(`aplicarMigracoes: migracao ${versao} sem SQL`);
    for (const instrucao of sqlTexto.split(';').map(parte => parte.trim()).filter(Boolean)) sql.exec(instrucao);
    sql.exec(`INSERT OR REPLACE INTO ${TABELA_META} (versao, nome, aplicada_em) VALUES (?, ?, ?)`, versao, String(migracao?.nome || ''), agora);
    aplicadas.push(versao);
  }
  return aplicadas;
}
