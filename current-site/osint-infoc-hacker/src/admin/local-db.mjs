// Banco em memoria para o modo local do painel.
//
// Por que existe: o painel precisa funcionar antes de existir um Supabase
// configurado (e no preview local do editor, que roda sem rede). Este modulo
// implementa exatamente a mesma superficie de RPC do banco remoto
// (db/migrations/0001_admin.sql), entao o resto do painel nao sabe a
// diferenca.
//
// Limites honestos do modo local:
//   - os dados morrem quando o processo termina (reiniciar o servidor apaga
//     sessoes, credenciais, proxies e historico);
//   - a chave de cifragem das credenciais e efemera (mesma regra do
//     Worker: fica em memoria, nunca em arquivo);
//   - ele so liga quando ADMIN_MODO_LOCAL=1, para que uma producao sem
//     banco configurado nunca caia aqui por acidente.
//
// O usuario do administrador e o mesmo do banco remoto. A senha vem de
// ADMIN_SENHA (variavel de ambiente, fora do repositorio); sem ela, o modo
// local usa a senha padrao local, que vale somente para esta memoria. A
// senha padrao local e o proprio nome de usuario (sem o '@'): o preview
// local abre com a credencial combinada e o repositorio nao carrega uma
// segunda copia do segredo. O modo local nunca roda em producao: em
// producao o painel fala com o Supabase, onde a senha real vive apenas como
// hash bcrypt.

import { pbkdf2Sync, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { CATALOGO } from './catalogo.meta.mjs';
import { hashMestre } from './cripto.mjs';

export const USUARIO_LOCAL = 'Gui170pretty';
export const SENHA_LOCAL_PADRAO = USUARIO_LOCAL;
const TTL_SESSAO_HORAS = 12;
const ITERACOES_PBKDF2 = 120000;

const agora = () => new Date().toISOString();

function hashear(senha) {
  const salt = randomBytes(16);
  const hash = pbkdf2Sync(String(senha), salt, ITERACOES_PBKDF2, 32, 'sha256');
  return `pbkdf2$${ITERACOES_PBKDF2}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

function conferir(senha, senhaHash) {
  const partes = String(senhaHash || '').split('$');
  if (partes.length !== 4 || partes[0] !== 'pbkdf2') return false;
  const iteracoes = Number(partes[1]);
  if (!Number.isFinite(iteracoes) || iteracoes < 1000) return false;
  let esperado;
  let recebido;
  try {
    esperado = Buffer.from(partes[3], 'base64url');
    recebido = pbkdf2Sync(String(senha), Buffer.from(partes[2], 'base64url'), iteracoes, esperado.length, 'sha256');
  } catch {
    return false;
  }
  return esperado.length === recebido.length && timingSafeEqual(esperado, recebido);
}

// O login aceita o '@' inicial como ruido de digitacao: o valor comparado e
// sempre o "nucleo" (sem o '@'). '@Gui170pretty' e 'Gui170pretty' sao o
// mesmo usuario, e o mesmo vale para a senha.
export const nucleo = valor => String(valor ?? '').replace(/^@+/, '').trim();

const estado = {
  usuarios: [],
  sessoes: new Map(),
  credenciais: new Map(),
  proxies: new Map(),
  visitas: [],
  eventos: [],
  fontes: new Map(),
  config: new Map(),
  iniciado: false
};

export function estadoLocal() {
  return estado;
}

export function iniciarBancoLocal(env = {}) {
  if (estado.iniciado) return estado;
  const senha = String(env.ADMIN_SENHA || '').trim() || SENHA_LOCAL_PADRAO;
  estado.usuarios.push({
    id: randomUUID(),
    usuario: USUARIO_LOCAL,
    senha_hash: hashear(senha),
    papel: 'admin',
    nome: 'Administrador (local)',
    ativo: true,
    criado_em: agora(),
    ultimo_acesso: null
  });
  for (const fonte of CATALOGO) {
    estado.fontes.set(fonte.id, {
      id: fonte.id,
      titulo: fonte.titulo,
      tipos: [...fonte.tipos],
      custo: fonte.custo,
      ttl: fonte.ttl,
      proveniencia: fonte.proveniencia,
      requer_env: fonte.requer_env,
      requer_tipo: fonte.requer_tipo,
      limite_minuto: fonte.limite_minuto,
      limite_dia: fonte.limite_dia,
      limite_texto: fonte.limite_texto,
      limite_origem: fonte.limite_origem,
      usa_proxy: fonte.usa_proxy,
      observacao: fonte.observacao,
      explicacoes: { ...fonte.explicacoes }
    });
  }
  // Registra o hash da chave mestra, igual ao `admin_bootstrap` do banco
  // remoto: sem isso, toda leitura de credencial seria recusada por
  // `admin_mestre_ok` e o painel mostraria todas as chaves como ausentes.
  const chaveMestre = String(env.CREDENCIAIS_MASTER_KEY || '').trim();
  if (chaveMestre.length >= 16) {
    estado.config.set('mestre', { hash: hashMestre(chaveMestre) });
  }
  estado.iniciado = true;
  return estado;
}

const sessaoValida = token => {
  const s = estado.sessoes.get(String(token || ''));
  if (!s) return null;
  if (new Date(s.expira_em).getTime() <= Date.now()) {
    estado.sessoes.delete(String(token));
    return null;
  }
  return s;
};

const mestreHash = () => String(estado.config.get('mestre')?.hash || '');
const mestreOk = hash => mestreHash() !== '' && mestreHash() === String(hash || '');

function painelDe(token, dias) {
  const sessao = sessaoValida(token);
  if (!sessao) return { ok: false, motivo: 'sessao invalida ou expirada' };
  const usuario = estado.usuarios.find(u => u.id === sessao.usuario_id);
  const vDays = Math.max(1, Math.min(Number(dias) || 30, 365));
  const desde = Date.now() - vDays * 86400000;
  const visitas = estado.visitas.filter(v => new Date(v.criado_em).getTime() >= desde);

  const contagem = {};
  for (const v of visitas) contagem[v.etapa] = (contagem[v.etapa] || 0) + 1;

  const porDia = new Map();
  for (const v of visitas) {
    const dia = String(v.criado_em).slice(0, 10);
    const chave = `${dia}|${v.etapa}`;
    porDia.set(chave, (porDia.get(chave) || 0) + 1);
  }
  const serie = [...porDia.entries()]
    .map(([chave, n]) => {
      const [dia, etapa] = chave.split('|');
      return { dia, etapa, n };
    })
    .sort((a, b) => (a.dia === b.dia ? a.etapa.localeCompare(b.etapa) : a.dia.localeCompare(b.dia)));

  const falhasMap = new Map();
  for (const v of visitas) {
    if (v.etapa !== 'falha') continue;
    const chave = `${v.fonte || '-'}|${v.codigo || 'erro'}`;
    const item = falhasMap.get(chave) || { fonte: v.fonte || null, codigo: v.codigo || 'erro', n: 0, ultimo_em: v.criado_em };
    item.n += 1;
    if (String(v.criado_em) > String(item.ultimo_em)) item.ultimo_em = v.criado_em;
    falhasMap.set(chave, item);
  }
  const falhas = [...falhasMap.values()].sort((a, b) => b.n - a.n).slice(0, 50);

  return {
    ok: true,
    usuario: { usuario: usuario?.usuario, nome: usuario?.nome, papel: usuario?.papel },
    dias: vDays,
    visitas: contagem,
    serie,
    falhas,
    eventos: [...estado.eventos].sort((a, b) => String(b.criado_em).localeCompare(String(a.criado_em))).slice(0, 30),
    credenciais: [...estado.credenciais.values()]
      .map(c => ({
        fonte: c.fonte,
        envname: c.envname,
        status: c.status,
        limite_minuto: c.limite_minuto,
        limite_dia: c.limite_dia,
        observacao: c.observacao,
        ultimo_uso: c.ultimo_uso,
        total_usos: c.total_usos,
        atualizado_em: c.atualizado_em
      }))
      .sort((a, b) => a.fonte.localeCompare(b.fonte)),
    proxies: [...estado.proxies.values()].sort((a, b) => String(a.criado_em).localeCompare(String(b.criado_em))),
    fontes: [...estado.fontes.values()].sort((a, b) => a.id.localeCompare(b.id)),
    mestre_configurado: mestreHash() !== ''
  };
}

// ---------------------------------------------------------------------------
// Superficie de RPC: mesmos nomes e mesmas semanticas do banco remoto.
// ---------------------------------------------------------------------------

export const RPC_LOCAL = {
  admin_mestre_hash() {
    return mestreHash();
  },
  admin_bootstrap(p_hash) {
    if (mestreHash() === '') {
      if (!p_hash || String(p_hash).length < 32) return { ok: false, motivo: 'hash invalido' };
      estado.config.set('mestre', { hash: String(p_hash) });
      return { ok: true, motivo: 'chave mestra registrada' };
    }
    return { ok: mestreOk(p_hash), motivo: 'chave mestra ja registrada' };
  },
  admin_mestre_ok(p_hash) {
    return mestreOk(p_hash);
  },
  admin_login(p_usuario, p_senha, p_agente, p_ip) {
    const nome = nucleo(p_usuario).toLowerCase();
    const usuario = estado.usuarios.find(u => u.usuario.toLowerCase() === nome && u.ativo);
    if (!usuario) return { ok: false, motivo: 'credencial invalida' };
    if (!conferir(nucleo(p_senha), usuario.senha_hash)) return { ok: false, motivo: 'credencial invalida' };
    const token = randomBytes(32).toString('hex');
    const expira = new Date(Date.now() + TTL_SESSAO_HORAS * 3600000).toISOString();
    estado.sessoes.set(token, {
      token,
      usuario_id: usuario.id,
      criado_em: agora(),
      expira_em: expira,
      ip: String(p_ip || '').slice(0, 64),
      agente: String(p_agente || '').slice(0, 200)
    });
    usuario.ultimo_acesso = agora();
    return { ok: true, token, usuario: usuario.usuario, nome: usuario.nome, papel: usuario.papel, expira_em: expira };
  },
  admin_sessao(p_token) {
    const sessao = sessaoValida(p_token);
    if (!sessao) return { ok: false, motivo: 'sessao invalida ou expirada' };
    const usuario = estado.usuarios.find(u => u.id === sessao.usuario_id);
    return {
      ok: true,
      usuario: usuario?.usuario,
      nome: usuario?.nome,
      papel: usuario?.papel,
      expira_em: sessao.expira_em
    };
  },
  admin_logout(p_token) {
    estado.sessoes.delete(String(p_token || ''));
    return { ok: true };
  },
  admin_credenciais_leitura(p_hash) {
    if (!mestreOk(p_hash)) return { ok: false, motivo: 'chave mestra nao confere', credenciais: [] };
    return {
      ok: true,
      credenciais: [...estado.credenciais.values()].map(c => ({
        fonte: c.fonte,
        envname: c.envname,
        ciphertext: c.ciphertext,
        status: c.status,
        limite_minuto: c.limite_minuto,
        limite_dia: c.limite_dia,
        observacao: c.observacao,
        ultimo_uso: c.ultimo_uso,
        total_usos: c.total_usos
      }))
    };
  },
  admin_credenciais_uso(p_hash, p_fonte) {
    if (!mestreOk(p_hash)) return { ok: false, motivo: 'chave mestra nao confere' };
    const c = estado.credenciais.get(String(p_fonte));
    if (c) {
      c.total_usos += 1;
      c.ultimo_uso = agora();
    }
    return { ok: true };
  },
  admin_credenciais_salvar(p_token, p_fonte, p_envname, p_ciphertext, p_status, p_limite_minuto, p_limite_dia, p_observacao) {
    if (!sessaoValida(p_token)) return { ok: false, motivo: 'sessao invalida ou expirada' };
    if (!p_fonte || String(p_fonte).length > 64) return { ok: false, motivo: 'fonte invalida' };
    if (!p_ciphertext || String(p_ciphertext).length < 8) return { ok: false, motivo: 'valor cifrado ausente' };
    const existente = estado.credenciais.get(String(p_fonte));
    estado.credenciais.set(String(p_fonte), {
      fonte: String(p_fonte),
      envname: String(p_envname || p_fonte),
      ciphertext: String(p_ciphertext),
      status: String(p_status || 'ativa'),
      limite_minuto: p_limite_minuto ?? null,
      limite_dia: p_limite_dia ?? null,
      observacao: p_observacao ?? null,
      criado_em: existente?.criado_em || agora(),
      atualizado_em: agora(),
      ultimo_uso: existente?.ultimo_uso || null,
      total_usos: existente?.total_usos || 0
    });
    return { ok: true };
  },
  admin_credenciais_apagar(p_token, p_fonte) {
    if (!sessaoValida(p_token)) return { ok: false, motivo: 'sessao invalida ou expirada' };
    estado.credenciais.delete(String(p_fonte));
    return { ok: true };
  },
  admin_proxies_leitura(p_hash) {
    if (!mestreOk(p_hash)) return { ok: false, motivo: 'chave mestra nao confere', proxies: [] };
    return { ok: true, proxies: [...estado.proxies.values()] };
  },
  admin_proxies_uso(p_hash, p_id, p_falhou) {
    if (!mestreOk(p_hash)) return { ok: false, motivo: 'chave mestra nao confere' };
    const proxy = estado.proxies.get(String(p_id));
    if (!proxy) return { ok: true };
    proxy.total_usos += 1;
    proxy.ultimo_uso = agora();
    if (p_falhou) {
      proxy.falhas += 1;
      proxy.cooldown_ate = new Date(Date.now() + 5 * 60000).toISOString();
    }
    return { ok: true };
  },
  admin_proxies_salvar(p_token, p_id, p_rotulo, p_url, p_esquema, p_ativo, p_peso) {
    if (!sessaoValida(p_token)) return { ok: false, motivo: 'sessao invalida ou expirada' };
    if (!p_url || String(p_url).length < 8 || String(p_url).length > 400) return { ok: false, motivo: 'url do proxy invalida' };
    if (!p_rotulo || String(p_rotulo).length > 80) return { ok: false, motivo: 'rotulo invalido' };
    const id = p_id ? String(p_id) : randomUUID();
    const existente = estado.proxies.get(id);
    estado.proxies.set(id, {
      id,
      rotulo: String(p_rotulo),
      url: String(p_url),
      esquema: String(p_esquema || 'http'),
      ativo: p_ativo !== false,
      peso: Math.max(1, Number(p_peso) || 1),
      cooldown_ate: existente?.cooldown_ate || null,
      falhas: existente?.falhas || 0,
      total_usos: existente?.total_usos || 0,
      ultimo_uso: existente?.ultimo_uso || null,
      criado_em: existente?.criado_em || agora()
    });
    return { ok: true, id };
  },
  admin_proxies_apagar(p_token, p_id) {
    if (!sessaoValida(p_token)) return { ok: false, motivo: 'sessao invalida ou expirada' };
    estado.proxies.delete(String(p_id));
    return { ok: true };
  },
  admin_registrar_visita(p_hash, p_etapa, p_alvo_tipo, p_fonte, p_codigo, p_ok, p_ms, p_job_id, p_ip_hash, p_agente) {
    if (!mestreOk(p_hash)) return { ok: false, motivo: 'chave mestra nao confere' };
    if (!p_etapa || String(p_etapa).length > 40) return { ok: false, motivo: 'etapa invalida' };
    estado.visitas.push({
      criado_em: agora(),
      etapa: String(p_etapa),
      alvo_tipo: p_alvo_tipo ? String(p_alvo_tipo).slice(0, 40) : null,
      fonte: p_fonte ? String(p_fonte).slice(0, 64) : null,
      codigo: p_codigo ? String(p_codigo).slice(0, 40) : null,
      ok: p_ok ?? null,
      ms: Number.isFinite(p_ms) ? p_ms : null,
      job_id: p_job_id || null,
      ip_hash: p_ip_hash ? String(p_ip_hash).slice(0, 64) : null,
      agente: p_agente ? String(p_agente).slice(0, 200) : null
    });
    if (estado.visitas.length > 5000) estado.visitas.shift();
    return { ok: true };
  },
  admin_registrar_evento(p_hash, p_tipo, p_fonte, p_codigo, p_mensagem, p_detalhe) {
    if (!mestreOk(p_hash)) return { ok: false, motivo: 'chave mestra nao confere' };
    estado.eventos.push({
      criado_em: agora(),
      tipo: String(p_tipo || 'evento').slice(0, 40),
      fonte: p_fonte ? String(p_fonte).slice(0, 64) : null,
      codigo: p_codigo ? String(p_codigo).slice(0, 40) : null,
      mensagem: p_mensagem ? String(p_mensagem).slice(0, 300) : null,
      detalhe: p_detalhe || null
    });
    if (estado.eventos.length > 1000) estado.eventos.shift();
    return { ok: true };
  },
  admin_painel(p_token, p_dias) {
    return painelDe(p_token, p_dias);
  },
  admin_fontes_leitura(p_hash) {
    if (!mestreOk(p_hash)) return { ok: false, motivo: 'chave mestra nao confere', fontes: [] };
    return { ok: true, fontes: [...estado.fontes.values()].map(f => ({ ...f, tipos: [...f.tipos] })) };
  },
  // Mesma semantica do SQL (0001_admin.sql): gravacao por linha inteira
  // (upsert). Nos campos descritivos, nulo = nao mexer. Nos campos
  // operacionais (limites, proxy, observacao), o valor e gravado como veio:
  // nulo = sem limite, que e como o operador limpa um limite.
  admin_fontes_salvar(
    p_token, p_id, p_titulo, p_tipos, p_custo, p_ttl, p_proveniencia,
    p_requer_env, p_requer_tipo, p_limite_minuto, p_limite_dia, p_limite_texto,
    p_limite_origem, p_usa_proxy, p_observacao, p_explicacoes
  ) {
    if (!sessaoValida(p_token)) return { ok: false, motivo: 'sessao invalida ou expirada' };
    const id = String(p_id || '');
    if (!id || id.length > 64) return { ok: false, motivo: 'fonte invalida' };
    const atual = estado.fontes.get(id) || {};
    const base = CATALOGO.find(f => f.id === id) || {};
    const linha = {
      id,
      titulo: p_titulo ?? atual.titulo ?? base.titulo ?? id,
      tipos: p_tipos ?? atual.tipos ?? (base.tipos ? [...base.tipos] : []),
      custo: p_custo ?? atual.custo ?? base.custo ?? 0,
      ttl: p_ttl ?? atual.ttl ?? base.ttl ?? 0,
      proveniencia: p_proveniencia ?? atual.proveniencia ?? base.proveniencia ?? null,
      requer_env: p_requer_env ?? atual.requer_env ?? base.requer_env ?? null,
      requer_tipo: p_requer_tipo ?? atual.requer_tipo ?? base.requer_tipo ?? null,
      limite_minuto: p_limite_minuto,
      limite_dia: p_limite_dia,
      limite_texto: p_limite_texto,
      limite_origem: p_limite_origem ?? atual.limite_origem ?? base.limite_origem ?? 'nao_publicado',
      usa_proxy: p_usa_proxy ?? atual.usa_proxy ?? base.usa_proxy ?? false,
      observacao: p_observacao,
      explicacoes: p_explicacoes ?? atual.explicacoes ?? (base.explicacoes ? { ...base.explicacoes } : {})
    };
    estado.fontes.set(id, linha);
    return { ok: true };
  }
};

// Assinaturas das RPCs, na mesma ordem dos parametros do SQL
// (db/migrations/0001_admin.sql). O modo local nao pode depender da ordem
// das chaves do objeto: cada chamada monta o objeto como quiser e a
// assinatura decide a posicao.
const ASSINATURAS = Object.freeze({
  admin_mestre_hash: [],
  admin_bootstrap: ['p_hash'],
  admin_mestre_ok: ['p_hash'],
  admin_login: ['p_usuario', 'p_senha', 'p_agente', 'p_ip'],
  admin_sessao: ['p_token'],
  admin_logout: ['p_token'],
  admin_credenciais_leitura: ['p_hash'],
  admin_credenciais_uso: ['p_hash', 'p_fonte'],
  admin_credenciais_salvar: ['p_token', 'p_fonte', 'p_envname', 'p_ciphertext', 'p_status', 'p_limite_minuto', 'p_limite_dia', 'p_observacao'],
  admin_credenciais_apagar: ['p_token', 'p_fonte'],
  admin_proxies_leitura: ['p_hash'],
  admin_proxies_uso: ['p_hash', 'p_id', 'p_falhou'],
  admin_proxies_salvar: ['p_token', 'p_id', 'p_rotulo', 'p_url', 'p_esquema', 'p_ativo', 'p_peso'],
  admin_proxies_apagar: ['p_token', 'p_id'],
  admin_registrar_visita: ['p_hash', 'p_etapa', 'p_alvo_tipo', 'p_fonte', 'p_codigo', 'p_ok', 'p_ms', 'p_job_id', 'p_ip_hash', 'p_agente'],
  admin_registrar_evento: ['p_hash', 'p_tipo', 'p_fonte', 'p_codigo', 'p_mensagem', 'p_detalhe'],
  admin_painel: ['p_token', 'p_dias'],
  admin_fontes_leitura: ['p_hash'],
  admin_fontes_salvar: [
    'p_token', 'p_id', 'p_titulo', 'p_tipos', 'p_custo', 'p_ttl', 'p_proveniencia',
    'p_requer_env', 'p_requer_tipo', 'p_limite_minuto', 'p_limite_dia', 'p_limite_texto',
    'p_limite_origem', 'p_usa_proxy', 'p_observacao', 'p_explicacoes'
  ]
});

export function chamarLocal(nome, parametros = {}) {
  const fn = RPC_LOCAL[nome];
  if (!fn) throw new Error(`rpc desconhecida: ${nome}`);
  const assinatura = ASSINATURAS[nome];
  if (!assinatura) throw new Error(`rpc sem assinatura local: ${nome}`);
  return fn(...assinatura.map(chave => (parametros ?? {})[chave] ?? null));
}
