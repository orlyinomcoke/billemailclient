import { db } from "@/lib/db";

// GET /api/health — deployment check. Reports yes/no only; never returns secret values.
export const dynamic = "force-dynamic";

const REQUIRED = ["DATABASE_URL", "AUTH_SECRET", "CRON_SECRET", "MS_TENANT_ID", "MS_CLIENT_ID", "MS_CLIENT_SECRET", "MS_MAILBOX"];

export async function GET() {
  const env = Object.fromEntries(REQUIRED.map(k => [k, !!process.env[k]]));
  let database = "ok", tables = false, admins = 0;
  try {
    await db.$queryRaw`SELECT 1`;
    try {
      admins = await db.user.count({ where: { role: "ADMIN" } });
      tables = true;
    } catch (e: any) {
      database = e?.code === "P2021" ? "connected, but tables are missing (build step didn't run prisma db push)" : `query failed (${e?.code ?? "unknown"})`;
    }
  } catch (e: any) {
    const why: Record<string, string> = {
      P1000: "wrong database username or password",
      P1001: "can't reach the database host",
      P1003: "database name doesn't exist",
      P1010: "user has no access to this database",
      P1013: "DATABASE_URL is malformed (special characters in the password must be URL-encoded)",
    };
    const msg = String(e?.message ?? "");
    const byMessage =
      /authentication failed|credentials .* not valid|access denied for user/i.test(msg) ? why.P1000 :
      /can't reach database server|ECONNREFUSED|ENOTFOUND|timed out/i.test(msg) ? why.P1001 :
      /database .* does not exist|unknown database/i.test(msg) ? why.P1003 :
      /not allowed to access|denied .* to database/i.test(msg) ? why.P1010 :
      /invalid .*url|error parsing connection string/i.test(msg) ? why.P1013 : undefined;
    database = `cannot connect: ${why[e?.errorCode ?? e?.code] ?? byMessage ?? e?.errorCode ?? e?.name ?? "unknown error"}`;
  }
  const ok = database === "ok" && tables && admins > 0 && Object.values(env).every(Boolean);
  return Response.json({ ok, database, tables, admins, env }, { status: ok ? 200 : 503 });
}
