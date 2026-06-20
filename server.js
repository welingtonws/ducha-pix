const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const ACCESS_TOKEN = process.env.MERCADO_PAGO_ACCESS_TOKEN;

let ultimoPagamentoId = null;
let pagamentoAprovado = false;

async function criarPix() {
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
  pagamentoAprovado = false;

  return response.data;
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

app.get("/pix-json", async (req, res) => {
  try {
    const pix = await criarPix();

    res.json({
      id: pix.id,
      status: pix.status,
      qr_code: pix.point_of_interaction.transaction_data.qr_code
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
    const pix = await criarPix();

    const qrCodeBase64 =
      pix.point_of_interaction.transaction_data.qr_code_base64;

    const pixCopiaCola =
      pix.point_of_interaction.transaction_data.qr_code;

    res.send(`
<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>Pagamento PIX</title>
<style>
body{margin:0;font-family:Arial;background:#07162e;color:white;text-align:center}
.card{max-width:420px;margin:30px auto;background:#0b2347;border-radius:18px;padding:25px;box-shadow:0 0 20px #00aaff}
h1{color:#00e5ff}
.valor{font-size:32px;color:#00ff66;font-weight:bold}
img{width:300px;max-width:90%;background:white;padding:12px;border-radius:12px}
textarea{width:100%;height:90px;margin-top:15px;border-radius:8px;padding:10px}
button{margin-top:15px;width:100%;padding:15px;border:0;border-radius:10px;background:#00c853;color:white;font-size:22px;font-weight:bold}
.status{margin-top:18px;font-size:18px;color:#ffeb3b}
</style>
</head>
<body>
<div class="card">
<h1>PAGAMENTO VIA PIX</h1>
<p>Escaneie o QR Code ou copie o código PIX</p>
<div class="valor">R$ 8,00</div>
<img src="data:image/png;base64,${qrCodeBase64}">
<textarea id="pixCode" readonly>${pixCopiaCola}</textarea>
<button onclick="copiarPix()">COPIAR PIX</button>
<div class="status" id="status">Aguardando pagamento...</div>
</div>

<script>
function copiarPix(){
  const texto=document.getElementById("pixCode");
  texto.select();
  document.execCommand("copy");
  alert("Código PIX copiado!");
}

setInterval(async()=>{
  const r=await fetch("/status");
  const j=await r.json();
  if(j.pagamentoAprovado){
    document.getElementById("status").innerText="PAGAMENTO APROVADO!";
    document.getElementById("status").style.color="#00ff66";
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
