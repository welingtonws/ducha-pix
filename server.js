const express = require("express");
const axios = require("axios");

const app = express();

app.use(express.json());

const PORT = process.env.PORT || 3000;

const ACCESS_TOKEN = process.env.MERCADO_PAGO_ACCESS_TOKEN;

// Página inicial
app.get("/", (req, res) => {
    res.send("Servidor PIX da Ducha Online");
});

// Status
app.get("/status", (req, res) => {
    res.json({
        sistema: "DUCHA PIX",
        status: "ONLINE",
        valor: 8.00
    });
});

// Gerar PIX
app.get("/pix", async (req, res) => {

    try {

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

        res.json({
            id: response.data.id,
            status: response.data.status,
            qr_code: response.data.point_of_interaction.transaction_data.qr_code,
            qr_code_base64:
                response.data.point_of_interaction.transaction_data.qr_code_base64
        });

    } catch (erro) {

        res.status(500).json({
            erro: true,
            detalhes: erro.response?.data || erro.message
        });

    }

});

app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
