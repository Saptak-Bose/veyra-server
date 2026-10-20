import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { initDB } from "./config/db";
import { clerkMiddleware } from "@clerk/express";
import { handleClerkWebhook } from "./controllers/webhook-controller";

const app = express();

await initDB();

const allowedOrigins = (process.env.ORIGINS as string).split(",");

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  }),
);

app.use(cookieParser());

app.use(
  "/api/clerk",
  express.raw({
    type: "application/json",
  }),
  handleClerkWebhook,
);

app.use(express.json());
app.use(clerkMiddleware());

app.get("/", (req, res) => res.send("API is live!"));

const port = process.env.PORT ?? 3001;

app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});
