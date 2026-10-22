import { clerkClient, getAuth } from "@clerk/express";
import type { NextFunction, Request, Response } from "express";
import { sql } from "../config/db";

export const protect = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const auth = getAuth(req);
  const userId = auth.userId;

  if (!userId)
    return res.status(401).json({
      error: "Unauthorized",
    });

  const clerkUser = await clerkClient.users.getUser(userId);
  const email =
    clerkUser.primaryEmailAddress?.emailAddress ??
    clerkUser.emailAddresses[0]?.emailAddress ??
    "";
  const name =
    clerkUser.fullName ??
    clerkUser.firstName ??
    (email.split("@")[0] || "User");

  req.user = {
    id: userId,
  };

  const userActivePlan = auth.has({
    plan: "studio",
  })
    ? "studio"
    : "essential";

  const existingById = await sql`
    SELECT id
    FROM users
    WHERE id = ${userId}
    LIMIT 1
  `;

  if (existingById.length > 0) {
    const emailOwner =
      email &&
      (await sql`
        SELECT id
        FROM users
        WHERE email = ${email}
          AND id <> ${userId}
        LIMIT 1
      `);

    if (emailOwner?.length) {
      const ownerId = String(
        (emailOwner[0] as { id?: string | number })?.id ?? "",
      );
      const mergeEmail = `${userId}@merge.local`;

      await sql`
        UPDATE users
        SET email = ${mergeEmail}
        WHERE id = ${ownerId}
      `;

      await sql`
        UPDATE meeting_participants
        SET user_id = ${userId}
        WHERE user_id = ${ownerId}
      `;

      await sql`
        UPDATE meeting_messages
        SET sender_id = ${userId}
        WHERE sender_id = ${ownerId}
      `;

      await sql`
        UPDATE meetings
        SET host_id = ${userId}
        WHERE host_id = ${ownerId}
      `;

      await sql`
        DELETE FROM users
        WHERE id = ${ownerId}
      `;
    }

    await sql`
      UPDATE users
      SET name = ${name},
          email = ${email},
          plan = ${userActivePlan},
          updated_at = NOW()
      WHERE id = ${userId}
    `;
  } else {
    const existingByEmail = email
      ? await sql`
          SELECT id
          FROM users
          WHERE email = ${email}
          LIMIT 1
        `
      : [];

    if (existingByEmail.length > 0) {
      await sql`
        UPDATE users
        SET id = ${userId},
            name = ${name},
            plan = ${userActivePlan},
            updated_at = NOW()
        WHERE id = ${existingByEmail[0]?.id}
      `;
    } else {
      await sql`
        INSERT INTO users (id, name, email, plan)
        VALUES (${userId}, ${name}, ${email}, ${userActivePlan})
      `;
    }
  }

  next();
};
