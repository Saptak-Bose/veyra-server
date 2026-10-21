import type { Request, Response } from "express";
import { sql } from "../config/db";

export const generateMeetingId = () => {
  const chars = "abcdefghijklmnopqrstuvwxyz";

  const seg = (len: number) =>
    Array.from(
      {
        length: len,
      },
      () => chars[Math.floor(Math.random() * chars.length)],
    ).join("");

  return `${seg(3)}-${seg(3)}-${seg(3)}`;
};

export const createMeeting = async (req: Request, res: Response) => {
  try {
    const { title } = req.body;
    const userId = req.user?.id;

    const users = await sql`
        SELECT name, plan 
        FROM users 
        WHERE id = ${userId}
      `;

    const userPlan = users[0]?.plan ?? "essential";

    if (userPlan === "essential") {
      const monthlyCountResult = await sql`
          SELECT COUNT(*) AS count
          FROM meetings
          WHERE host_id = ${userId}
          AND created_at >= date_trunc('month', NOW())
        `;

      const monthlyCount = parseInt(monthlyCountResult[0]?.count ?? "0");

      if (monthlyCount >= 30)
        return res.status(403).json({
          error:
            "Monthly limit reached! Essential plan allows only 30 meetings per month. Please upgrade to Studio for unlimited meetings.",
          limitReached: true,
          monthlyCount,
          limit: 30,
        });
    }

    let meetingId = generateMeetingId();

    let existing = await sql`
        SELECT id
        FROM meetings
        WHERE meeting_id = ${meetingId}
      `;

    while (existing.length > 0) {
      meetingId = generateMeetingId();

      existing = await sql`
          SELECT id
          FROM meetings
          WHERE meeting_id = ${meetingId}
        `;
    }

    const [meeting] = await sql`
        INSERT INTO meetings(meeting_id, title, host_id, status)
        VALUES(${meetingId}, ${title ?? "Instant Meeting"}, ${userId}, 'active')
        RETURNING id, meeting_id, title, host_id, status, created_at
      `;

    const hostName = users[0]?.name ?? "Host";

    await sql`
        INSERT INTO meeting_participants(meeting_id, user_id, name)
        VALUES(${meeting?.id}, ${userId}, ${hostName})
      `;

    return res.status(201).json({
      id: meeting?.id,
      meetingId: meeting?.meeting_id,
      title: meeting?.title,
      host: meeting?.host_id,
      status: meeting?.status,
      createdAt: meeting?.created_at,
    });
  } catch (error) {
    console.error("Error while creating meeting", error);

    return res.status(500).json({
      error: "Error: " + error,
    });
  }
};

export const getMeeting = async (req: Request, res: Response) => {
  try {
    const { meetingId } = req.params;

    const meetings = await sql`
        SELECT m.*,
        u.id as host_user_id,
        u.name as host_name,
        u.email as host_email,
        FROM meetings m
        JOIN users u 
        ON m.host_id = u.id 
        WHERE m.meeting_id = ${meetingId}
      `;

    if (meetings.length === 0)
      return res.status(404).json({
        error: "Meeting not found",
      });

    const meeting = meetings[0];

    if (meeting?.status === "ended")
      return res.status(400).json({
        error: "This meeting has ended",
      });

    return res.status(200).json({
      meeting: {
        id: meeting?.id,
        meetingId: meeting?.meeting_id,
        title: meeting?.title,
        status: meeting?.status,
        createdAt: meeting?.created_at,
        host: {
          id: meeting?.host_user_id,
          name: meeting?.host_name,
          email: meeting?.host_email,
        },
      },
    });
  } catch (error) {
    console.error("Error while fetching meeting", error);

    return res.status(500).json({
      error: "Error: " + error,
    });
  }
};

export const getUserSessions = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;

    const meetings = await sql`
        SELECT DISTINCT m.id, m.meeting_id, m.title, m.status, m.created_at, m.ended_at, m.host_id,
        u.name as host_name, u.email as host_email
        FROM meetings m
        JOIN users u 
        ON m.host_id = u.id
        LEFT JOIN meeting_participants mp
        ON m.id = mp.meeting_id
        WHERE m.host_id = ${userId} 
        OR mp.user_id = ${userId}
        ORDER BY m.created_at DESC
      `;

    const formattedMeetings = await Promise.all(
      meetings.map(async (m) => {
        const participants = await sql`
            SELECT mp.*, u.email
            FROM meeting_participants mp
            LEFT JOIN users u
            ON mp.user_id = u.id
            WHERE mp.meeting_id = ${m.id}
          `;

        const messages = await sql`
            SELECT id, sender_id, sender_name, text, timestamp
            FROM meeting_messages
            WHERE meeting_id = ${m.id}
            ORDER BY timestamp ASC
          `;

        return {
          id: m.id,
          meetingId: m.meeting_id,
          title: m.title,
          status: m.status,
          createdAt: m.created_at,
          endedAt: m.ended_at,
          host: {
            id: m.host_id,
            name: m.host_name,
            email: m.host_email,
          },
          participants: participants.map((p) => ({
            user: p.user_id
              ? {
                  id: p.user_id,
                  email: p.email,
                }
              : null,
            name: p.name,
            joinedAt: p.joined_at,
            leftAt: p.left_at,
          })),
          messages: messages.map((msg) => ({
            id: msg.id,
            sender: msg.sender_id,
            senderName: msg.sender_name,
            text: msg.text,
            timestamp: msg.timestamp,
          })),
        };
      }),
    );

    return res.status(200).json({
      meetings: formattedMeetings,
    });
  } catch (error) {
    console.error("Error while fetching user sessions", error);

    return res.status(500).json({
      error: "Error: " + error,
    });
  }
};

export const getSessionDetails = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const meetings = await sql`
        SELECT m.*,
        u.id as host_user_id,
        u.name as host_name,
        u.email as host_email
        FROM meetings m
        JOIN users u
        ON m.host_id = u.id
        WHERE m.meeting_id = ${id}
      `;

    if (meetings.length === 0)
      return res.status(404).json({
        error: "Session details not found.",
      });

    const m = meetings[0];

    const participants = await sql`
        SELECT mp.*, u.email
        FROM meeting_participants mp
        LEFT JOIN users u
        ON mp.user_id = u.id
        WHERE mp.meeting_id = ${m?.id}
      `;

    const messages = await sql`
        SELECT id, sender_id, sender_name, text, timestamp
        FROM meeting_messages
        WHERE meeting_id = ${m?.id}
        ORDER BY timestamp ASC
      `;

    const formattedMeeting = {
      id: m?.id,
      meetingId: m?.meeting_id,
      title: m?.title,
      status: m?.status,
      createdAt: m?.created_at,
      endedAt: m?.ended_at,
      host: {
        id: m?.host_user_id,
        name: m?.host_name,
        email: m?.host_email,
      },
      participants: participants.map((p) => ({
        user: p.user_id
          ? {
              id: p.user_id,
              email: p.email,
            }
          : null,
        name: p.name,
        joinedAt: p.joined_at,
        leftAt: p.left_at,
      })),
      messages: messages.map((msg) => ({
        id: msg.id,
        sender: msg.sender_id,
        senderName: msg.sender_name,
        text: msg.text,
        timestamp: msg.timestamp,
      })),
    };

    return res.status(200).json({
      meeting: formattedMeeting,
    });
  } catch (error) {
    console.error("Error while fetching session details", error);

    return res.status(500).json({
      error: "Error: " + error,
    });
  }
};

export const getMeetingStats = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;

    const users = await sql`
        SELECT plan
        FROM users
        WHERE id = ${userId}
      `;

    const plan = users[0]?.plan ?? "essential";

    const monthlyCountResult = await sql`
        SELECT COUNT(*) AS count
        FROM meetings
        WHERE host_id = ${userId}
        AND created_at >= date_trunc("month", NOW())
      `;

    const monthlyCount = parseInt(monthlyCountResult[0]?.count ?? "0", 10);
    const monthlyLimit = plan === "studio" ? null : 30;

    return res.status(200).json({
      plan,
      monthlyCount,
      monthlyLimit,
      maxParticipants: plan === "studio" ? 100 : 10,
    });
  } catch (error) {
    console.error("Error while fetching meeting stats", error);

    return res.status(500).json({
      error: "Error: " + error,
    });
  }
};
