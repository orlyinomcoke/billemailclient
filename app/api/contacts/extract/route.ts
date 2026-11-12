import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { extractBatch } from "@/lib/extract";
import { scanAutoReplies } from "@/lib/autoContacts";
import { scheduleSheetPush } from "@/lib/sheets";

// POST /api/contacts/extract — fills contact details (batches of 300) and scans auto-replies
// for other emails / phone numbers (batches of 500).
// ?all=1 re-scans everything first (only blank fields get filled; new auto-reply finds are appended).
export async function POST(req: Request) {
  if (!(await getSession())) return new Response("Unauthorized", { status: 401 });
  if (new URL(req.url).searchParams.get("all")) {
    await db.contact.updateMany({ data: { extractedAt: null } });
    await db.message.updateMany({ where: { category: "auto" }, data: { autoScanned: false } });
  }
  const a = await extractBatch();
  const b = await scanAutoReplies();
  const busyA = "busy" in a, busyB = "busy" in b;
  if (busyA && busyB) return Response.json({ busy: true });
  if (!busyB && b.processed) scheduleSheetPush();
  return Response.json({
    processed: (busyA ? 0 : a.processed) + (busyB ? 0 : b.processed),
    remaining: (busyA ? 0 : a.remaining) + (busyB ? 0 : b.remaining),
  });
}
