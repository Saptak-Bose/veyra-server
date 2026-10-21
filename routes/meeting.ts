import express from "express";
import { protect } from "../middleware/auth";
import {
  createMeeting,
  getMeeting,
  getMeetingStats,
  getSessionDetails,
  getUserSessions,
} from "../controllers/meeting";

const meetingRouter = express.Router();

meetingRouter.post("/", protect, createMeeting);
meetingRouter.get("/stats", protect, getMeetingStats);
meetingRouter.get("/sessions", protect, getUserSessions);
meetingRouter.get("/sessions/:id", protect, getSessionDetails);
meetingRouter.get("/:meetingId", protect, getMeeting);

export { meetingRouter };
