import type { Request, Response } from "express";
import { verifyWebhook } from "@clerk/express/webhooks";
import { sql } from "../config/db";

export const handleClerkWebhook = async (req: Request, res: Response) => {
  try {
    const evt = await verifyWebhook(req);

    switch (evt.type) {
      case "user.created":
        const crUserId = evt.data.id;
        const crPrimaryEmail = evt.data.email_addresses[0]?.email_address ?? "";
        const crName = `${evt.data.first_name ?? "User"} ${evt.data.last_name}`;
        const crImage = evt.data.image_url ?? "";
        const crPlan = "essential";

        await sql`
          INSERT INTO users (id, name, email, image, plan)
          VALUES (${crUserId}, ${crName}, ${crPrimaryEmail}, ${crImage}, ${crPlan})
          ON CONFLICT (email) DO UPDATE SET
          id = EXCLUDED.id,
          name = EXCLUDED.name,
          image = EXCLUDED.image,
          plan = EXCLUDED.plan,
          updated_at = NOW()
        `;

        break;

      case "user.updated":
        const upUserId = evt.data.id;
        const upPrimaryEmail = evt.data.email_addresses[0]?.email_address ?? "";
        const upName = `${evt.data.first_name ?? "User"} ${evt.data.last_name}`;
        const upImage = evt.data.image_url ?? "";

        await sql`
          INSERT INTO users (id, name, email, image)
          VALUES (${upUserId}, ${upName}, ${upPrimaryEmail}, ${upImage})
          ON CONFLICT (email) DO UPDATE SET
          id = EXCLUDED.id,
          name = EXCLUDED.name,
          image = EXCLUDED.image,
          updated_at = NOW()
        `;

        break;

      case "user.deleted":
        const dUserId = evt.data.id;

        if (dUserId) {
          await sql`
            DELETE FROM users WHERE id = ${dUserId}
            `;
        }

        break;

      default:
        console.log("Unhandled clerk webhook event type: ", evt.type);
        break;
    }

    return res.status(200).json({
      success: true,
      eventType: evt.type,
    });
  } catch (error) {
    console.error("Error verifying clerk webhook: ", error);

    return res.status(400).json({
      error: "Webhook verification failed" + error,
    });
  }
};
