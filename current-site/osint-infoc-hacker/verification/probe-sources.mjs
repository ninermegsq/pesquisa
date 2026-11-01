// Sonda as 24 fontes do registry contra APIs REAIS, com o mesmo ctx do Worker.
// Cada fonte recebe um alvo do tipo que ela declara. Mede status, latencia e formato.
//   node verification/probe-sources.mjs [fonte-opcional]
import { REGISTRY } from '../src/sources/registry.mjs';
import { ctx, ehAbort } from '../src/lib/http.mjs';
import { detectar } from '../src/lib/alvo.mjs';

const env = {
  UA_MODE: 'identificado',
  UA: 'ostnt.online scanner (+https://ostnt.online)',
  UA_NAVEGADOR: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  BUDGET_SUBREQ: '38',
  GITHUB_TOKEN: process.env.GH_PROBE_TOKEN || '',
  DATAJUD_API_KEY: process.env.DJ_PROBE_KEY || '',
};

const AMOSTRA = {
  email: 'teste.scan@example.com',
  dominio: 'example.com',
  ip: '8.8.8.8',
  nome: 'maria da silva',
  cnpj: '11222333000181',
  telefone: '11987654321',
  cpf: '52998224725',
};
const ALVOS = {};
for (const [t, v] of Object.entries(AMOSTRA)) {
  try { ALVOS[t] = detectar(v); } catch { ALVOS[t] = { tipo: t, valor: v }; }
}

const c = ctx(env, 'https://validation.ostnt.online');
const soRodar = process.argv[2];
const relatorio = [];

console.log('id'.padEnd(14), 'tipo'.padEnd(11), 'status'.padEnd(9), 'ms'.padEnd(7), 'detalhe');
for (const s of REGISTRY) {
  if (soRodar && s.id !== soRodar) continue;
  const tipo = s.tipos.find(t => ALVOS[t]) || s.tipos[0];
  const a = ALVOS[tipo];
  if (!a) { console.log(s.id.padEnd(14), 'SEM ALVO'); continue; }
  const t0 = Date.now();
  try {
    const r = await s.run(a, c);
    const ms = Date.now() - t0;
    const dados = r?.dados ?? r;
    const resumo = JSON.stringify(dados).slice(0, 150);
    console.log(s.id.padEnd(14), tipo.padEnd(11), 'OK'.padEnd(9), String(ms).padEnd(7), resumo);
    relatorio.push({ id: s.id, tipo, status: 'ok', ms, dados, provenance: s.provenance });
  } catch (e) {
    const ms = Date.now() - t0;
    const st = ehAbort(e) ? 'timeout' : 'erro';
    console.log(s.id.padEnd(14), tipo.padEnd(11), st.padEnd(9), String(ms).padEnd(7), String(e?.message || e).slice(0, 160));
    relatorio.push({ id: s.id, tipo, status: st, ms, erro: String(e?.message || e).slice(0, 240) });
  }
}
console.log('\nsubrequests consumidos:', c.requests);
const ok = relatorio.filter(r => r.status === 'ok');
console.log(`OK: ${ok.length}/${relatorio.length}`);
console.log('\n=== JSON ===');
console.log(JSON.stringify(relatorio, null, 2));
