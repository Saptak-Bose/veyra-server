import "dotenv/config";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { initDB } from "./config/db";
import { clerkMiddleware } from "@clerk/express";
import { handleClerkWebhook } from "./controllers/webhook";
import { meetingRouter } from "./routes/meeting";
import http from "http";
import { Server } from "socket.io";
import { setupSocketIO } from "./socket";

const app = express();
const server = http.createServer(app);

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
app.use("/api/meetings", meetingRouter);

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    credentials: true,
  },
});

setupSocketIO(io);

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error("Error: ", err);

  return res.status(500).json({
    error: "Internal Server Error" + err,
  });
});

const port = process.env.PORT ?? 3001;

server.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});
