import { getSession } from "@/lib/auth";
import { syncMailbox, syncLatest } from "@/lib/sync";
import { scanAutoReplies } from "@/lib/autoContacts";
import { scheduleSheetPush } from "@/lib/sheets";
import { importAutoReplies } from "@/lib/autoImport";

// POST /api/sync — full, resumable sync in ~20s chunks. Returns { synced, done, total }.
// Called by the app (on open, every 2 min, after sending) or by a cron with ?key=CRON_SECRET.
// ?latest=N fetches only the newest N messages (test mode).
export async function POST(req: Request) {
  const p = new URL(req.url).searchParams;
  const key = p.get("key");
  if (key !== process.env.CRON_SECRET && !(await getSession()))
    return new Response("Unauthorized", { status: 401 });
  const latest = Number(p.get("latest"));
  if (latest > 0) return Response.json(await syncLatest(Math.min(latest, 2000)));
  const result = await syncMailbox();
  // One-time import of every past auto-reply (only those, not the whole mailbox)
  const autoImport = await importAutoReplies();
  // Scan any new auto-replies right away so Contacts from Auto Replies (and the Google Sheet) stay current
  const scan = await scanAutoReplies();
  if (!("busy" in scan) && scan.processed) scheduleSheetPush();
  return Response.json({ ...result, autoImport });
}
