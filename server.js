const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 3000;
const ACCESS_TOKEN = process.env.MERCADO_PAGO_ACCESS_TOKEN;
const SENHA_PAINEL = process.env.SENHA_PAINEL || "231075";
const TOKEN_PAINEL = process.env.TOKEN_PAINEL || "ducha_pix_logado";

const ARQUIVO_DADOS = path.join(__dirname, "dados.json");

let ultimoPagamentoId = null;
let pagamentosPendentes = [];
let pagamentosEntregues = [];
let historicoPagamentos = [];

function salvarDados() {
  try {
    const dados = {
      ultimoPagamentoId,
      pagamentosPendentes,
      pagamentosEntregues,
      historicoPagamentos
    };
    fs.writeFileSync(ARQUIVO_DADOS, JSON.stringify(dados, null, 2));
    console.log("Dados salvos em dados.json");
  } catch (erro) {
    console.log("Erro ao salvar dados:", erro.message);
  }
}

function carregarDados() {
  try {
    if (fs.existsSync(ARQUIVO_DADOS)) {
      const bruto = fs.readFileSync(ARQUIVO_DADOS, "utf8");
      const dados = JSON.parse(bruto);

      ultimoPagamentoId = dados.ultimoPagamentoId || null;
      pagamentosPendentes = dados.pagamentosPendentes || [];
      pagamentosEntregues = dados.pagamentosEntregues || [];
      historicoPagamentos = dados.historicoPagamentos || [];

      console.log("Dados carregados de dados.json");
    } else {
      console.log("Arquivo dados.json ainda não existe. Iniciando vazio.");
    }
  } catch (erro) {
    console.log("Erro ao carregar dados:", erro.message);
  }
}

carregarDados();

function valorPixSeguro(req) {
  let valor = parseFloat(req.query.valor);
  if (isNaN(valor)) valor = 8;
  if (valor < 5) valor = 5;
  if (valor > 50) valor = 50;
  return Number(valor.toFixed(2));
}

function formatarMoeda(valor) {
  return Number(valor || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });
}

function totalFaturado() {
  return historicoPagamentos.reduce((total, p) => total + Number(p.valor || 0), 0);
}

function extrairDataBR(dataTexto) {
  try {
    const apenasData = String(dataTexto || "").split(",")[0].trim();
    const partes = apenasData.split("/");

    if (partes.length !== 3) return null;

    const dia = Number(partes[0]);
    const mes = Number(partes[1]) - 1;
    const ano = Number(partes[2]);

    return new Date(ano, mes, dia);
  } catch {
    return null;
  }
}

function mesmoDia(dataA, dataB) {
  return (
    dataA &&
    dataB &&
    dataA.getFullYear() === dataB.getFullYear() &&
    dataA.getMonth() === dataB.getMonth() &&
    dataA.getDate() === dataB.getDate()
  );
}

function mesmoMes(dataA, dataB) {
  return (
    dataA &&
    dataB &&
    dataA.getFullYear() === dataB.getFullYear() &&
    dataA.getMonth() === dataB.getMonth()
  );
}

function resumoFinanceiro() {
  const hoje = new Date();
  const ontem = new Date();
  ontem.setDate(hoje.getDate() - 1);

  let totalHoje = 0;
  let totalOntem = 0;
  let totalMes = 0;
  let banhosHoje = 0;

  historicoPagamentos.forEach(p => {
    const dataPagamento = extrairDataBR(p.data);
    const valor = Number(p.valor || 0);

    if (mesmoDia(dataPagamento, hoje)) {
      totalHoje += valor;
      banhosHoje++;
    }

    if (mesmoDia(dataPagamento, ontem)) {
      totalOntem += valor;
    }

    if (mesmoMes(dataPagamento, hoje)) {
      totalMes += valor;
    }
  });

  return {
    totalHoje,
    totalOntem,
    totalMes,
    banhosHoje
  };
}

function painelAutorizado(req) {
  const cookie = req.headers.cookie || "";
  return cookie.includes(`painel_token=${TOKEN_PAINEL}`);
}

function telaLogin(erro = false) {
  return `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Acesso ao Painel</title>
<style>
body{font-family:Arial;background:#06152b;color:white;margin:0;padding:20px;text-align:center}
.card{max-width:420px;margin:80px auto;background:#0b2447;padding:25px;border-radius:15px;box-shadow:0 0 20px #00d9ff55}
h1{color:#00e5ff}
input{width:90%;padding:15px;border-radius:8px;border:0;font-size:22px;text-align:center;margin-top:15px}
button{width:95%;padding:15px;margin-top:15px;border:0;border-radius:8px;background:#00aaff;color:white;font-size:20px;font-weight:bold}
.erro{color:#ff5252;margin-top:15px}
</style>
</head>
<body>
<div class="card">
  <h1>Painel Ducha PIX</h1>
  <p>Digite a senha para acessar</p>
  <form method="POST" action="/login-painel">
    <input name="senha" type="password" placeholder="Senha" autocomplete="off">
    <button type="submit">ENTRAR</button>
  </form>
  ${erro ? '<div class="erro">Senha incorreta</div>' : ''}
</div>
</body>
</html>
  `;
}

app.get("/", (req, res) => {
  res.send("Servidor PIX da Ducha Online - V5.32");
});

app.get("/status", (req, res) => {
  const resumo = resumoFinanceiro();

  res.json({
    sistema: "DUCHA PIX",
    versao: "5.32",
    online: true,
    ultimoPagamentoId,
    pendentes: pagamentosPendentes.length,
    entregues: pagamentosEntregues.length,
    historico: historicoPagamentos.length,
    totalFaturado: totalFaturado(),
    totalHoje: resumo.totalHoje,
    totalOntem: resumo.totalOntem,
    totalMes: resumo.totalMes,
    banhosHoje: resumo.banhosHoje
  });
});

async function criarPix(valorPix) {
  const response = await axios.post(
    "https://api.mercadopago.com/v1/payments",
    {
      transaction_amount: valorPix,
      description: "Banho Ducha",
      payment_method_id: "pix",
      payer: { email: "cliente@ducha.com" }
    },
    {
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": `ducha-${Date.now()}-${Math.floor(Math.random() * 100000)}`
      }
    }
  );

  ultimoPagamentoId = String(response.data.id);
  salvarDados();

  return response.data;
}

function adicionarPendente(pagamentoId, valor = null) {
  pagamentoId = String(pagamentoId);

  if (pagamentosEntregues.includes(pagamentoId)) return;

  const jaExiste = pagamentosPendentes.find(p => p.id === pagamentoId);

  if (!jaExiste) {
    pagamentosPendentes.push({
      id: pagamentoId,
      valor: Number(valor || 0)
    });

    console.log("PIX aprovado pendente:", pagamentoId, "valor:", valor);
    salvarDados();
  }
}

function buscarPendente(pagamentoId) {
  return pagamentosPendentes.find(p => p.id === String(pagamentoId));
}

app.get("/pix-json", async (req, res) => {
  try {
    const valorPix = valorPixSeguro(req);
    const data = await criarPix(valorPix);

    res.json({
      id: data.id,
      status: data.status,
      valor: valorPix,
      qr_code: data.point_of_interaction.transaction_data.qr_code
    });
  } catch (erro) {
    res.status(500).json({
      erro: true,
      detalhes: erro.response?.data || erro.message
    });
  }
});

app.post("/webhook", async (req, res) => {
  try {
    const pagamentoId = req.body?.data?.id || req.query["data.id"];

    if (pagamentoId) {
      const consulta = await axios.get(
        `https://api.mercadopago.com/v1/payments/${pagamentoId}`,
        { headers: { Authorization: `Bearer ${ACCESS_TOKEN}` } }
      );

      if (consulta.data.status === "approved") {
        ultimoPagamentoId = String(pagamentoId);
        adicionarPendente(pagamentoId, consulta.data.transaction_amount);
        salvarDados();
      }
    }

    res.sendStatus(200);
  } catch (erro) {
    console.log("Erro webhook:", erro.response?.data || erro.message);
    res.sendStatus(200);
  }
});

app.get("/liberar", async (req, res) => {
  try {
    if (pagamentosPendentes.length > 0) {
      const pendente = pagamentosPendentes[0];

      return res.json({
        liberar: true,
        pagamentoId: pendente.id,
        valor: pendente.valor,
        mensagem: "PAGAMENTO APROVADO PENDENTE"
      });
    }

    if (ultimoPagamentoId && !pagamentosEntregues.includes(String(ultimoPagamentoId))) {
      const consulta = await axios.get(
        `https://api.mercadopago.com/v1/payments/${ultimoPagamentoId}`,
        { headers: { Authorization: `Bearer ${ACCESS_TOKEN}` } }
      );

      if (consulta.data.status === "approved") {
        adicionarPendente(ultimoPagamentoId, consulta.data.transaction_amount);

        const pendente = pagamentosPendentes[0];

        return res.json({
          liberar: true,
          pagamentoId: pendente.id,
          valor: pendente.valor,
          mensagem: "PAGAMENTO APROVADO CONSULTA"
        });
      }
    }

    res.json({
      liberar: false,
      mensagem: "AGUARDANDO PAGAMENTO"
    });

  } catch (erro) {
    console.log("Erro liberar:", erro.response?.data || erro.message);

    res.json({
      liberar: false,
      mensagem: "ERRO CONSULTA PAGAMENTO"
    });
  }
});

app.get("/confirmar-liberacao", (req, res) => {
  const pagamentoId = String(req.query.id || "");

  if (!pagamentoId) {
    return res.json({
      ok: false,
      mensagem: "ID NAO INFORMADO"
    });
  }

  const pendente = buscarPendente(pagamentoId);
  const valor = pendente ? Number(pendente.valor || 0) : 0;

  pagamentosPendentes = pagamentosPendentes.filter(p => p.id !== pagamentoId);

  if (!pagamentosEntregues.includes(pagamentoId)) {
    pagamentosEntregues.push(pagamentoId);

    historicoPagamentos.unshift({
      pagamentoId,
      valor,
      data: new Date().toLocaleString("pt-BR"),
      status: "ENTREGUE"
    });

    if (historicoPagamentos.length > 100) {
      historicoPagamentos.pop();
    }
  }

  salvarDados();

  console.log("Ducha liberada confirmada:", pagamentoId);

  res.json({
    ok: true,
    pagamentoId,
    valor,
    pendentes: pagamentosPendentes.length,
    entregues: pagamentosEntregues.length,
    historico: historicoPagamentos.length,
    totalFaturado: totalFaturado()
  });
});

app.get("/historico", (req, res) => {
  const resumo = resumoFinanceiro();

  res.json({
    total: historicoPagamentos.length,
    totalFaturado: totalFaturado(),
    totalHoje: resumo.totalHoje,
    totalOntem: resumo.totalOntem,
    totalMes: resumo.totalMes,
    banhosHoje: resumo.banhosHoje,
    pagamentos: historicoPagamentos
  });
});

app.post("/login-painel", (req, res) => {
  const senha = String(req.body.senha || "");

  if (senha !== SENHA_PAINEL) {
    return res.send(telaLogin(true));
  }

  res.setHeader("Set-Cookie", `painel_token=${TOKEN_PAINEL}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`);
  res.redirect("/painel");
});

app.get("/sair-painel", (req, res) => {
  res.setHeader("Set-Cookie", "painel_token=; Path=/; Max-Age=0");
  res.redirect("/painel");
});

app.get("/painel", (req, res) => {
  if (!painelAutorizado(req)) {
    return res.send(telaLogin(false));
  }

  const resumo = resumoFinanceiro();

  const linhas = historicoPagamentos.map(p => `
    <tr>
      <td>${p.data}</td>
      <td>${p.pagamentoId}</td>
      <td>${formatarMoeda(p.valor)}</td>
      <td class="ok">${p.status}</td>
    </tr>
  `).join("");

  res.send(`
<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Painel Administrativo</title>
<style>
body{font-family:Arial;background:#06152b;color:white;margin:0;padding:15px}
.card{max-width:1150px;margin:auto;background:#0b2447;padding:20px;border-radius:15px;box-shadow:0 0 20px #00d9ff55}
h1{text-align:center;color:#00e5ff}
.info{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin:15px 0}
.box{background:#06152b;padding:12px 18px;border-radius:10px;font-size:18px;color:#ffd600}
.box2{background:#092f2f;padding:12px 18px;border-radius:10px;font-size:18px;color:#00ffbf}
button,.btn{display:inline-block;margin:8px;padding:12px 25px;border:0;border-radius:8px;background:#00aaff;color:white;font-weight:bold;font-size:17px;text-decoration:none}
.acoes{text-align:center}
table{width:100%;border-collapse:collapse;margin-top:20px}
th{background:#00aaff;color:white;padding:12px}
td{padding:12px;border-bottom:1px solid #244;text-align:center}
.ok{color:#00ff7f;font-weight:bold}
.vazio{text-align:center;color:#ffcc00;padding:25px}
@media(max-width:600px){
  body{padding:8px}
  .card{padding:12px}
  h1{font-size:22px}
  table{font-size:12px}
  th,td{padding:7px}
  .box,.box2{font-size:15px}
}
</style>
</head>
<body>
<div class="card">
  <h1>Painel Administrativo - Ducha PIX V5.32</h1>

  <div class="info">
    <div class="box">Pendentes: ${pagamentosPendentes.length}</div>
    <div class="box">Entregues: ${pagamentosEntregues.length}</div>
    <div class="box">Histórico: ${historicoPagamentos.length}</div>
    <div class="box">Total Geral: ${formatarMoeda(totalFaturado())}</div>
  </div>

  <div class="info">
    <div class="box2">Hoje: ${formatarMoeda(resumo.totalHoje)}</div>
    <div class="box2">Ontem: ${formatarMoeda(resumo.totalOntem)}</div>
    <div class="box2">Mês: ${formatarMoeda(resumo.totalMes)}</div>
    <div class="box2">Banhos Hoje: ${resumo.banhosHoje}</div>
  </div>

  <div class="acoes">
    <button onclick="location.reload()">ATUALIZAR</button>
    <a class="btn" href="/sair-painel">SAIR</a>
  </div>

  <table>
    <tr>
      <th>Data</th>
      <th>ID PIX</th>
      <th>Valor</th>
      <th>Status</th>
    </tr>
    ${linhas || '<tr><td colspan="4" class="vazio">Nenhum pagamento registrado</td></tr>'}
  </table>
</div>
</body>
</html>
  `);
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
