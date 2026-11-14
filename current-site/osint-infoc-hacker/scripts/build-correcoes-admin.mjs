// Gera db/migrations/0003_correcoes_admin.sql (o passo manual do operador).
//
// O banco de producao nao e atualizado por migracao automatica: o CLI do
// Supabase nao esta autenticado e o repositorio nao tem chave de
// service-role. O que fecha o intervalo e um SQL que o operador cola no
// Supabase SQL Editor.
//
// Este script monta esse arquivo a partir do corpo EXATO das funcoes que
// ja estao em db/migrations/0001_admin.sql. Os dois arquivos nao podem
// divergir: se divergirem, o operador aplica uma regra e o codigo do
// repositorio passa a afirmar outra coisa, sem nenhum sinal.
//
// Escopo: LOCAL ONLY. Nenhuma chamada de rede, nada publicado.

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sql = await readFile(path.join(raiz, 'db/migrations/0001_admin.sql'), 'utf8');

// Extrai uma funcao inteira: da declaracao ate o "$$;" que fecha o corpo.
function bloco(nome) {
  const inicio = sql.indexOf('CREATE OR REPLACE FUNCTION public.' + nome);
  if (inicio === -1) throw new Error('funcao nao encontrada no SQL canonico: ' + nome);
  const fim = sql.indexOf('$$;', inicio);
  if (fim === -1) throw new Error('corpo da funcao nao fechado: ' + nome);
  return sql.slice(inicio, fim + 3);
}

const CABECALHO = [
  '-- Correcoes pendentes no banco de producao (Supabase SQL Editor).',
  '--',
  '-- Este arquivo NAO e uma migracao do projeto: e o passo manual que o',
  '-- operador precisa rodar no painel do Supabase, porque o CLI nao esta',
  '-- autenticado e nao existe chave de service-role no repositorio.',
  '--',
  '-- As tres correcoes vivem em db/migrations/0001_admin.sql (ja corrigidas',
  '-- no codigo do repositorio) e na limpeza dos dados de teste que sobraram',
  '-- no funil. Rodar 0001_admin.sql inteiro JA resolve as correcoes de',
  '-- codigo; o que este arquivo acrescenta e a limpeza das linhas de teste',
  '-- e uma checagem que comprova o resultado.',
  '--',
  '-- Como rodar: abrir o projeto no Supabase -> SQL Editor -> colar este',
  '-- arquivo -> Run. A execucao pode ser repetida: as correcoes de codigo',
  '-- usam CREATE OR REPLACE, e a limpeza apaga so linhas de teste.',
  '--',
  '-- O corpo das funcoes abaixo e IDENTICO ao de 0001_admin.sql: o check',
  '-- verification/sql-admin-check.mjs compara os dois e falha se divergirem.',
  '-- Se voce mudar uma funcao aqui, mude tambem em 0001_admin.sql.',
  '',
  '-- ===========================================================================',
  '-- Correcao A: a senha nao aceita \'@\' inicial.',
  '--',
  '-- O USUARIO aceita \'@\' inicial como ruido de digitacao (o valor comparado',
  '-- e sempre o "nucleo", sem o \'@\'), mas a SENHA e comparada exatamente como',
  '-- veio. Aceitar \'@\' inicial na senha ampliava o espaco de credenciais',
  '-- aceito sem nenhuma necessidade: a conta do operador tinha duas senhas',
  '-- validas (a senha e a senha com \'@\' na frente).',
  '--',
  '-- Ja esta no repositorio em db/migrations/0001_admin.sql. Este bloco',
  '-- reescreve a funcao para tornar a correcao aplicavel sozinha, sem',
  '-- depender de rodar o arquivo inteiro.',
  '-- ===========================================================================',
  ''
].join('\n');

const RODAPE = [
  '',
  'GRANT EXECUTE ON FUNCTION public.admin_senha_trocar(text, text, text) TO anon, authenticated;',
  '',
  '-- ===========================================================================',
  '-- Correcao E: lista fechada de etapas do funil.',
  '--',
  '-- A validacao vivia so em JavaScript (src/admin/telemetria.mjs): qualquer',
  '-- chamada direta a RPC gravava o que quisesse na coluna `etapa`. Isso',
  '-- encheu o funil do painel com linhas de teste (etapas como',
  '-- \'AUDITORIA_TESTE\', \'ETAPA_ARBITRARIA_TESTE\'), que apareceriam como',
  '-- etapas desconhecidas no painel.',
  '--',
  '-- O banco agora recusa o que nao for uma etapa do funil.',
  '-- ===========================================================================',
  '',
  '-- ===========================================================================',
  '-- Limpeza: linhas de teste que sobraram no funil.',
  '--',
  '-- Sao 41 linhas de etapas que NUNCA deveriam ter existido (medidas no',
  '-- banco de producao em 2026-11-14, depois das correcoes de catalogo):',
  '-- 36 com nome de teste (AUDITORIA_TESTE, ETAPA_ARBITRARIA_TESTE,',
  '-- ZZ_*, QUALQUER_COISA_*, ...), 3 com etapa vazia ou nula e 2 com nomes',
  '-- que nao sao etapa do funil (inicio, abertura). As 388 linhas do funil',
  '-- real (visita, scan, scan_concluido, falha, exportacao) NAO sao tocadas.',
  '--',
  '-- A limpeza e por LISTA FECHADA: o filtro `etapa NOT IN (...)` apaga',
  '-- tudo que nao for etapa do funil, e por construcao o conjunto que sobra',
  '-- e o conjunto do funil. Nenhum DELETE aqui tem DELETE sem WHERE.',
  '-- ===========================================================================',
  'DELETE FROM public.admin_visitas',
  " WHERE etapa NOT IN ('visita', 'scan', 'scan_concluido', 'falha', 'exportacao')",
  '   AND etapa IS NOT NULL;',
  '',
  '-- As visitas com etapa vazia ou NULA sao lixo de probes anteriores.',
  '-- A etapa real nunca e vazia: o Worker sempre manda uma etapa da lista.',
  'DELETE FROM public.admin_visitas',
  " WHERE coalesce(etapa, '') = '';",
  '',
  '-- ===========================================================================',
  '-- Checagem: o resultado esperado depois de rodar tudo acima.',
  '--',
  '-- 1. A etapa inventada tem que ser RECUSADA:',
  '--      SELECT public.admin_registrar_visita(',
  "--        '<hash da chave mestra>', 'ETAPA_TESTE_QUALQUER', NULL, NULL, NULL,",
  '--        NULL, NULL, NULL, NULL, NULL);',
  '--    -> {"ok":false,"motivo":"etapa invalida"}',
  '--',
  '-- 2. As etapas que sobraram no funil tem que ser exatamente as cinco:',
  '--      SELECT etapa, count(*) FROM public.admin_visitas GROUP BY etapa;',
  '--',
  '-- 3. A troca de senha tem que existir:',
  "--      SELECT public.admin_senha_trocar('x', 'a', 'bbbbbbbb');",
  '--    -> {"ok":false,"motivo":"sessao invalida ou expirada"}',
  '--    (a funcao responde; antes respondia 404 PGRST202)',
  '-- ===========================================================================',
  ''
].join('\n');

const corpo = [bloco('admin_login'), bloco('admin_senha_trocar'), bloco('admin_registrar_visita')].join('\n\n');

const destino = path.join(raiz, 'db/migrations/0003_correcoes_admin.sql');
await writeFile(destino, CABECALHO + corpo + RODAPE, 'utf8');

console.log(JSON.stringify({
  ok: true,
  escopo: 'LOCAL ONLY; nenhum arquivo publicado',
  destino: 'db/migrations/0003_correcoes_admin.sql',
  funcoes: 3,
  bytes: (CABECALHO + corpo + RODAPE).length
}));
