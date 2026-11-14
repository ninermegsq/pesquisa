// Painel admin do scanner OSINT.
//
// O token de sessao fica no sessionStorage (some ao fechar a aba) e vai no
// cabecalho Authorization: nao ha cookie, portanto nao ha CSRF.
//
// Este arquivo e injetado no Worker como constante: nada de import, nada de
// bundler, nada de framework.

(function () {
  'use strict';

  var CHAVE_TOKEN = 'osint_admin_token';
  var estado = { token: null, painel: null, credenciais: [], proxies: [], fontes: [], fonteEditando: null };

  var $ = function (id) { return document.getElementById(id); };
  var texto = function (v) { return v === null || v === undefined ? '' : String(v); };

  function mostrar(el, msg, tipo) {
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'msg' + (msg ? (tipo === 'erro' ? ' erro' : ' ok') : '');
  }

  function api(caminho, opcoes) {
    opcoes = opcoes || {};
    var cabecalhos = { 'content-type': 'application/json' };
    if (estado.token) cabecalhos.authorization = 'Bearer ' + estado.token;
    return fetch(caminho, {
      method: opcoes.metodo || 'GET',
      headers: cabecalhos,
      body: opcoes.corpo ? JSON.stringify(opcoes.corpo) : undefined
    }).then(function (r) {
      return r.text().then(function (t) {
        var dados = null;
        try { dados = t ? JSON.parse(t) : null; } catch (e) { dados = { ok: false, motivo: 'resposta invalida do painel' }; }
        if (!r.ok) {
          var erro = new Error((dados && (dados.motivo || dados.error)) || ('HTTP ' + r.status));
          erro.status = r.status;
          erro.dados = dados;
          throw erro;
        }
        return dados;
      });
    });
  }

  function sair() {
    api('/api/admin/logout', { metodo: 'POST' }).catch(function () { /* sessao expirada: limpa assim mesmo */ })
      .then(function () {
        estado.token = null;
        estado.painel = null;
        try { sessionStorage.removeItem(CHAVE_TOKEN); } catch (e) { /* modo restrito */ }
        $('painel').classList.add('escondido');
        $('login').classList.remove('escondido');
        $('sair').classList.add('escondido');
        $('estado').textContent = 'deslogado';
      });
  }

  // ---------------------------------------------------------------------
  // Abas
  // ---------------------------------------------------------------------

  function trocarAba(nome) {
    var botoes = document.querySelectorAll('nav.abas button');
    for (var i = 0; i < botoes.length; i++) {
      botoes[i].setAttribute('aria-selected', botoes[i].getAttribute('data-aba') === nome ? 'true' : 'false');
    }
    var paineis = document.querySelectorAll('section[role="tabpanel"]');
    for (var j = 0; j < paineis.length; j++) {
      paineis[j].classList.toggle('ativo', paineis[j].id === 'aba-' + nome);
    }
  }

  // ---------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------

  function kpi(valor, rotulo) {
    return '<div class="kpi"><b>' + texto(valor) + '</b><span>' + texto(rotulo) + '</span></div>';
  }

  function dataBruta(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return texto(iso);
    return d.toLocaleString('pt-BR');
  }

  function renderAmbiente() {
    var p = estado.painel || {};
    var amb = p.ambiente || {};
    var html = '';
    html += kpi(amb.banco || 'desligado', 'banco');
    html += kpi(amb.master_key ? 'sim' : 'nao', 'chave mestra');
    html += kpi(amb.gateway_proxy ? 'sim' : 'nao', 'gateway de proxy');
    html += kpi(p.mestre_configurado ? 'sim' : 'nao', 'hash no banco');
    html += kpi(texto(p.usuario && p.usuario.usuario) || '—', 'operador');
    html += kpi(texto(p.dias) + 'd', 'janela');
    // O limite de login: quantas origens tentaram, quantas estao
    // bloqueadas e quantas tentativas cabem na janela. Sem identificar
    // origem nenhuma, so contagens.
    var lim = p.limite_login || null;
    if (lim) {
      html += kpi(texto(lim.origens || 0), 'origens na janela');
      html += kpi(texto(lim.tentativas || 0), 'tentativas');
      html += kpi(texto(lim.bloqueadas || 0), 'origens bloqueadas');
      html += kpi(texto(lim.max_tentativas || 0), 'tentativas por janela');
    }
    $('ambiente').innerHTML = html;
  }

  function renderFunil() {
    var p = estado.painel || {};
    var v = p.visitas || {};
    var html = '';
    html += kpi(texto(v.visita || 0), 'visitas');
    html += kpi(texto(v.scan || 0), 'scans iniciados');
    html += kpi(texto(v.scan_concluido || 0), 'scans concluidos');
    html += kpi(texto(v.falha || 0), 'falhas de fonte');
    html += kpi(texto(v.exportacao || 0), 'exportacoes');
    $('funil').innerHTML = html;
    $('funil-visitas').innerHTML = html;
    $('periodo').textContent = 'Ultimos ' + texto(p.dias || 30) + ' dias.';
  }

  function renderSerie() {
    var serie = (estado.painel && estado.painel.serie) || [];
    var cont = {};
    for (var i = 0; i < serie.length; i++) {
      var chave = serie[i].dia + '|' + serie[i].etapa;
      cont[chave] = (cont[chave] || 0) + serie[i].n;
    }
    var dias = Object.keys(cont).map(function (c) { return c.split('|')[0]; });
    dias.sort();
    var total = dias.length || 1;
    var html = '';
    for (var d = 0; d < dias.length; d++) {
      var dia = dias[d];
      for (var e = 0; e < serie.length; e++) {
        if (serie[e].dia !== dia) continue;
        var n = serie[e].n || 0;
        var alt = Math.max(3, Math.round((n / 12) * 90));
        html += '<div class="barra" title="' + dia + ' · ' + serie[e].etapa + ': ' + n + '">' +
          '<i style="height:' + alt + 'px"></i><span>' + dia.slice(5) + '</span></div>';
      }
    }
    $('serie').innerHTML = html || '<div class="sub">sem dados no periodo</div>';
  }

  function renderEventos() {
    var eventos = (estado.painel && estado.painel.eventos) || [];
    var html = '';
    for (var i = 0; i < eventos.length; i++) {
      var e = eventos[i];
      html += '<tr><td class="mono">' + dataBruta(e.criado_em) + '</td>' +
        '<td>' + texto(e.tipo) + '</td><td>' + texto(e.fonte || '—') + '</td>' +
        '<td class="mono">' + texto(e.codigo || '—') + '</td><td>' + texto(e.mensagem || '') + '</td></tr>';
    }
    $('eventos').innerHTML = html || '<tr><td colspan="5" class="sub">nenhum evento registrado</td></tr>';
  }

  function renderCredenciais() {
    var lista = estado.credenciais || [];
    var fontes = estado.fontes || [];
    var porFonte = {};
    for (var i = 0; i < fontes.length; i++) porFonte[fontes[i].id] = fontes[i];

    var html = '';
    for (var j = 0; j < lista.length; j++) {
      var c = lista[j];
      var f = porFonte[c.fonte] || {};
      var tag = c.status === 'ativa' ? 'ok' : (c.status === 'sem_chave' ? 'aus' : 'warn');
      var limite = texto(f.limite_texto || '');
      if (!limite && (c.limite_minuto || c.limite_dia)) {
        limite = (c.limite_minuto ? c.limite_minuto + '/min' : '') + (c.limite_dia ? ' ' + c.limite_dia + '/dia' : '');
      }
      var como = f.requer_tipo ? ('Requer ' + f.requer_tipo) : 'Chave opcional';
      if (f.observacao) como += ' · ' + f.observacao;
      html += '<tr>' +
        '<td><b>' + texto(c.fonte) + '</b><br><span class="sub">' + texto(f.titulo || '') + '</span></td>' +
        '<td class="mono">' + texto(c.envname) + '</td>' +
        '<td><span class="tag ' + tag + '">' + texto(c.status) + '</span></td>' +
        '<td class="mono">' + texto(c.origem) + (c.impressao ? '<br><span class="sub">' + texto(c.impressao) + '</span>' : '') + '</td>' +
        '<td class="mono">' + (c.limite_minuto || f.limite_minuto || '—') + '</td>' +
        '<td class="mono">' + (c.limite_dia || f.limite_dia || '—') + '</td>' +
        '<td>' + texto(como) + (limite ? '<br><span class="sub">' + texto(limite) + '</span>' : '') + '</td>' +
        '<td><button class="mini perigo" data-remover-credencial="' + texto(c.fonte) + '">REMOVER</button></td>' +
        '</tr>';
    }
    $('lista-chaves').innerHTML = html || '<tr><td colspan="8" class="sub">nenhuma credencial cadastrada</td></tr>';
  }

  function renderOpcoesDeFonte() {
    var sel = $('c-fonte');
    var atual = sel.value;
    var html = '';
    for (var i = 0; i < estado.fontes.length; i++) {
      var f = estado.fontes[i];
      if (!f.requer_env) continue;
      html += '<option value="' + texto(f.id) + '">' + texto(f.id) + ' (' + texto(f.requer_env) + ')</option>';
    }
    sel.innerHTML = html;
    if (atual) sel.value = atual;
  }

  function renderProxies() {
    var lista = estado.proxies || [];
    var html = '';
    for (var i = 0; i < lista.length; i++) {
      var p = lista[i];
      html += '<tr>' +
        '<td>' + texto(p.rotulo) + '</td>' +
        '<td class="mono">' + texto(p.url) + '</td>' +
        '<td class="mono">' + texto(p.esquema) + '</td>' +
        '<td><span class="tag ' + (p.ativo ? 'ok' : 'aus') + '">' + (p.ativo ? 'ativo' : 'inativo') + '</span></td>' +
        '<td class="mono">' + texto(p.peso) + '</td>' +
        '<td class="mono">' + texto(p.total_usos || 0) + '</td>' +
        '<td class="mono">' + texto(p.falhas || 0) + '</td>' +
        '<td class="mono">' + dataBruta(p.ultimo_uso) + '</td>' +
        '<td><button class="mini perigo" data-remover-proxy="' + texto(p.id) + '">REMOVER</button></td>' +
        '</tr>';
    }
    $('lista-proxies').innerHTML = html || '<tr><td colspan="9" class="sub">nenhum proxy cadastrado</td></tr>';
  }

  function renderFalhas() {
    var falhas = (estado.painel && estado.painel.falhas) || [];
    var fontes = estado.fontes || [];
    var porFonte = {};
    for (var i = 0; i < fontes.length; i++) porFonte[fontes[i].id] = fontes[i];

    var html = '';
    for (var j = 0; j < falhas.length; j++) {
      var f = falhas[j];
      var entrada = porFonte[f.fonte] || {};
      var explicacoes = entrada.explicacoes || {};
      var explicacao = explicacoes[f.codigo] || (explicacoes.erro && f.codigo === 'erro' ? explicacoes.erro : '');
      if (!explicacao && entrada.observacao) explicacao = entrada.observacao;
      html += '<tr>' +
        '<td><b>' + texto(f.fonte || '—') + '</b></td>' +
        '<td class="mono">' + texto(f.codigo) + '</td>' +
        '<td class="mono">' + texto(f.n) + '</td>' +
        '<td class="mono">' + dataBruta(f.ultimo_em) + '</td>' +
        '<td>' + texto(explicacao) + '</td>' +
        '</tr>';
    }
    $('lista-falhas').innerHTML = html || '<tr><td colspan="5" class="sub">nenhuma falha registrada no periodo</td></tr>';

    // Explicacao dos codigos: e o glossario de erro do motor.
    //
    // O texto de um codigo nao e unico: `http` significa uma coisa no GitHub,
    // outra no Xon e outra no CNJ. A versao anterior pegava o texto da
    // PRIMEIRA fonte do catalogo (gravatar) e mostrava esse texto para
    // qualquer falha, o que deixava o operador lendo sobre o gravatar uma
    // falha do CNJ.
    //
    // Aqui o texto vem da fonte que de fato falhou. Para um codigo que
    // apareceu no periodo, cada fonte que falhou entra com o seu texto. Para
    // um codigo que nao apareceu, entra o texto padrao do motor (o mais
    // comum entre as fontes), para o glossario continuar completo.
    var porFonteCodigo = {};
    for (var k = 0; k < falhas.length; k++) {
      var fl = falhas[k];
      var codigoFalha = fl.codigo || 'erro';
      var entradaFalha = porFonte[fl.fonte] || {};
      var explicacoesFalha = entradaFalha.explicacoes || {};
      var textoFalha = explicacoesFalha[codigoFalha] ||
        (explicacoesFalha.erro && codigoFalha === 'erro' ? explicacoesFalha.erro : '');
      if (!textoFalha && entradaFalha.observacao) textoFalha = entradaFalha.observacao;
      if (!porFonteCodigo[codigoFalha]) porFonteCodigo[codigoFalha] = [];
      porFonteCodigo[codigoFalha].push({ fonte: fl.fonte || '—', texto: textoFalha });
    }

    // Todos os codigos que o catalogo conhece, para o glossario nao depender
    // de ter havido falha no periodo.
    var contagem = {};
    for (var i = 0; i < fontes.length; i++) {
      var ex = fontes[i].explicacoes || {};
      for (var cod in ex) {
        if (!Object.prototype.hasOwnProperty.call(ex, cod)) continue;
        if (!contagem[cod]) contagem[cod] = { total: 0, textos: {} };
        contagem[cod].total++;
        contagem[cod].textos[ex[cod]] = (contagem[cod].textos[ex[cod]] || 0) + 1;
      }
    }

    var html2 = '';
    var codigosOrdenados = Object.keys(contagem).sort();
    for (var c = 0; c < codigosOrdenados.length; c++) {
      var codigo = codigosOrdenados[c];
      html2 += '<div class="explica"><b>' + texto(codigo) + '</b>';
      if (porFonteCodigo[codigo]) {
        // As fontes que falharam de fato com este codigo.
        for (var m = 0; m < porFonteCodigo[codigo].length; m++) {
          html2 += '<div class="sub">' + texto(porFonteCodigo[codigo][m].fonte) + '</div>' +
            texto(porFonteCodigo[codigo][m].texto);
        }
      } else {
        // Sem falha no periodo: mostra o texto padrao do motor, que e o mais
        // comum entre as fontes do catalogo.
        var textos = contagem[codigo].textos;
        var padrao = '';
        var melhor = -1;
        for (var t in textos) {
          if (!Object.prototype.hasOwnProperty.call(textos, t)) continue;
          if (textos[t] > melhor) { melhor = textos[t]; padrao = t; }
        }
        html2 += texto(padrao);
      }
      html2 += '</div>';
    }
    $('codigos').innerHTML = html2 || '<div class="sub">catalogo indisponivel</div>';
  }

  // ---------------------------------------------------------------------
  // Fontes: o que o operador ajusta em cada fonte do catalogo
  // ---------------------------------------------------------------------

  function acharFonte(id) {
    for (var i = 0; i < estado.fontes.length; i++) {
      if (estado.fontes[i].id === id) return estado.fontes[i];
    }
    return null;
  }

  function renderFontes() {
    var fontes = estado.fontes || [];
    var filtro = $('f-filtro').value;
    var busca = ($('f-busca').value || '').toLowerCase();
    var html = '';
    for (var i = 0; i < fontes.length; i++) {
      var f = fontes[i];
      if (filtro === 'chave' && !f.requer_env) continue;
      if (filtro === 'proxy' && !f.usa_proxy) continue;
      if (filtro === 'ajustada' && !f.ajustado) continue;
      if (busca) {
        var alvo = (f.id + ' ' + (f.titulo || '') + ' ' + (f.requer_env || '')).toLowerCase();
        if (alvo.indexOf(busca) === -1) continue;
      }
      var tipos = f.tipos || [];
      var tags = '';
      for (var t = 0; t < tipos.length; t++) tags += '<span class="tag">' + texto(tipos[t]) + '</span> ';
      html += '<tr>' +
        '<td><b>' + texto(f.id) + '</b><br><span class="sub">' + texto(f.titulo || '') + '</span>' +
        (f.ajustado ? '<br><span class="tag warn">ajustada</span>' : '') + '</td>' +
        '<td>' + (tags || '<span class="sub">—</span>') + '</td>' +
        '<td class="mono">' + texto(f.requer_env || '—') + '</td>' +
        '<td class="mono">' + texto(f.limite_minuto === null || f.limite_minuto === undefined ? '—' : f.limite_minuto) + '</td>' +
        '<td class="mono">' + texto(f.limite_dia === null || f.limite_dia === undefined ? '—' : f.limite_dia) + '</td>' +
        '<td><span class="tag ' + (f.usa_proxy ? 'warn' : '') + '">' + (f.usa_proxy ? 'usa' : 'direto') + '</span></td>' +
        '<td>' + texto(f.limite_texto || '—') + '</td>' +
        '<td><button class="mini" data-editar-fonte="' + texto(f.id) + '">EDITAR</button></td>' +
        '</tr>';
    }
    $('lista-fontes').innerHTML = html || '<tr><td colspan="8" class="sub">nenhuma fonte com esse filtro</td></tr>';
  }

  function abrirEditor(id) {
    var f = acharFonte(id);
    if (!f) return;
    estado.fonteEditando = id;
    $('f-editor-titulo').textContent = 'Editar fonte · ' + f.id;
    $('f-titulo').value = f.titulo || '';
    $('f-custo').value = (f.custo === null || f.custo === undefined) ? '' : f.custo;
    $('f-ttl').value = (f.ttl === null || f.ttl === undefined) ? '' : f.ttl;
    $('f-min').value = (f.limite_minuto === null || f.limite_minuto === undefined) ? '' : f.limite_minuto;
    $('f-dia').value = (f.limite_dia === null || f.limite_dia === undefined) ? '' : f.limite_dia;
    $('f-texto').value = f.limite_texto || '';
    $('f-proxy').value = f.usa_proxy ? 'sim' : 'nao';
    $('f-obs').value = f.observacao || '';
    $('f-explicacoes').value = explicacoesParaTexto(f.explicacoes);
    mostrar($('f-msg'), '', 'ok');
    if ($('editor-fonte').scrollIntoView) $('editor-fonte').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Serializa o objeto de explicacoes (codigo -> texto) no formato de linhas
  // "codigo = texto" que o editor mostra. As chaves sao ordenadas para que o
  // texto devolvido seja sempre o mesmo para a mesma fonte.
  function explicacoesParaTexto(explicacoes) {
    if (!explicacoes || typeof explicacoes !== 'object') return '';
    var linhas = [];
    var codigos = Object.keys(explicacoes).sort();
    for (var i = 0; i < codigos.length; i++) {
      var codigo = codigos[i];
      var valor = explicacoes[codigo];
      if (valor === null || valor === undefined) continue;
      linhas.push(codigo + ' = ' + String(valor).replace(/\r?\n/g, ' '));
    }
    return linhas.join('\n');
  }

  // Le o editor de explicacoes de volta para o objeto { codigo: texto }.
  // Devolve null quando o campo esta vazio (nada a gravar) e lanca um erro
  // quando uma linha nao tem o separador " = ", para que o painel explique o
  // problema em vez de gravar um objeto invalido.
  function textoParaExplicacoes(bruto) {
    var texto = String(bruto || '').trim();
    if (!texto) return null;
    var saida = {};
    var linhas = texto.split(/\r?\n/);
    for (var i = 0; i < linhas.length; i++) {
      var linha = linhas[i].trim();
      if (!linha) continue;
      var separador = linha.indexOf('=');
      if (separador < 1) {
        throw new Error('linha ' + (i + 1) + ' invalida: use "codigo = texto"');
      }
      var codigo = linha.slice(0, separador).trim();
      var valor = linha.slice(separador + 1).trim();
      if (!codigo) throw new Error('linha ' + (i + 1) + ' invalida: o codigo esta vazio');
      saida[codigo] = valor;
    }
    return Object.keys(saida).length ? saida : null;
  }

  function restaurarPadrao() {
    var f = estado.fonteEditando ? acharFonte(estado.fonteEditando) : null;
    var p = f && f.padrao;
    if (!p) { mostrar($('f-msg'), 'padrao do catalogo indisponivel', 'erro'); return; }
    $('f-titulo').value = p.titulo || '';
    $('f-custo').value = (p.custo === null || p.custo === undefined) ? '' : p.custo;
    $('f-ttl').value = (p.ttl === null || p.ttl === undefined) ? '' : p.ttl;
    $('f-min').value = (p.limite_minuto === null || p.limite_minuto === undefined) ? '' : p.limite_minuto;
    $('f-dia').value = (p.limite_dia === null || p.limite_dia === undefined) ? '' : p.limite_dia;
    $('f-texto').value = p.limite_texto || '';
    $('f-proxy').value = p.usa_proxy ? 'sim' : 'nao';
    $('f-obs').value = p.observacao || '';
    $('f-explicacoes').value = explicacoesParaTexto(p.explicacoes);
    mostrar($('f-msg'), 'valores do catalogo carregados; clique em SALVAR para gravar', 'ok');
  }

  function salvarFonte() {
    var id = estado.fonteEditando;
    if (!id) { mostrar($('f-msg'), 'escolha uma fonte na lista', 'erro'); return; }
    var f = acharFonte(id);
    if (!f) { mostrar($('f-msg'), 'fonte nao encontrada', 'erro'); return; }
    var numero = function (v) { return v === '' ? null : Number(v); };
    var textoOuNulo = function (v) { var t = (v || '').trim(); return t ? t : null; };
    var explicacoes;
    try {
      explicacoes = textoParaExplicacoes($('f-explicacoes').value);
    } catch (e) {
      mostrar($('f-msg'), e.message || 'explicacao invalida', 'erro');
      return;
    }
    // Editor vazio com explicacoes existentes: manda um objeto vazio, que
    // restaura a documentacao do catalogo. Sem isso, `null` manteria o texto
    // antigo e o operador nao conseguiria voltar ao padrao por aqui.
    if (explicacoes === null && f.explicacoes && Object.keys(f.explicacoes).length) {
      explicacoes = {};
    }
    api('/api/admin/fontes', {
      metodo: 'POST',
      corpo: {
        id: id,
        titulo: textoOuNulo($('f-titulo').value),
        tipos: Array.isArray(f.tipos) ? f.tipos : null,
        custo: numero($('f-custo').value),
        ttl: numero($('f-ttl').value),
        proveniencia: f.proveniencia || null,
        requer_env: f.requer_env || null,
        requer_tipo: f.requer_tipo || null,
        limite_minuto: numero($('f-min').value),
        limite_dia: numero($('f-dia').value),
        limite_texto: textoOuNulo($('f-texto').value),
        limite_origem: f.limite_origem || null,
        usa_proxy: $('f-proxy').value === 'sim',
        observacao: textoOuNulo($('f-obs').value),
        explicacoes: explicacoes
      }
    }).then(function () {
      mostrar($('f-msg'), 'fonte gravada: ' + id, 'ok');
      return carregar();
    }).catch(function (e) {
      mostrar($('f-msg'), e.message || 'falha ao gravar', 'erro');
    });
  }

  function renderTudo() {
    renderAmbiente();
    renderFunil();
    renderSerie();
    renderEventos();
    renderCredenciais();
    renderOpcoesDeFonte();
    renderProxies();
    renderFontes();
    renderFalhas();
    var p = estado.painel || {};
    $('estado').textContent = (p.usuario && p.usuario.usuario ? p.usuario.usuario : 'operador') + ' · ' +
      ((p.ambiente && p.ambiente.banco) || 'desligado');
    $('rodape').textContent = 'Painel ' + ((p.ambiente && p.ambiente.banco) || 'desligado') + ' · sessao local do operador';
    if (p.ambiente && p.ambiente.banco === 'local') {
      $('aviso-local').classList.remove('escondido');
    }
  }

  // ---------------------------------------------------------------------
  // Carga
  // ---------------------------------------------------------------------

  function carregar() {
    return api('/api/admin/painel?dias=30').then(function (painel) {
      estado.painel = painel;
      if (!estado.fontes || !estado.fontes.length) estado.fontes = painel.fontes || [];
      var cred = api('/api/admin/credenciais');
      var prox = api('/api/admin/proxies');
      var fontes = api('/api/admin/fontes');
      return Promise.all([cred, prox, fontes]).then(function (r) {
        estado.credenciais = (r[0] && r[0].credenciais) || [];
        estado.proxies = (r[1] && r[1].proxies) || [];
        if (r[2] && r[2].fontes && r[2].fontes.length) estado.fontes = r[2].fontes;
        renderTudo();
      });
    });
  }

  function entrar() {
    var usuario = $('usuario').value;
    var senha = $('senha').value;
    if (!usuario || !senha) {
      mostrar($('login-msg'), 'informe usuario e senha', 'erro');
      return;
    }
    api('/api/admin/login', { metodo: 'POST', corpo: { usuario: usuario, senha: senha } })
      .then(function (r) {
        estado.token = r.token;
        try { sessionStorage.setItem(CHAVE_TOKEN, r.token); } catch (e) { /* modo restrito */ }
        $('login').classList.add('escondido');
        $('painel').classList.remove('escondido');
        $('sair').classList.remove('escondido');
        $('senha').value = '';
        return carregar();
      })
      .catch(function (e) {
        mostrar($('login-msg'), e.message || 'nao foi possivel entrar', 'erro');
      });
  }

  // Troca da senha do operador. A confirmacao em dois campos existe para
  // que uma digitacao errada nao derrube o acesso: a troca encerra todas as
  // sessoes, inclusive a que esta em uso.
  function trocarSenha() {
    var atual = $('senha-atual').value;
    var nova = $('senha-nova').value;
    var repetida = $('senha-nova-2').value;
    if (!atual || !nova) {
      mostrar($('senha-msg'), 'informe a senha atual e a senha nova', 'erro');
      return;
    }
    if (nova !== repetida) {
      mostrar($('senha-msg'), 'a senha nova e a repeticao nao batem', 'erro');
      return;
    }
    if (nova.length < 8) {
      mostrar($('senha-msg'), 'a senha nova precisa de ao menos 8 caracteres', 'erro');
      return;
    }
    api('/api/admin/senha', {
      metodo: 'POST',
      corpo: { senha_atual: atual, senha_nova: nova }
    }).then(function (r) {
      $('senha-atual').value = '';
      $('senha-nova').value = '';
      $('senha-nova-2').value = '';
      mostrar($('senha-msg'), (r && r.motivo) || 'senha trocada', 'ok');
      // A troca derruba as sessoes: volta para a tela de login.
      setTimeout(sair, 1200);
    }).catch(function (e) {
      mostrar($('senha-msg'), e.message || 'falha ao trocar a senha', 'erro');
    });
  }

  // ---------------------------------------------------------------------
  // Eventos
  // ---------------------------------------------------------------------

  document.addEventListener('DOMContentLoaded', function () {
    var botoes = document.querySelectorAll('nav.abas button');
    for (var i = 0; i < botoes.length; i++) {
      (function (botao) {
        botao.addEventListener('click', function () { trocarAba(botao.getAttribute('data-aba')); });
      })(botoes[i]);
    }

    $('entrar').addEventListener('click', entrar);
    $('usuario').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('senha').focus(); });
    $('senha').addEventListener('keydown', function (e) { if (e.key === 'Enter') entrar(); });
    $('sair').addEventListener('click', sair);

    $('c-salvar').addEventListener('click', function () {
      var fonte = $('c-fonte').value;
      var valor = $('c-valor').value;
      if (!fonte || !valor) {
        mostrar($('c-msg'), 'escolha a fonte e informe o valor', 'erro');
        return;
      }
      api('/api/admin/credenciais', {
        metodo: 'POST',
        corpo: {
          fonte: fonte,
          valor: valor,
          status: $('c-status').value,
          limite_minuto: $('c-min').value === '' ? null : Number($('c-min').value),
          limite_dia: $('c-dia').value === '' ? null : Number($('c-dia').value),
          observacao: $('c-obs').value
        }
      }).then(function () {
        mostrar($('c-msg'), 'credencial gravada', 'ok');
        $('c-valor').value = '';
        return carregar();
      }).catch(function (e) {
        mostrar($('c-msg'), e.message || 'falha ao gravar', 'erro');
      });
    });

    $('p-salvar').addEventListener('click', function () {
      var rotulo = $('p-rotulo').value;
      var url = $('p-url').value;
      if (!rotulo || !url) {
        mostrar($('proxies-msg'), 'informe rotulo e endereco', 'erro');
        return;
      }
      api('/api/admin/proxies', {
        metodo: 'POST',
        corpo: { rotulo: rotulo, url: url, esquema: $('p-esquema').value, ativo: true, peso: Number($('p-peso').value) || 1 }
      }).then(function () {
        mostrar($('proxies-msg'), 'proxy cadastrado', 'ok');
        $('p-rotulo').value = '';
        $('p-url').value = '';
        return carregar();
      }).catch(function (e) {
        mostrar($('proxies-msg'), e.message || 'falha ao cadastrar', 'erro');
      });
    });

    $('f-filtro').addEventListener('change', renderFontes);
    $('f-busca').addEventListener('input', renderFontes);
    $('f-salvar').addEventListener('click', salvarFonte);
    $('f-padrao').addEventListener('click', restaurarPadrao);
    $('f-cancelar').addEventListener('click', function () {
      estado.fonteEditando = null;
      $('f-editor-titulo').textContent = 'Editar fonte';
      mostrar($('f-msg'), '', 'ok');
    });

    $('senha-salvar').addEventListener('click', trocarSenha);

    document.addEventListener('click', function (e) {
      var alvo = e.target;
      if (!alvo || !alvo.getAttribute) return;
      var editarFonte = alvo.getAttribute('data-editar-fonte');
      if (editarFonte) {
        abrirEditor(editarFonte);
        return;
      }
      var removerCred = alvo.getAttribute('data-remover-credencial');
      if (removerCred) {
        if (!window.confirm('Remover a credencial de ' + removerCred + '?')) return;
        api('/api/admin/credenciais?fonte=' + encodeURIComponent(removerCred), { metodo: 'DELETE' })
          .then(function () { mostrar($('chaves-msg'), 'credencial removida', 'ok'); return carregar(); })
          .catch(function (err) { mostrar($('chaves-msg'), err.message || 'falha ao remover', 'erro'); });
        return;
      }
      var removerProxy = alvo.getAttribute('data-remover-proxy');
      if (removerProxy) {
        if (!window.confirm('Remover este proxy do pool?')) return;
        api('/api/admin/proxies?id=' + encodeURIComponent(removerProxy), { metodo: 'DELETE' })
          .then(function () { mostrar($('proxies-msg'), 'proxy removido', 'ok'); return carregar(); })
          .catch(function (err) { mostrar($('proxies-msg'), err.message || 'falha ao remover', 'erro'); });
      }
    });

    // Sessao guardada: tenta continuar onde parou.
    var guardado = null;
    try { guardado = sessionStorage.getItem(CHAVE_TOKEN); } catch (e) { /* modo restrito */ }
    if (guardado) {
      estado.token = guardado;
      $('login').classList.add('escondido');
      $('painel').classList.remove('escondido');
      $('sair').classList.remove('escondido');
      carregar().catch(function (e) {
        if (e.status === 401) {
          estado.token = null;
          try { sessionStorage.removeItem(CHAVE_TOKEN); } catch (erro) { /* modo restrito */ }
          $('login').classList.remove('escondido');
          $('painel').classList.add('escondido');
          $('sair').classList.add('escondido');
          $('estado').textContent = 'sessao expirada';
        } else {
          $('estado').textContent = 'erro: ' + (e.message || 'desconhecido');
        }
      });
    } else {
      $('estado').textContent = 'deslogado';
    }
  });
})();
