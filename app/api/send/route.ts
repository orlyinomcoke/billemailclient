import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { sendMail } from "@/lib/graph";

const split = (s: string) =>
  String(s || "").split(/[,;\s]+/).map(x => x.trim().toLowerCase()).filter(Boolean);

// POST { to, cc, subject, html } — blocks any Do-Not-Contact recipient
export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return new Response("Unauthorized", { status: 401 });
  const b = await req.json();
  const to = split(b.to), cc = split(b.cc);
  if (!to.length) return Response.json({ error: "Add at least one recipient" }, { status: 400 });

  const blocked = await db.contact.findMany({
    where: { email: { in: [...to, ...cc] }, doNotContact: true },
    select: { email: true, dncReason: true },
  });
  if (blocked.length)
    return Response.json({ error: "Do-Not-Contact recipients", blocked }, { status: 409 });

  await sendMail({ to, cc, subject: b.subject || "", html: b.html || "" });
  await db.sentLog.create({ data: { userId: s.uid, to: [...to, ...cc], subject: b.subject || "" } });
  return Response.json({ ok: true });
}
