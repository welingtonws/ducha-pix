const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const ACCESS_TOKEN = process.env.MERCADO_PAGO_ACCESS_TOKEN;

let ultimoPagamentoId = null;
let pagamentoAprovado = false;

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
    pagamentoAprovado
  });
});

async function criarPix(valorPix) {
  const response = await axios.post(
    "https://api.mercadopago.com/v1/payments",
    {
      transaction_amount: valorPix,
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
  pagamentoAprovado = false;

  return response.data;
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

app.get("/pix", async (req, res) => {
  try {
    const valorPix = valorPixSeguro(req);
    const data = await criarPix(valorPix);

    const qrBase64 = data.point_of_interaction.transaction_data.qr_code_base64;
    const qrCode = data.point_of_interaction.transaction_data.qr_code;

    res.send(`
<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>Pagamento PIX</title>
<style>
body{margin:0;background:#06152b;color:white;font-family:Arial;text-align:center}
.card{max-width:520px;margin:40px auto;background:#0b2447;padding:30px;border-radius:18px;box-shadow:0 0 25px #00d9ff}
h1{color:#00e5ff}
.valor{font-size:36px;color:#00ff7f;font-weight:bold}
img{background:white;padding:15px;border-radius:12px;width:320px}
textarea{width:95%;height:95px;margin-top:20px;border-radius:8px;padding:10px}
button{margin-top:15px;width:95%;padding:18px;border:0;border-radius:10px;background:#00c853;color:white;font-size:24px;font-weight:bold}
#status{margin-top:20px;color:#00ff7f;font-size:22px}
</style>
</head>
<body>
<div class="card">
<h1>PAGAMENTO VIA PIX</h1>
<p>Escaneie o QR Code ou copie o código PIX</p>
<div class="valor">R$ ${valorPix.toFixed(2).replace(".", ",")}</div>
<img src="data:image/png;base64,${qrBase64}">
<textarea id="codigo">${qrCode}</textarea>
<button onclick="navigator.clipboard.writeText(document.getElementById('codigo').value)">COPIAR PIX</button>
<div id="status">Aguardando pagamento...</div>
</div>

<script>
setInterval(async()=>{
  const r = await fetch('/status');
  const d = await r.json();
  if(d.pagamentoAprovado){
    document.getElementById('status').innerText='PAGAMENTO APROVADO!';
  }
},3000);
</script>
</body>
</html>
    `);
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

app.get("/liberar", async (req, res) => {
  try {
    if (pagamentoAprovado) {
      pagamentoAprovado = false;
      return res.json({
        liberar: true,
        mensagem: "PAGAMENTO APROVADO"
      });
    }

    if (ultimoPagamentoId) {
      const consulta = await axios.get(
        `https://api.mercadopago.com/v1/payments/${ultimoPagamentoId}`,
        {
          headers: {
            Authorization: `Bearer ${ACCESS_TOKEN}`
          }
        }
      );

      if (consulta.data.status === "approved") {
        pagamentoAprovado = false;
        return res.json({
          liberar: true,
          mensagem: "PAGAMENTO APROVADO"
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

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
