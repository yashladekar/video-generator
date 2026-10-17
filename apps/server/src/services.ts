import { createAuth } from "@video-generator/auth";
import { createPrismaClient } from "@video-generator/db";

import { ENV } from "./env.server";

export const db = createPrismaClient(ENV);
export const auth = createAuth(ENV, db);
