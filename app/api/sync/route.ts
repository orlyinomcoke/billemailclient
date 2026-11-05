import { getSession } from "@/lib/auth";
import { syncMailbox } from "@/lib/sync";

// Called by the "Refresh" button, or by a cron with ?key=CRON_SECRET
export async function POST(req: Request) {
  const key = new URL(req.url).searchParams.get("key");
  if (key !== process.env.CRON_SECRET && !(await getSession()))
    return new Response("Unauthorized", { status: 401 });
  const synced = await syncMailbox();
  return Response.json({ synced });
}
