const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true, limit: "5mb" }));

const PORT = process.env.PORT || 3000;
const ACCESS_TOKEN = process.env.MERCADO_PAGO_ACCESS_TOKEN;
const SENHA_PAINEL = process.env.SENHA_PAINEL || "231075";
const TOKEN_PAINEL = process.env.TOKEN_PAINEL || "ducha_pix_logado";

const ARQUIVO_DADOS = path.join(__dirname, "dados.json");
const TIMEZONE_BRASIL = "America/Sao_Paulo";
const DIAS_HISTORICO = 30;

let ultimoPagamentoId = null;
let pagamentosPendentes = [];
let pagamentosEntregues = [];
let historicoPagamentos = [];

function salvarDados() {
  try {
    limparHistoricoAntigo();

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

      limparHistoricoAntigo();

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
  if (valor < 1) valor = 1;
  if (valor > 200) valor = 200;
  return Number(valor.toFixed(2));
}

function agoraBrasilTexto() {
  return new Date().toLocaleString("pt-BR", {
    timeZone: TIMEZONE_BRASIL,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
}

function hojeBrasilData() {
  const partes = new Intl.DateTimeFormat("pt-BR", {
    timeZone: TIMEZONE_BRASIL,
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).formatToParts(new Date());

  const mapa = {};
  partes.forEach(p => { mapa[p.type] = p.value; });

  return new Date(
    Number(mapa.year),
    Number(mapa.month) - 1,
    Number(mapa.day)
  );
}


function timestampAgora() {
  return Date.now();
}

function extrairTimestampRegistro(p) {
  if (!p) return null;

  const ts = Number(p.timestamp || 0);
  if (ts > 0 && Number.isFinite(ts)) {
    return ts;
  }

  const texto = String(p.data || "").trim();

  // Aceita formatos como:
  // 22/06/2026, 18:50:48
  // 22/06/2026 18:50:48
  // 22/06/2026, 18:50
  const m = texto.match(/(\d{2})\/(\d{2})\/(\d{4})(?:,?\s+(\d{2}):(\d{2})(?::(\d{2}))?)?/);

  if (!m) return null;

  const dia = Number(m[1]);
  const mes = Number(m[2]) - 1;
  const ano = Number(m[3]);
  const hora = Number(m[4] || 12);
  const minuto = Number(m[5] || 0);
  const segundo = Number(m[6] || 0);

  const d = new Date(ano, mes, dia, hora, minuto, segundo);

  if (isNaN(d.getTime())) return null;

  return d.getTime();
}

function garantirTimestampHistorico() {
  historicoPagamentos = historicoPagamentos.map(p => {
    if (!p.timestamp) {
      const ts = extrairTimestampRegistro(p);
      if (ts) p.timestamp = ts;
    }
    return p;
  });
}

function formatarMoeda(valor) {
  return Number(valor || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });
}

function tipoRegistro(p) {
  if (p.tipo) return String(p.tipo).toUpperCase();

  if (String(p.pagamentoId || "").startsWith("SENHA-")) {
    return "SENHA";
  }

  return "PIX";
}

function totalFaturado() {
  return historicoPagamentos.reduce((total, p) => {
    if (tipoRegistro(p) !== "PIX") return total;
    return total + Number(p.valor || 0);
  }, 0);
}

function totalSenhasUsadas() {
  return historicoPagamentos.filter(p => tipoRegistro(p) === "SENHA").length;
}

function totalPixEntreguesHistorico() {
  return historicoPagamentos.filter(p => tipoRegistro(p) === "PIX").length;
}

function extrairDataBR(dataTexto) {
  try {
    const texto = String(dataTexto || "").trim();

    // Aceita a data em qualquer parte do texto:
    // 22/06/2026, 18:50:48
    // 22/06/2026 18:50:48
    const m = texto.match(/(\d{2})\/(\d{2})\/(\d{4})/);

    if (!m) return null;

    const dia = Number(m[1]);
    const mes = Number(m[2]) - 1;
    const ano = Number(m[3]);

    const d = new Date(ano, mes, dia);

    if (isNaN(d.getTime())) return null;

    return d;
  } catch {
    return null;
  }
}

function zerarHora(data) {
  return new Date(data.getFullYear(), data.getMonth(), data.getDate());
}

function diferencaDias(dataAntiga, dataAtual) {
  const a = zerarHora(dataAntiga).getTime();
  const b = zerarHora(dataAtual).getTime();
  return Math.floor((b - a) / (1000 * 60 * 60 * 24));
}

function limparHistoricoAntigo() {
  const agora = Date.now();
  const limiteMs = DIAS_HISTORICO * 24 * 60 * 60 * 1000;

  garantirTimestampHistorico();

  historicoPagamentos = historicoPagamentos.filter(p => {
    const ts = extrairTimestampRegistro(p);

    // Segurança: se não conseguir entender a data, NÃO apaga.
    if (!ts) return true;

    const idadeMs = agora - ts;

    // Segurança: se por algum motivo a data estiver no futuro, NÃO apaga.
    if (idadeMs < 0) return true;

    // Mantém somente os registros dentro dos últimos 30 dias.
    return idadeMs <= limiteMs;
  });
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
  limparHistoricoAntigo();

  const hoje = hojeBrasilData();
  const ontem = new Date(hoje);
  ontem.setDate(hoje.getDate() - 1);

  const mesAnterior = new Date(hoje);
  mesAnterior.setMonth(hoje.getMonth() - 1);

  let totalHoje = 0;
  let totalOntem = 0;
  let totalMes = 0;
  let totalMesAnterior = 0;
  let total7Dias = 0;
  let total30Dias = 0;
  let banhosHoje = 0;
  let senhasHoje = 0;
  let pixHoje = 0;

  historicoPagamentos.forEach(p => {
    const dataPagamento = extrairDataBR(p.data);
    const valor = Number(p.valor || 0);
    const tipo = tipoRegistro(p);

    if (!dataPagamento) return;

    const dias = diferencaDias(dataPagamento, hoje);

    if (mesmoDia(dataPagamento, hoje)) {
      banhosHoje++;

      if (tipo === "SENHA") {
        senhasHoje++;
      }

      if (tipo === "PIX") {
        pixHoje++;
        totalHoje += valor;
      }
    }

    if (tipo === "PIX") {
      if (mesmoDia(dataPagamento, ontem)) {
        totalOntem += valor;
      }

      if (mesmoMes(dataPagamento, hoje)) {
        totalMes += valor;
      }

      if (mesmoMes(dataPagamento, mesAnterior)) {
        totalMesAnterior += valor;
      }

      if (dias >= 0 && dias <= 6) {
        total7Dias += valor;
      }

      if (dias >= 0 && dias <= 29) {
        total30Dias += valor;
      }
    }
  });

  return {
    totalHoje,
    totalOntem,
    totalMes,
    totalMesAnterior,
    total7Dias,
    total30Dias,
    mediaDiaria30: total30Dias / 30,
    banhosHoje,
    senhasHoje,
    pixHoje
  };
}

function resumoAvancado() {
  limparHistoricoAntigo();

  const valores = historicoPagamentos
    .filter(p => tipoRegistro(p) === "PIX")
    .map(p => Number(p.valor || 0))
    .filter(v => v > 0);

  const totalBanhos = historicoPagamentos.length;
  const totalPix = totalPixEntreguesHistorico();
  const totalSenhas = totalSenhasUsadas();

  const maiorVenda = valores.length > 0 ? Math.max(...valores) : 0;
  const menorVenda = valores.length > 0 ? Math.min(...valores) : 0;
  const ticketMedio = totalPix > 0 ? totalFaturado() / totalPix : 0;
  const ultimo = historicoPagamentos.length > 0 ? historicoPagamentos[0] : null;

  return {
    totalBanhos,
    totalPix,
    totalSenhas,
    maiorVenda,
    menorVenda,
    ticketMedio,
    ultimoPix: ultimo ? ultimo.pagamentoId : "-",
    ultimaData: ultimo ? ultimo.data : "-",
    ultimoTipo: ultimo ? tipoRegistro(ultimo) : "-"
  };
}

function painelAutorizado(req) {
  const cookie = req.headers.cookie || "";
  return cookie.includes(`painel_token=${TOKEN_PAINEL}`);
}

function exigirPainel(req, res) {
  if (!painelAutorizado(req)) {
    res.status(403).send("Acesso negado");
    return false;
  }
  return true;
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
  res.send("Servidor PIX da Ducha Online - V5.39");
});

app.get("/status", (req, res) => {
  const resumo = resumoFinanceiro();
  const avancado = resumoAvancado();

  res.json({
    sistema: "DUCHA PIX",
    versao: "5.39",
    online: true,
    limpezaAutomaticaDias: DIAS_HISTORICO,
    ultimoPagamentoId,
    pendentes: pagamentosPendentes.length,
    entregues: pagamentosEntregues.length,
    historico: historicoPagamentos.length,
    totalFaturado: totalFaturado(),
    totalHoje: resumo.totalHoje,
    totalOntem: resumo.totalOntem,
    totalMes: resumo.totalMes,
    totalMesAnterior: resumo.totalMesAnterior,
    total7Dias: resumo.total7Dias,
    total30Dias: resumo.total30Dias,
    mediaDiaria30: resumo.mediaDiaria30,
    banhosHoje: resumo.banhosHoje,
    senhasHoje: resumo.senhasHoje,
    pixHoje: resumo.pixHoje,
    maiorVenda: avancado.maiorVenda,
    menorVenda: avancado.menorVenda,
    ticketMedio: avancado.ticketMedio,
    totalBanhos: avancado.totalBanhos,
    totalPix: avancado.totalPix,
    totalSenhas: avancado.totalSenhas,
    ultimoPix: avancado.ultimoPix,
    ultimaData: avancado.ultimaData,
    ultimoTipo: avancado.ultimoTipo
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
      tipo: "PIX",
      data: agoraBrasilTexto(),
      timestamp: timestampAgora(),
      status: "ENTREGUE"
    });
  }

  salvarDados();

  console.log("Ducha liberada confirmada por PIX:", pagamentoId);

  res.json({
    ok: true,
    tipo: "PIX",
    pagamentoId,
    valor,
    pendentes: pagamentosPendentes.length,
    entregues: pagamentosEntregues.length,
    historico: historicoPagamentos.length,
    totalFaturado: totalFaturado()
  });
});

function registrarSenha(req, res) {
  const senha = String(req.query.senha || req.query.codigo || "").trim();
  const ducha = String(req.query.ducha || "").trim();

  const idSenha = `SENHA-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

  historicoPagamentos.unshift({
    pagamentoId: idSenha,
    valor: 0,
    tipo: "SENHA",
    senha: senha || "-",
    ducha: ducha || "-",
    data: agoraBrasilTexto(),
    timestamp: timestampAgora(),
    status: "ENTREGUE"
  });

  salvarDados();

  console.log("Ducha liberada confirmada por SENHA:", idSenha, "senha:", senha || "-", "ducha:", ducha || "-");

  res.json({
    ok: true,
    tipo: "SENHA",
    pagamentoId: idSenha,
    senha: senha || "-",
    ducha: ducha || "-",
    valor: 0,
    historico: historicoPagamentos.length,
    totalFaturado: totalFaturado()
  });
}

app.get("/confirmar-senha", registrarSenha);
app.get("/registrar-senha", registrarSenha);

app.get("/historico", (req, res) => {
  const resumo = resumoFinanceiro();
  const avancado = resumoAvancado();

  res.json({
    total: historicoPagamentos.length,
    totalFaturado: totalFaturado(),
    limpezaAutomaticaDias: DIAS_HISTORICO,
    totalHoje: resumo.totalHoje,
    totalOntem: resumo.totalOntem,
    totalMes: resumo.totalMes,
    totalMesAnterior: resumo.totalMesAnterior,
    total7Dias: resumo.total7Dias,
    total30Dias: resumo.total30Dias,
    mediaDiaria30: resumo.mediaDiaria30,
    banhosHoje: resumo.banhosHoje,
    senhasHoje: resumo.senhasHoje,
    pixHoje: resumo.pixHoje,
    maiorVenda: avancado.maiorVenda,
    menorVenda: avancado.menorVenda,
    ticketMedio: avancado.ticketMedio,
    totalBanhos: avancado.totalBanhos,
    totalPix: avancado.totalPix,
    totalSenhas: avancado.totalSenhas,
    ultimoPix: avancado.ultimoPix,
    ultimaData: avancado.ultimaData,
    ultimoTipo: avancado.ultimoTipo,
    pagamentos: historicoPagamentos
  });
});

app.get("/exportar-historico", (req, res) => {
  if (!exigirPainel(req, res)) return;

  limparHistoricoAntigo();

  const dados = {
    exportadoEm: agoraBrasilTexto(),
    limpezaAutomaticaDias: DIAS_HISTORICO,
    total: historicoPagamentos.length,
    totalFaturado: totalFaturado(),
    pagamentos: historicoPagamentos
  };

  res.setHeader("Content-Disposition", "attachment; filename=historico_ducha.json");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.send(JSON.stringify(dados, null, 2));
});

app.get("/backup-dados", (req, res) => {
  if (!exigirPainel(req, res)) return;

  limparHistoricoAntigo();

  const dados = {
    ultimoPagamentoId,
    pagamentosPendentes,
    pagamentosEntregues,
    historicoPagamentos
  };

  res.setHeader("Content-Disposition", "attachment; filename=dados_ducha_backup.json");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.send(JSON.stringify(dados, null, 2));
});

app.post("/limpar-historico", (req, res) => {
  if (!exigirPainel(req, res)) return;

  historicoPagamentos = [];
  pagamentosEntregues = [];
  salvarDados();

  res.redirect("/painel");
});

app.post("/restaurar-backup", (req, res) => {
  if (!exigirPainel(req, res)) return;

  try {
    const texto = String(req.body.backup || "");
    const dados = JSON.parse(texto);

    if (!Array.isArray(dados.pagamentosPendentes)) dados.pagamentosPendentes = [];
    if (!Array.isArray(dados.pagamentosEntregues)) dados.pagamentosEntregues = [];
    if (!Array.isArray(dados.historicoPagamentos)) dados.historicoPagamentos = [];

    ultimoPagamentoId = dados.ultimoPagamentoId || null;
    pagamentosPendentes = dados.pagamentosPendentes;
    pagamentosEntregues = dados.pagamentosEntregues;
    historicoPagamentos = dados.historicoPagamentos;

    salvarDados();

    res.redirect("/painel");
  } catch (erro) {
    res.send(`
      <h2>Erro ao restaurar backup</h2>
      <p>${erro.message}</p>
      <a href="/painel">Voltar</a>
    `);
  }
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

  limparHistoricoAntigo();

  const resumo = resumoFinanceiro();
  const avancado = resumoAvancado();

  const linhas = historicoPagamentos.map(p => {
    const tipo = tipoRegistro(p);
    const classeTipo = tipo === "SENHA" ? "senha" : "pix";
    const valorTexto = tipo === "SENHA" ? "-" : formatarMoeda(p.valor);

    return `
    <tr>
      <td>${p.data}</td>
      <td>${tipo === "SENHA" ? (p.senha || p.pagamentoId) : p.pagamentoId}</td>
      <td class="${classeTipo}">${tipo}</td>
      <td>${valorTexto}</td>
      <td class="ok">${p.status}</td>
    </tr>
  `;
  }).join("");

  res.send(`
<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Painel Administrativo</title>
<style>
body{font-family:Arial;background:#06152b;color:white;margin:0;padding:15px}
.card{max-width:1250px;margin:auto;background:#0b2447;padding:20px;border-radius:15px;box-shadow:0 0 20px #00d9ff55}
h1{text-align:center;color:#00e5ff}
.info{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin:15px 0}
.box{background:#06152b;padding:12px 18px;border-radius:10px;font-size:18px;color:#ffd600}
.box2{background:#092f2f;padding:12px 18px;border-radius:10px;font-size:18px;color:#00ffbf}
.box3{background:#27184a;padding:12px 18px;border-radius:10px;font-size:18px;color:#ffccff}
.box4{background:#2e2608;padding:12px 18px;border-radius:10px;font-size:18px;color:#ffe066}
.box5{background:#14335c;padding:12px 18px;border-radius:10px;font-size:18px;color:#7dd3ff}
button,.btn{display:inline-block;margin:8px;padding:12px 25px;border:0;border-radius:8px;background:#00aaff;color:white;font-weight:bold;font-size:17px;text-decoration:none;cursor:pointer}
.btn-red{background:#d32f2f}
.btn-green{background:#00a651}
.btn-purple{background:#7b1fa2}
.acoes{text-align:center}
textarea{width:95%;max-width:950px;height:120px;border-radius:10px;padding:10px;margin-top:10px}
table{width:100%;border-collapse:collapse;margin-top:20px}
th{background:#00aaff;color:white;padding:12px}
td{padding:12px;border-bottom:1px solid #244;text-align:center}
.ok{color:#00ff7f;font-weight:bold}
.pix{color:#00e5ff;font-weight:bold}
.senha{color:#ffcc00;font-weight:bold}
.vazio{text-align:center;color:#ffcc00;padding:25px}
.operacional{margin-top:20px;padding:15px;border:1px solid #244;border-radius:12px;background:#06152b;text-align:center}
.operacional h2{color:#00e5ff;margin-top:0}
.aviso{color:#7dd3ff;text-align:center;margin-top:8px;font-size:15px}
@media(max-width:600px){
  body{padding:8px}
  .card{padding:12px}
  h1{font-size:22px}
  table{font-size:12px}
  th,td{padding:7px}
  .box,.box2,.box3,.box4,.box5{font-size:15px}
}
</style>
</head>
<body>
<div class="card">
  <h1>Painel Administrativo - Ducha PIX V5.39</h1>
  <div class="aviso">Limpeza automática: histórico dos últimos ${DIAS_HISTORICO} dias</div>

  <div class="info">
    <div class="box">Pendentes: ${pagamentosPendentes.length}</div>
    <div class="box">Entregues PIX: ${pagamentosEntregues.length}</div>
    <div class="box">Histórico: ${historicoPagamentos.length}</div>
    <div class="box">Total Geral: ${formatarMoeda(totalFaturado())}</div>
  </div>

  <div class="info">
    <div class="box5">PIX Hoje: ${resumo.pixHoje}</div>
    <div class="box5">Senhas Hoje: ${resumo.senhasHoje}</div>
    <div class="box5">Senhas Usadas: ${avancado.totalSenhas}</div>
    <div class="box5">Total Banhos: ${avancado.totalBanhos}</div>
  </div>

  <div class="info">
    <div class="box2">Hoje: ${formatarMoeda(resumo.totalHoje)}</div>
    <div class="box2">Ontem: ${formatarMoeda(resumo.totalOntem)}</div>
    <div class="box2">Mês: ${formatarMoeda(resumo.totalMes)}</div>
    <div class="box2">Banhos Hoje: ${resumo.banhosHoje}</div>
  </div>

  <div class="info">
    <div class="box3">Maior Venda: ${formatarMoeda(avancado.maiorVenda)}</div>
    <div class="box3">Menor Venda: ${formatarMoeda(avancado.menorVenda)}</div>
    <div class="box3">Ticket Médio PIX: ${formatarMoeda(avancado.ticketMedio)}</div>
    <div class="box3">Total PIX: ${avancado.totalPix}</div>
  </div>

  <div class="info">
    <div class="box4">Últimos 7 Dias: ${formatarMoeda(resumo.total7Dias)}</div>
    <div class="box4">Últimos 30 Dias: ${formatarMoeda(resumo.total30Dias)}</div>
    <div class="box4">Mês Anterior: ${formatarMoeda(resumo.totalMesAnterior)}</div>
    <div class="box4">Média Diária: ${formatarMoeda(resumo.mediaDiaria30)}</div>
  </div>

  <div class="info">
    <div class="box3">Último Registro: ${avancado.ultimoPix}</div>
    <div class="box3">Tipo: ${avancado.ultimoTipo}</div>
    <div class="box3">Última Venda: ${avancado.ultimaData}</div>
  </div>

  <div class="acoes">
    <button onclick="location.reload()">ATUALIZAR</button>
    <a class="btn" href="/sair-painel">SAIR</a>
  </div>

  <div class="operacional">
    <h2>Operacional</h2>

    <a class="btn btn-green" href="/exportar-historico">EXPORTAR HISTÓRICO JSON</a>
    <a class="btn btn-purple" href="/backup-dados">BACKUP DADOS.JSON</a>

    <form method="POST" action="/limpar-historico" style="display:inline" onsubmit="return confirm('Tem certeza que deseja limpar todo o histórico? Faça backup antes.')">
      <button class="btn-red" type="submit">LIMPAR HISTÓRICO</button>
    </form>

    <form method="POST" action="/restaurar-backup" onsubmit="return confirm('Tem certeza que deseja restaurar este backup? Os dados atuais serão substituídos.')">
      <p>Cole aqui o conteúdo do arquivo backup dados.json:</p>
      <textarea name="backup" placeholder="Cole o JSON do backup aqui"></textarea><br>
      <button class="btn-purple" type="submit">RESTAURAR BACKUP</button>
    </form>
  </div>

  <table>
    <tr>
      <th>Data</th>
      <th>ID / Senha</th>
      <th>Tipo</th>
      <th>Valor</th>
      <th>Status</th>
    </tr>
    ${linhas || '<tr><td colspan="5" class="vazio">Nenhum pagamento registrado</td></tr>'}
  </table>
</div>
</body>
</html>
  `);
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
