// Diagnostico do servidor de desenvolvimento local.
//
// Responde a pergunta que aparece toda vez que a previa do editor falha:
// "quem esta segurando as portas?" e "sobrou servidor de uma sessao
// anterior?".
//
//   npm run dev:status
//   npm run dev:status -- --json
//
// Nao encerra nada: e somente leitura.
//
// Escopo: LOCAL ONLY. Le processos do proprio usuario e testa as portas
// locais com uma conexao TCP.

import { createConnection } from 'node:net';
import { spawnSync } from 'node:child_process';
import { listarInstancias, instanciaDesatacada, instanciaOrfa, portasCanonicas, processoVivo } from './dev-instancia.mjs';
import { cadeiaDe, listarProcessos, mapaDeProcessos } from './dev-processos.mjs';

const json = process.argv.includes('--json');

// Uma porta esta ocupada? Uma conexao TCP que da certo significa que
// alguem esta escutando ali.
function ocupada(porta) {
  return new Promise(resolve => {
    const socket = createConnection({ host: '127.0.0.1', port: Number(porta) });
    const fim = (resposta) => {
      socket.destroy();
      resolve(resposta);
    };
    socket.setTimeout(600);
    socket.once('connect', () => fim(true));
    socket.once('timeout', () => fim(false));
    socket.once('error', () => fim(false));
  });
}

// Quem esta escutando na porta? O netstat do Windows responde o PID do
// processo que segura a porta: e a forma de descobrir um servidor que
// perdeu o registro (e por isso nao pode ser encerrado pela politica).
function donoDePorta(porta) {
  if (process.platform !== 'win32') return null;
  const r = spawnSync('netstat.exe', ['-ano', '-p', 'TCP'], { encoding: 'utf8', windowsHide: true });
  if (!r.stdout) return null;
  const linhas = r.stdout.split('\n');
  for (const linha of linhas) {
    const partes = linha.trim().split(/\s+/);
    if (partes.length < 5) continue;
    const local = partes[1] || '';
    // Colunas: Protocolo | Endereco local | Endereco externo | Estado | PID
    const estado = partes[3] || '';
    if (estado.toUpperCase() !== 'LISTENING') continue;
    const portaLocal = Number(local.split(':').pop());
    if (portaLocal !== Number(porta)) continue;
    return { pid: Number(partes[4]) || null, estado, linha: linha.trim() };
  }
  return null;
}

async function main() {
  const canonicas = portasCanonicas();
  const registro = listarInstancias();
  const processos = listarProcessos();
  const mapa = mapaDeProcessos(processos);

  const instâncias = registro.map(inst => {
    const vivo = !inst.invalido && processoVivo(inst.pid);
    const cadeia = vivo ? cadeiaDe(inst.pid, { mapa }) : [];
    return {
      pid: inst.pid,
      porta: inst.porta ?? null,
      papel: inst.papel || null,
      classe: inst.classe || null,
      ppid: inst.ppid ?? null,
      vivo,
      orfao: vivo ? instanciaOrfa(inst, { mapa }) : null,
      // Um elo quebrado na cadeia de ancestrais significa que o processo
      // que dependia dele (o editor) morreu e o servidor sobreviveu.
      eloQuebrado: cadeia.find(elo => !elo.vivo)?.pid ?? null,
      // Servidor sobrevivente de uma sessao anterior: a arvore que o subiu
      // morreu e ele continua segurando a porta.
      desatacada: vivo ? instanciaDesatacada(inst, { mapa }) : false,
      cadeia: cadeia.map(elo => `${elo.pid}${elo.vivo ? '' : ' (morto)'}`),
      invalido: !!inst.invalido,
      iniciado_em: inst.iniciado_em || null
    };
  });

  const servidores = processos.filter(p => p.cmd && p.cmd.includes('dev-server.mjs'));
  const semRegistro = servidores
    .filter(p => !registro.some(i => i.pid === p.pid))
    .map(p => ({ pid: p.pid, ppid: p.ppid, cmd: p.cmd.slice(0, 160) }));

  const portas = [];
  for (const porta of canonicas) {
    const ocupada_ = await ocupada(porta);
    const dona = instâncias.find(i => i.porta === porta && i.vivo);
    const dono = ocupada_ ? donoDePorta(porta) : null;
    portas.push({
      porta,
      ocupada: ocupada_,
      registrada: !!dona,
      pid: dona?.pid ?? null,
      pidDoSistema: dono?.pid ?? null,
      donoSemRegistro: !!(dono?.pid && !registro.some(i => i.pid === dono.pid))
    });
  }

  const livres = portas.filter(p => !p.ocupada).map(p => p.porta);
  const resultado = {
    escopo: 'LOCAL ONLY; diagnostico do servidor de desenvolvimento',
    servidoresVivos: servidores.length,
    instanciasRegistradas: instâncias.length,
    portasCanonicas: canonicas,
    portasLivres: livres,
    portasOcupadas: portas.filter(p => p.ocupada).map(p => p.porta),
    portas,
    instancias: instâncias,
    foraDoRegistro: semRegistro,
    portasReservadasPeloEditor: process.env.PORT ? Number(process.env.PORT) : null
  };

  if (json) {
    console.log(JSON.stringify(resultado));
    return;
  }

  console.log('');
  console.log('  Diagnostico do servidor local');
  console.log('  ------------------------------------------------------------');
  console.log(`  servidores de dev vivos: ${resultado.servidoresVivos}`);
  console.log(`  portas canonicas livres: ${livres.join(', ') || 'nenhuma'}`);
  console.log(`  portas canonicas ocupadas: ${resultado.portasOcupadas.join(', ') || 'nenhuma'}`);
  console.log('');
  for (const inst of instâncias) {
    const estado = inst.invalido
      ? 'registro invalido'
      : inst.vivo
        ? (inst.desatacada ? `vivo (desatacado: elo ${inst.eloQuebrado ?? '?'} morto)` : inst.orfao ? 'vivo (orfao)' : inst.eloQuebrado ? `vivo (elo quebrado: ${inst.eloQuebrado})` : 'vivo')
        : 'morto';
    console.log(`  pid ${inst.pid}  porta ${inst.porta ?? '-'}  ${inst.papel ?? '-'}/${inst.classe ?? '-'}  pai ${inst.ppid ?? '-'}  ${estado}`);
    if (inst.cadeia.length) console.log(`      ancestrais: ${inst.cadeia.join(' <- ')}`);
  }
  for (const p of semRegistro) {
    console.log(`  pid ${p.pid}  SEM REGISTRO  pai ${p.ppid ?? '-'}`);
  }
  for (const p of portas.filter(p => p.ocupada)) {
    console.log(`  porta ${p.porta}: ${p.registrada ? `registrada (pid ${p.pid})` : 'SEM REGISTRO'}${p.donoSemRegistro ? `  pid do sistema ${p.pidDoSistema}` : ''}`);
  }
  if (!instâncias.length && !semRegistro.length) {
    console.log('  nenhum servidor registrado nem encontrado');
  }
  console.log('');
  if (resultado.portasOcupadas.length) {
    console.log('  Portas ocupadas por servidores deste projeto impedem a previa.');
    const desatacadas = instâncias.filter(i => i.vivo && i.desatacada).map(i => i.pid);
    if (desatacadas.length) {
      console.log('  Servidores desatacados (a arvore que os iniciou morreu): ' + desatacadas.join(', '));
      console.log('  Para encerrar so esses (preserva a previa atual): npm run dev:stop -- --desatacados');
    }
    console.log('  Para liberar (derruba a previa atual): npm run dev:stop -- --todos');
    console.log('  Para liberar so os orfaos (preserva a previa): npm run dev:stop -- --limpar');
  }
  console.log('');
}

await main();
