// Care Chart Worker: serves the web app from public/ and the chart API under /api/.

import { accessNeeded, requireAccess } from "./access";
import { currentCaregiver, handleCaregiverRoute, handlePublicAuthRoute } from "./auth";
import { handleChartRoute } from "./chart";
import { HttpError, json, type Env } from "./http";
import { handleReminderRoute, sendDueReminders } from "./reminders";
import { handleVisitRoute } from "./visits";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);

    try {
      // Writes must carry this header. A form on another site cannot add it without a
      // CORS preflight, which this Worker never approves, so it blocks cross-site forgery.
      if (request.method !== "GET" && request.headers.get("X-Care-Chart") !== "1") {
        throw new HttpError(403, "Missing request header.");
      }

      const publicResponse = await handlePublicAuthRoute(request, url, env);
      if (publicResponse) return publicResponse;

      const me = await currentCaregiver(request, env);
      if (!me) return json({ error: "Please sign in." }, 401);
      requireAccess(me, accessNeeded(request.method, url.pathname));

      const response = (await handleCaregiverRoute(request, url, env, me))
        ?? (await handleReminderRoute(request, url, env, me))
        ?? (await handleVisitRoute(request, url, env, me))
        ?? (await handleChartRoute(request, url, env, me));
      return response ?? json({ error: "Not found." }, 404);
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.message, ...error.details }, error.status);
      console.error(error);
      return json({ error: "The server had a problem. Please try again." }, 500);
    }
  },

  // The Cron Trigger in wrangler.jsonc: sends dose reminders to subscribed phones.
  async scheduled(_controller: ScheduledController, env: Env, context: ExecutionContext): Promise<void> {
    context.waitUntil(sendDueReminders(env));
  },
} satisfies ExportedHandler<Env>;
