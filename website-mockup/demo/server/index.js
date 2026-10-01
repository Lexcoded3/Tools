// server.mjs
import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import { config } from "dotenv";
config();
const app = express();
const port = process.env.PORT || 8000;

app.use(express.json());
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", process.env.FRONTEND_URL);
  res.header("X-Frame-Options", process.env.FRONTEND_URL);

  next();
});

app.use(
  cors({
    origin: process.env.FRONTEND_URL,
  })
);

app.get("/preview", async (req, res) => {
  try {
    const { url } = req.query;
    const response = await fetch(url);
    const html = await response.text();
    res.send(html);
  } catch (error) {
    console.error("Error fetching website content:", error);
    res.status(500).send("Error fetching website content");
  }
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
