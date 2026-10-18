import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";

const app = express();
const allowedOrigins = (process.env.ORIGINS as string).split(",");

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  }),
);

app.use(cookieParser());
app.use(express.json());

app.get("/", (req, res) => res.send("API is live!"));

const port = process.env.PORT ?? 3001;

app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});
