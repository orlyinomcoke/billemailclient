import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { AUTOMATED } from "@/lib/extract";
import { autoContactWhere } from "@/lib/autoContacts";

const PAGE = 100;
const SORTABLE = ["firstName", "lastName", "name", "email", "phone", "company", "status", "doNotContact", "autoEmails", "autoPhones"] as const;
const REQUIRED = new Set(["email", "doNotContact"]); // non-null columns can't take a nulls ordering

// GET /api/contacts?q=&page=&sort=&dir=&businessId=(id|none)&dnc=(yes|no)&hideAuto=1
//   &autoReplies=1 (only people who sent auto-replies)&withInfo=1 (only those with extracted emails/phones)
export async function GET(req: Request) {
  if (!(await getSession())) return new Response("Unauthorized", { status: 401 });
  const p = new URL(req.url).searchParams;
  const q = p.get("q")?.trim();
  const page = Math.max(1, Number(p.get("page")) || 1);
  const sort = (SORTABLE as readonly string[]).includes(p.get("sort") || "") ? p.get("sort")! : "firstName";
  const dir: Prisma.SortOrder = p.get("dir") === "desc" ? "desc" : "asc";

  const and: Prisma.ContactWhereInput[] = [];
  if (q) and.push({
    OR: (["name", "firstName", "lastName", "email", "company", "phone", "status", "autoEmails", "autoPhones"] as const)
      .map(f => ({ [f]: { contains: q } })),
  });
  const biz = p.get("businessId");
  if (biz) and.push({ businessId: biz === "none" ? null : biz });
  if (p.get("dnc") === "yes") and.push({ doNotContact: true });
  if (p.get("dnc") === "no") and.push({ doNotContact: false });
  if (p.get("hideAuto")) and.push(...AUTOMATED.map(a => ({ email: { not: { contains: a } } })));
  if (p.get("autoReplies")) and.push(autoContactWhere(false));
  if (p.get("withInfo")) and.push({ OR: [{ autoEmails: { not: null } }, { autoPhones: { not: null } }] });
  const where: Prisma.ContactWhereInput = { AND: and };

  const orderBy = [
    REQUIRED.has(sort) ? { [sort]: dir } : { [sort]: { sort: dir, nulls: "last" } },
    { email: "asc" as const },
  ] as Prisma.ContactOrderByWithRelationInput[];

  const [rows, total] = await Promise.all([
    db.contact.findMany({
      where, orderBy, skip: (page - 1) * PAGE, take: PAGE,
      select: {
        id: true, email: true, name: true, firstName: true, lastName: true, phone: true, company: true,
        status: true, businessId: true, doNotContact: true, dncReason: true, autoEmails: true, autoPhones: true,
      },
    }),
    db.contact.count({ where }),
  ]);
  return Response.json({ rows, total, page, pageSize: PAGE });
}
