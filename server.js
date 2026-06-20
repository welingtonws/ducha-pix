const express = require("express");

const app = express();

app.use(express.json());

const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.send("Servidor PIX da Ducha Online");
});

app.get("/status", (req, res) => {
  res.json({
    sistema: "DUCHA PIX",
    status: "ONLINE",
    valor: 8.00
  });
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
