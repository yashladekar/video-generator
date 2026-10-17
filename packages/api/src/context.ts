import type { Session } from "@video-generator/auth";
import type { Database } from "@video-generator/db";

import type { RuntimeEnv } from "./env";
import type { JobDispatcher } from "./jobs";
import type { Logger } from "./lib/logger";

export type RequestMeta = {
  ip: string;
  userAgent: string;
  requestId: string;
};

export type Context = {
  session: Session | null;
  db: Database;
  env: RuntimeEnv;
  dispatcher: JobDispatcher;
  request: RequestMeta;
  logger: Logger;
};
