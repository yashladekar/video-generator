import type { Session } from "@video-generator/auth";
import type { Database } from "@video-generator/db";

export type Context = {
  session: Session | null;
  db: Database;
};
