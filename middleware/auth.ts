import { getAuth } from "@clerk/express";
import type { NextFunction, Request, Response } from "express";

export const protect = (req: Request, res: Response, next: NextFunction) => {
  const auth = getAuth(req);
  const userId = auth.userId;

  if (!userId)
    return res.status(401).json({
      error: "Unauthorized",
    });

  req.user = {
    id: userId,
  };

  next();
};
