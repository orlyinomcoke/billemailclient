import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { extractBatch } from "@/lib/extract";

// POST /api/contacts/extract — fills details for contacts not yet scanned (batches of 300).
// ?all=1 marks every contact for a re-scan first (only blank fields get filled).
export async function POST(req: Request) {
  if (!(await getSession())) return new Response("Unauthorized", { status: 401 });
  if (new URL(req.url).searchParams.get("all")) await db.contact.updateMany({ data: { extractedAt: null } });
  return Response.json(await extractBatch());
}
