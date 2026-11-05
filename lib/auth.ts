import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

const secret = new TextEncoder().encode(process.env.AUTH_SECRET!);
export type Session = { uid: string; role: "ADMIN" | "STAFF"; name: string };

export async function createSession(s: Session) {
  const token = await new SignJWT(s).setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("7d").sign(secret);
  (await cookies()).set("session", token, {
    httpOnly: true, secure: process.env.NODE_ENV === "production",
    sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 7,
  });
}

export async function getSession(): Promise<Session | null> {
  const t = (await cookies()).get("session")?.value;
  if (!t) return null;
  try { return (await jwtVerify(t, secret)).payload as unknown as Session; }
  catch { return null; }
}

export async function requireSession() {
  const s = await getSession();
  if (!s) throw new Response("Unauthorized", { status: 401 });
  return s;
}
