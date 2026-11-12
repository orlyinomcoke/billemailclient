import { getSession } from "@/lib/auth";
import { pushAutoContacts, sheetStatus } from "@/lib/sheets";

// GET  /api/sheet — Google Sheet connection status
// POST /api/sheet — push Contacts from Auto Replies to the sheet now
export async function GET() {
  if (!(await getSession())) return new Response("Unauthorized", { status: 401 });
  return Response.json(sheetStatus());
}
export async function POST() {
  if (!(await getSession())) return new Response("Unauthorized", { status: 401 });
  const r = await pushAutoContacts();
  return Response.json({ ...r, status: sheetStatus() }, { status: "ok" in r && !r.ok ? 502 : 200 });
}
