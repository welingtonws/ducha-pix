const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const ACCESS_TOKEN = process.env.MERCADO_PAGO_ACCESS_TOKEN;

let ultimoPagamentoId = null;
let pagamentoAprovado = false;

app.get("/", (req, res) => {
  res.send("Servidor PIX da Ducha Online");
});

app.get("/status", (req, res) => {
  res.json({
    sistema: "DUCHA PIX",
    online: true,
    ultimoPagamentoId,
    pagamentoAprovado
  });
});

app.get("/pix", async (req, res) => {
  try {
    pagamentoAprovado = false;

    const response = await axios.post(
      "https://api.mercadopago.com/v1/payments",
      {
        transaction_amount: 8,
        description: "Banho Ducha",
        payment_method_id: "pix",
        payer: {
          email: "cliente@ducha.com"
        }
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

    res.json({
      id: response.data.id,
      status: response.data.status,
      qr_code: response.data.point_of_interaction.transaction_data.qr_code,
      qr_code_base64: response.data.point_of_interaction.transaction_data.qr_code_base64
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
        {
          headers: {
            Authorization: `Bearer ${ACCESS_TOKEN}`
          }
        }
      );

      if (consulta.data.status === "approved") {
        ultimoPagamentoId = pagamentoId;
        pagamentoAprovado = true;
      }
    }

    res.sendStatus(200);

  } catch (erro) {
    console.log("Erro webhook:", erro.response?.data || erro.message);
    res.sendStatus(200);
  }
});

app.get("/liberar", (req, res) => {
  if (pagamentoAprovado) {
    pagamentoAprovado = false;

    res.json({
      liberar: true,
      mensagem: "PAGAMENTO APROVADO"
    });
  } else {
    res.json({
      liberar: false,
      mensagem: "AGUARDANDO PAGAMENTO"
    });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
