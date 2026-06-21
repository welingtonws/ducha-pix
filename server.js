const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const ACCESS_TOKEN = process.env.MERCADO_PAGO_ACCESS_TOKEN;

let ultimoPagamentoId = null;
let pagamentosPendentes = [];
let pagamentosEntregues = [];

function valorPixSeguro(req) {
  let valor = parseFloat(req.query.valor);
  if (isNaN(valor)) valor = 8;
  if (valor < 5) valor = 5;
  if (valor > 50) valor = 50;
  return Number(valor.toFixed(2));
}

app.get("/", (req, res) => {
  res.send("Servidor PIX da Ducha Online");
});

app.get("/status", (req, res) => {
  res.json({
    sistema: "DUCHA PIX",
    online: true,
    ultimoPagamentoId,
    pendentes: pagamentosPendentes.length,
    entregues: pagamentosEntregues.length
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

  ultimoPagamentoId = response.data.id;
  return response.data;
}

function adicionarPendente(pagamentoId) {
  pagamentoId = String(pagamentoId);

  if (pagamentosEntregues.includes(pagamentoId)) return;

  if (!pagamentosPendentes.includes(pagamentoId)) {
    pagamentosPendentes.push(pagamentoId);
    console.log("PIX aprovado pendente:", pagamentoId);
  }
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
        adicionarPendente(pagamentoId);
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
      const pagamentoId = pagamentosPendentes[0];

      return res.json({
        liberar: true,
        pagamentoId,
        mensagem: "PAGAMENTO APROVADO PENDENTE"
      });
    }

    if (ultimoPagamentoId && !pagamentosEntregues.includes(String(ultimoPagamentoId))) {
      const consulta = await axios.get(
        `https://api.mercadopago.com/v1/payments/${ultimoPagamentoId}`,
        { headers: { Authorization: `Bearer ${ACCESS_TOKEN}` } }
      );

      if (consulta.data.status === "approved") {
        adicionarPendente(ultimoPagamentoId);

        const pagamentoId = pagamentosPendentes[0];

        return res.json({
          liberar: true,
          pagamentoId,
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

  pagamentosPendentes = pagamentosPendentes.filter(id => String(id) !== pagamentoId);

  if (!pagamentosEntregues.includes(pagamentoId)) {
    pagamentosEntregues.push(pagamentoId);
  }

  console.log("Ducha liberada confirmada:", pagamentoId);

  res.json({
    ok: true,
    pagamentoId,
    pendentes: pagamentosPendentes.length,
    entregues: pagamentosEntregues.length
  });
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
