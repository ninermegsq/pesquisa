// Scan real contra o Worker de validacao, via workerd local.
// Um IP distinto por alvo: o limite e de 10 scans/hora por IP, entao repetir o
// mesmo IP bateria no limite antes de cobrir os seis tipos de alvo.
const HOST = process.env.SCAN_HOST || "http://127.0.0.1:8797";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const req = async (path, { method = "GET", body = null, timeout = 180000, ip = "203.0.113.1" } = {}) => {
  const t0 = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error("timeout")), timeout);
  try {
    const r = await fetch(HOST + path, {
      method, body, signal: ctrl.signal,
      headers: {
        "content-type": "application/json", "user-agent": UA,
        origin: HOST, "CF-Connecting-IP": ip,
      },
    });
    const txt = await r.text();
    let j = null; try { j = JSON.parse(txt); } catch {}
    return { status: r.status, ms: Date.now() - t0, j, txt: j ? null : txt.slice(0, 250) };
  } catch (e) {
    return { erro: String(e?.message || e).slice(0, 90), ms: Date.now() - t0 };
  } finally { clearTimeout(timer); }
};

const ALVOS = [
  { tipo: "nome", valor: "CARLITO RIBEIRO DOS SANTOS", ip: "203.0.113.10" },
  { tipo: "nome", valor: "Maria da Silva", ip: "203.0.113.11" },
  { tipo: "email", valor: "teste.scan@example.com", ip: "203.0.113.12" },
  { tipo: "dominio", valor: "example.com", ip: "203.0.113.13" },
  { tipo: "ip", valor: "8.8.8.8", ip: "203.0.113.14" },
  { tipo: "cnpj", valor: "11444777000161", ip: "203.0.113.15" },
  { tipo: "telefone", valor: "11987654321", ip: "203.0.113.16" },
];

(async () => {
  console.log("=== TOKEN ===");
  const t = await req("/.netlify/functions/token", { timeout: 40000, ip: "203.0.113.1" });
  console.log(`  GET  -> HTTP ${t.status} ${t.ms}ms ${JSON.stringify(t.j ?? t.txt ?? t.erro).slice(0, 150)}`);
  if (!t.j?.siteKey) { console.log("  sem siteKey, encerrando"); return; }

  console.log("\n=== SCANS REAIS (Worker de validacao, workerd local) ===");
  for (const alvo of ALVOS) {
    // O token e vinculado ao alvo E ao IP: precisa de um token novo por consulta.
    const pt = await req("/.netlify/functions/token", {
      method: "POST", timeout: 40000, ip: alvo.ip,
      body: JSON.stringify({ cfToken: "XXXX.DUMMY.TOKEN.XXXX", alvo: alvo.valor }),
    });
    if (!pt.j?.token) { console.log(`\n--- ${alvo.tipo}: sem token -> ${JSON.stringify(pt.j ?? pt.txt).slice(0, 140)}`); continue; }
    const sc = await req("/api/scan", {
      method: "POST", timeout: 200000, ip: alvo.ip,
      body: JSON.stringify({ alvo: alvo.valor, token: pt.j.token }),
    });
    console.log(`\n--- ${alvo.tipo}: ${alvo.valor} -> HTTP ${sc.status} ${sc.ms}ms`);
    if (!sc.j) { console.log("   " + String(sc.txt ?? sc.erro).slice(0, 200)); continue; }
    if (sc.j.error) { console.log(`   ERRO: ${sc.j.error}`); continue; }
    const disp = sc.j.disponibilidade || {};
    const okIds = Object.keys(disp).filter(k => disp[k]);
    console.log(`   OK ${okIds.length}/${Object.keys(disp).length}: ${okIds.join(", ")}`);
    console.log(`   score: ${JSON.stringify(sc.j.score)}`);
    for (const f of sc.j.fontes || []) {
      const resumo = f.status === "ok"
        ? JSON.stringify(f.dados).slice(0, 170)
        : `ERRO: ${String(f.erro || "").slice(0, 110)}`;
      console.log(`     ${String(f.id).padEnd(14)} ${String(f.status).padEnd(7)} ${resumo}`);
    }
    if (sc.j.meta?.omitidas?.length) console.log(`   omitidas: ${JSON.stringify(sc.j.meta.omitidas)}`);
  }
})().catch(e => console.log("ERRO:", String(e).slice(0, 250)));
