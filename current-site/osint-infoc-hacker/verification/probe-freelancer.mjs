// Medicao do sinal do Freelancer: a fonte `email_registro` le o 409 como
// "e-mail em uso" e o 200 como "disponivel", mas a API respondeu HTTP 400 na
// sondagem de 2026-11-11. Este probe imprime status e corpo (truncado) para
// dois enderecos, so para decidir como tratar o 400.
//
// Consulta de disponibilidade: nao cria conta nem dispara e-mail.
const checar = async (email) => {
  const t0 = Date.now();
  const r = await fetch('https://www.freelancer.com/api/users/0.1/users/check?compact=true&new_errors=true', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'ostnt.online scanner (+https://ostnt.online)' },
    body: JSON.stringify({ user: { email } }),
  });
  const txt = await r.text();
  console.log(JSON.stringify({
    email, status: r.status, ms: Date.now() - t0,
    corpo: txt.replace(/\s+/g, ' ').slice(0, 220),
  }));
  await new Promise((r2) => setTimeout(r2, 1500));
};

await checar('teste@example.com');
await checar('ostnt.auditoria.2026@gmail.com');
