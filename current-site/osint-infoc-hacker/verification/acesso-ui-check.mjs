// Verificacao no navegador da aba ACESSO (troca de senha do operador).
// Roda contra o servidor local em http://localhost:3000.
// O Playwright e global no ambiente; o import aponta para a copia global
// porque o projeto nao tem dependencia de navegador (o Worker nao roda
// navegador: este check so existe para provar a aba no painel local).
const { chromium } = await import('file:///C:/Users/USUARIO/AppData/Roaming/npm/node_modules/playwright/index.mjs');

const BASE = 'http://localhost:3000';
const USUARIO = 'Gui170pretty';
const SENHA_ATUAL = 'senha-de-teste-local';
const SENHA_NOVA = 'senha-nova-de-teste-local';

const navegador = await chromium.launch({ headless: true });
const pagina = await navegador.newPage();
const erros = [];
pagina.on('console', m => { if (m.type() === 'error') erros.push(m.text()); });
pagina.on('pageerror', e => erros.push('pageerror: ' + e.message));

const relatorio = {};
try {
  await pagina.goto(BASE + '/admin', { waitUntil: 'domcontentloaded' });
  await pagina.fill('#usuario', USUARIO);
  await pagina.fill('#senha', SENHA_ATUAL);
  await pagina.click('#entrar');
  await pagina.waitForSelector('#painel:not(.escondido)', { timeout: 15000 });
  relatorio.login = 'ok';

  // A aba ACESSO existe e esta no rol de abas.
  relatorio.abas = await pagina.$$eval('nav.abas button', bs => bs.map(b => b.dataset.aba));
  relatorio.botaoAcessoExiste = relatorio.abas.includes('acesso');

  // Antes de clicar: o painel de ACESSO esta escondido (display:none).
  relatorio.antesDisplay = await pagina.$eval('#aba-acesso', e => getComputedStyle(e).display);

  await pagina.click('nav.abas button[data-aba="acesso"]');
  await pagina.waitForTimeout(400);
  relatorio.depoisDisplay = await pagina.$eval('#aba-acesso', e => getComputedStyle(e).display);
  relatorio.depoisAltura = await pagina.$eval('#aba-acesso', e => e.getBoundingClientRect().height);
  relatorio.ariaSelecionada = await pagina.$eval('nav.abas button[data-aba="acesso"]', b => b.getAttribute('aria-selected'));
  relatorio.outrasAbasOcultas = await pagina.$$eval('section[role="tabpanel"]', ss =>
    ss.filter(s => s.id !== 'aba-acesso').map(s => ({ id: s.id, display: getComputedStyle(s).display })));

  // --- Validacao no cliente: campos vazios ---
  await pagina.click('#senha-salvar');
  await pagina.waitForTimeout(200);
  relatorio.msgVazios = await pagina.$eval('#senha-msg', e => e.textContent.trim());

  // --- Validacao no cliente: senhas novas diferentes ---
  await pagina.fill('#senha-atual', SENHA_ATUAL);
  await pagina.fill('#senha-nova', SENHA_NOVA);
  await pagina.fill('#senha-nova-2', SENHA_NOVA + '-x');
  await pagina.click('#senha-salvar');
  await pagina.waitForTimeout(200);
  relatorio.msgDivergentes = await pagina.$eval('#senha-msg', e => e.textContent.trim());

  // --- Troca valida ---
  await pagina.fill('#senha-nova-2', SENHA_NOVA);
  await pagina.click('#senha-salvar');
  await pagina.waitForTimeout(900);
  relatorio.msgTroca = await pagina.$eval('#senha-msg', e => e.textContent.trim());
  relatorio.classeMsg = await pagina.$eval('#senha-msg', e => e.className);

  // --- A sessao deve ser encerrada e voltar para o login ---
  await pagina.waitForTimeout(1800);
  relatorio.loginVisivelDepois = await pagina.$eval('#login', e => getComputedStyle(e).display);
  relatorio.painelOcultoDepois = await pagina.$eval('#painel', e => getComputedStyle(e).display);

  // --- Entrar com a senha nova ---
  await pagina.fill('#usuario', USUARIO);
  await pagina.fill('#senha', SENHA_NOVA);
  await pagina.click('#entrar');
  await pagina.waitForTimeout(1200);
  relatorio.loginComSenhaNova = await pagina.$eval('#painel', e => getComputedStyle(e).display !== 'none');

  // --- Entrar com a senha antiga (deve falhar) ---
  await pagina.evaluate(() => sessionStorage.clear());
  await pagina.goto(BASE + '/admin', { waitUntil: 'domcontentloaded' });
  await pagina.fill('#usuario', USUARIO);
  await pagina.fill('#senha', SENHA_ATUAL);
  await pagina.click('#entrar');
  await pagina.waitForTimeout(1200);
  relatorio.msgSenhaAntiga = await pagina.$eval('#login-msg', e => e.textContent.trim());

  // --- Restaurar a senha original ---
  await pagina.fill('#senha', SENHA_NOVA);
  await pagina.click('#entrar');
  await pagina.waitForTimeout(1200);
  const entrou = await pagina.$eval('#painel', e => getComputedStyle(e).display !== 'none');
  relatorio.reentrou = entrou;
  if (entrou) {
    await pagina.click('nav.abas button[data-aba="acesso"]');
    await pagina.waitForTimeout(300);
    await pagina.fill('#senha-atual', SENHA_NOVA);
    await pagina.fill('#senha-nova', SENHA_ATUAL);
    await pagina.fill('#senha-nova-2', SENHA_ATUAL);
    await pagina.click('#senha-salvar');
    await pagina.waitForTimeout(900);
    relatorio.msgRestauracao = await pagina.$eval('#senha-msg', e => e.textContent.trim());
  }
  relatorio.errosConsole = erros;
} catch (e) {
  relatorio.falha = String(e && e.message || e);
  relatorio.errosConsole = erros;
} finally {
  console.log(JSON.stringify(relatorio, null, 2));
  await navegador.close();
}
