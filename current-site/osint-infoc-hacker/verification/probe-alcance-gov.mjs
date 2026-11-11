// Mede o alcance de rede da maquina de verificacao: hosts .gov.br e o host
// do SINESP sao alcancaveis daqui ou a falha e da rede local?
const ALVOS = [
  ['sinesp-https', 'https://cidadao.sinesp.gov.br/'],
  ['sinesp-http', 'http://cidadao.sinesp.gov.br/'],
  ['sinesp-captcha', 'https://cidadao.sinesp.gov.br/sinesp-cidadao/mobile/captchaMobile.png'],
  ['receita', 'https://servicos.receita.fazenda.gov.br/'],
  ['gov-br', 'https://www.gov.br/'],
  ['detran-sp', 'https://www.detran.sp.gov.br/'],
  ['sinesp-porta-8443', 'https://cidadao.sinesp.gov.br:8443/'],
  ['serpro-placa', 'https://placa.serpro.gov.br/'],
  ['veiculos-fipe', 'https://veiculos.fipe.org.br/'],
  ['consultarplaca-site', 'https://www.consultarplaca.com.br/']
];

for (const [nome, url] of ALVOS) {
  const t0 = Date.now();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    const r = await fetch(url, { signal: ctrl.signal, redirect: 'manual' });
    clearTimeout(timer);
    console.log(JSON.stringify({ nome, status: r.status, ms: Date.now() - t0, tipo: r.headers.get('content-type') }));
  } catch (e) {
    const msg = String(e?.message || 'erro');
    const causa = String(e?.cause?.code || e?.cause?.message || '');
    console.log(JSON.stringify({ nome, status: 0, ms: Date.now() - t0, erro: msg, causa }));
  }
}
