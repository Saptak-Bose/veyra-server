import type { DefaultEventsMap, Server } from "socket.io";
import { sql } from "./config/db";
import type { ChatMessage, MeetingParticipantUser, MeetingUser } from "./types";

const rooms = new Map();

export const setupSocketIO = (
  io: Server<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, any>,
) => {
  io.on("connection", (socket) => {
    let currentRoomId: string | null = null;
    let currentUser: MeetingParticipantUser | null = null;

    socket.on(
      "join-room",
      async ({
        roomId,
        user,
        audioEnabled = true,
        videoEnabled = true,
      }: {
        roomId: string;
        user: MeetingUser;
        audioEnabled?: boolean;
        videoEnabled?: boolean;
      }) => {
        try {
          const meetings = await sql`
              SELECT *
              FROM meetings
              WHERE meeting_id = ${roomId}
            `;

          if (meetings.length === 0) {
            socket.emit("meeting-ended", {
              message: "Meeting does not exist.",
            });

            return;
          }

          const meeting = meetings[0];

          if (meeting?.status === "ended") {
            socket.emit("meeting-ended", {
              message: "Meeting has already ended.",
            });

            return;
          }

          currentRoomId = roomId;

          const isHost =
            meeting?.host_id &&
            user?.id &&
            meeting?.host_id.toString() === user?.id.toString();

          currentUser = {
            socketId: socket.id,
            userId: user?.id,
            userName: user?.name ?? "Anonymous",
            isHost,
            audioEnabled,
            videoEnabled,
          };

          if (!rooms.has(roomId)) {
            rooms.set(roomId, new Map());
          }

          const roomParticipants = rooms.get(roomId);

          const hosts = await sql`
              SELECT plan
              FROM users
              WHERE id = ${meeting?.host_id}
            `;

          const hostPlan = hosts[0]?.plan ?? "essential";
          const maxParticipants = hostPlan === "studio" ? 100 : 10;

          if (roomParticipants.size >= maxParticipants) {
            socket.emit("meeting-ended", {
              message: `Meeting capacity reached. Maximum allowed participants for ${hostPlan.toUpperCase()} plan is ${maxParticipants}. Host must upgrade to Studio for upto 100 participants.`,
            });

            return;
          }

          socket.join(roomId);
          const existingUsers = Array.from(roomParticipants.values());
          roomParticipants.set(socket.id, currentUser);
          const userId = user?.id ?? null;

          if (userId && user.email) {
            await sql`
              UPDATE users
              SET name = ${currentUser.userName},
                  email = CASE
                    WHEN NOT EXISTS (
                      SELECT 1
                      FROM users AS email_owner
                      WHERE email_owner.email = ${user.email}
                        AND email_owner.id <> ${userId}
                    )
                    THEN ${user.email}
                    ELSE users.email
                  END,
                  updated_at = NOW()
              WHERE id = ${userId}
            `;
          }

          const existingParticipants = await sql`
              SELECT id
              FROM meeting_participants
              WHERE meeting_id = ${meeting?.id}
              AND ((${userId}::text IS NOT NULL 
              AND user_id = ${userId})
              OR (user_id IS NULL AND name = 'User'))
            `;

          if (existingParticipants.length === 0) {
            await sql`
                INSERT INTO meeting_participants (meeting_id, user_id, name, joined_at)
                VALUES (${meeting?.id}, ${userId}, ${currentUser.userName}, NOW())
              `;
          } else if (userId) {
            await sql`
                UPDATE meeting_participants
                SET user_id = ${userId},
                    name = ${currentUser.userName}
                WHERE id = ${existingParticipants[0]?.id}
              `;
          }

          socket.emit("all-users", existingUsers);
          socket.to(roomId).emit("user-joined", currentUser);
        } catch (error) {
          console.error("Error joining room:", error);

          socket.emit("meeting-ended", {
            message:
              "An error occurred while trying to join the meeting. Please try again later.",
          });
        }
      },
    );

    socket.on(
      "offer",
      ({
        targetSocketId,
        callerSocketId,
        sdp,
      }: {
        targetSocketId: string;
        callerSocketId: string;
        sdp: string;
      }) => {
        io.to(targetSocketId).emit("offer", {
          callerSocketId,
          sdp,
          callerUser: currentUser,
        });
      },
    );

    socket.on(
      "answer",
      ({
        targetSocketId,
        responderSocketId,
        sdp,
      }: {
        targetSocketId: string;
        responderSocketId: string;
        sdp: string;
      }) => {
        io.to(targetSocketId).emit("answer", {
          responderSocketId,
          sdp,
        });
      },
    );

    socket.on(
      "ice-candidate",
      ({
        targetSocketId,
        senderSocketId,
        candidate,
      }: {
        targetSocketId: string;
        senderSocketId: string;
        candidate: MeetingUser;
      }) => {
        io.to(targetSocketId).emit("ice-candidate", {
          senderSocketId,
          candidate,
        });
      },
    );

    socket.on(
      "toggle-audio",
      ({ roomId, audioEnabled }: { roomId: string; audioEnabled: boolean }) => {
        if (rooms.has(roomId) && rooms.get(roomId).has(socket.id)) {
          rooms.get(roomId).get(socket.id).audioEnabled = audioEnabled;
        }

        socket.to(roomId).emit("user-toggled-audio", {
          socketId: socket.id,
          audioEnabled,
        });
      },
    );

    socket.on(
      "toggle-video",
      ({ roomId, videoEnabled }: { roomId: string; videoEnabled: boolean }) => {
        if (rooms.has(roomId) && rooms.get(roomId).has(socket.id)) {
          rooms.get(roomId).get(socket.id).videoEnabled = videoEnabled;
        }

        socket.to(roomId).emit("user-toggled-video", {
          socketId: socket.id,
          videoEnabled,
        });
      },
    );

    socket.on(
      "send-message",
      async ({ roomId, message }: { roomId: string; message: ChatMessage }) => {
        try {
          const meetings = await sql`
            SELECT id, status
            FROM meetings
            WHERE meeting_id = ${roomId}
          `;

          if (meetings.length > 0 && meetings[0]?.status !== "ended") {
            const meetingId = meetings[0]?.id;
            const senderId = message.senderId ?? null;

            await sql`
                INSERT INTO meeting_messages
                (meeting_id, sender_id, sender_name, text, timestamp)
                VALUES (${meetingId}, ${senderId}, ${message.senderName ?? "Anonymous"}, ${message.text}, NOW())
              `;

            io.in(roomId).emit("receive-message", {
              ...message,
              senderSocketId: socket.id,
            });
          }
        } catch (error) {
          console.error("Error saving chat message to database: ", error);
        }
      },
    );

    socket.on("end-meeting", async ({ roomId }: { roomId: string }) => {
      io.to(roomId).emit("meeting-ended", {
        message: "The meeting has been ended by the host.",
      });

      try {
        await sql`
            UPDATE meetings
            SET status = 'ended', ended_at = NOW()
            WHERE meeting_id = ${roomId}
          `;
        rooms.delete(roomId);
      } catch (error) {
        console.error("Error ending meeting: ", error);
      }
    });

    socket.on("disconnect", () => {
      if (currentRoomId && rooms.has(currentRoomId)) {
        const roomParticipants = rooms.get(currentRoomId);
        roomParticipants.delete(socket.id);

        if (roomParticipants.size === 0) {
          rooms.delete(currentRoomId);
        } else {
          socket.to(currentRoomId).emit("user-left", {
            socketId: socket.id,
            user: currentUser,
          });
        }
      }
    });
  });
};
