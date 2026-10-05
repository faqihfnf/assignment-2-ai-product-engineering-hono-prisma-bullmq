import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { logger } from "hono/logger";
import { env } from "./config/env";
import { jobRouter } from "./modules/job/router";
import { studyGuideQueue } from "./worker/queue";

const app = new Hono()
  .use(logger())
  .get("/", (c) =>
    c.json({
      name: "AI Study Guide API",
      endpoints: ["POST /jobs", "GET /jobs", "GET /jobs/:id"],
    }),
  )
  .route("/jobs", jobRouter)
  .notFound((c) => c.json({ error: "Route not found" }, 404))
  .onError((err, c) => {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  });

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`API running on http://localhost:${info.port}`);
});

async function shutdown() {
  server.close();
  await studyGuideQueue.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
