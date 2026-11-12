import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { scheduleSheetPush } from "@/lib/sheets";

const TEXT_FIELDS = ["name", "firstName", "lastName", "phone", "company", "status", "autoEmails", "autoPhones"] as const;

// PATCH { name, firstName, lastName, phone, company, status, businessId, applyToMessages, doNotContact, dncReason }
// applyToMessages: also tag all of this person's emails with businessId (same as "Apply to all mail from this person")
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getSession())) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  const b = await req.json();
  const text: Record<string, string | null> = {};
  for (const f of TEXT_FIELDS) if (b[f] !== undefined) text[f] = String(b[f] ?? "").trim() || null;

  const c = await db.contact.update({
    where: { id },
    data: {
      ...text,
      ...(b.businessId !== undefined && { businessId: b.businessId || null }),
      ...(b.doNotContact !== undefined && {
        doNotContact: !!b.doNotContact,
        dncReason: b.doNotContact ? b.dncReason ?? null : null,
        dncSetAt: b.doNotContact ? new Date() : null,
      }),
    },
  });
  if (b.businessId !== undefined && b.applyToMessages)
    await db.message.updateMany({ where: { contactId: id }, data: { businessId: b.businessId || null } });
  scheduleSheetPush(); // keep the Google Sheet in step with edits
  return Response.json(c);
}
