// Durable Object local do limite de login.
//
// O servidor de desenvolvimento nao tem o Durable Object da Cloudflare, mas
// o limite precisa existir nos dois caminhos com o mesmo comportamento: um
// teste que passa no local e falha na producao (ou o contrario) nao serve
// para nada.
//
// O SQLite vem do proprio Node (node:sqlite), sem dependencia externa. O
// adaptador abaixo expoe o mesmo contrato do storage do Durable Object:
// `exec(comando, ...bindings)` devolvendo um cursor com `toArray()`. E o
// mesmo SQL de src/lib/login-limite.mjs, sem duplicar politica.
//
// O banco fica em memoria: o contador e de uso curto e nao precisa sobreviver
// ao fim do processo.

import { DatabaseSync } from 'node:sqlite';

import { MIGRACOES } from '../../src/lib/migrations.mjs';
import { aplicarMigracoes } from '../../src/lib/sql-migrations.mjs';
import { reservar, zerar, ler, resumo } from '../../src/lib/login-limite.mjs';

// Cursor compativel com o do Cloudflare: `toArray()` devolve [] quando nada
// casa, `one()` exige exatamente uma linha.
function cursor(linhas) {
  return {
    toArray: () => linhas.slice(),
    one: () => {
      if (linhas.length !== 1) {
        throw new Error(`Expected exactly one result from SQL query, but got ${linhas.length} results.`);
      }
      return linhas[0];
    },
    raw: () => linhas.map(linha => Object.values(linha))
  };
}

// Adaptador do node:sqlite para o contrato `exec(comando, ...bindings)`.
//
// Diferencas que importam:
// - o node:sqlite expoe `.all()` para ler e `.run()` para escrever; o
//   Cloudflare expoe um cursor unico e `rowsWritten` na escrita;
// - `INSERT OR IGNORE` devolve `changes: 0` quando a linha foi ignorada, que
//   e o equivalente de `rowsWritten: 0`;
// - o `?` posicional e o mesmo nos dois lados.
export function criarSql(banco) {
  const db = banco;
  return {
    exec(comando, ...bindings) {
      const texto = String(comando || '').trim();
      if (!texto) return cursor([]);
      const stmt = db.prepare(texto);
      // Uma consulta de leitura devolve linhas; o resto devolve o numero de
      // linhas afetadas, como o Cloudflare.
      if (/^\s*(select|with|pragma)/i.test(texto)) {
        return cursor(stmt.all(...bindings));
      }
      const resultado = stmt.run(...bindings);
      return {
        ...cursor([]),
        rowsWritten: Number(resultado?.changes || 0)
      };
    }
  };
}

// Cria o banco local e aplica as migracoes do mesmo jeito que o Durable
// Object: a MESMA funcao `aplicarMigracoes`, as MESMAS versoes. Se uma
// migracao nova entrar no projeto, este banco recebe a tabela nova sem
// nenhuma alteracao aqui.
export function criarGuardLocal() {
  const banco = new DatabaseSync(':memory:');
  const sql = criarSql(banco);
  const versoes = aplicarMigracoes(sql, MIGRACOES);
  return { banco, sql, versoes };
}

// Objeto no mesmo formato do stub do Durable Object, para que o servidor
// local use exatamente o mesmo codigo de chamada da producao.
export function criarStubLogin(guard) {
  return {
    async reservaTentativa(chave, opcoes = {}) {
      return reservar(guard.sql, chave, opcoes);
    },
    async zeraTentativa(chave) {
      return zerar(guard.sql, chave);
    },
    async tentativasLogin(chave) {
      return ler(guard.sql, chave);
    },
    // O resumo do limite (contagens, sem identificar origem). O mesmo
    // modulo de politica que roda no Durable Object, para que o painel
    // local e o de producao mostrem o mesmo numero.
    async resumoLimite() {
      return resumo(guard.sql);
    }
  };
}
