"use client";
import { useState } from "react";

export default function Login() {
  const [email, setEmail] = useState(""), [password, setPassword] = useState(""), [err, setErr] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const r = await fetch("/api/auth", { method: "POST", body: JSON.stringify({ email, password }) });
    if (r.ok) location.href = "/"; else setErr((await r.json()).error);
  }
  return (
    <form onSubmit={submit} style={{ maxWidth: 340, margin: "15vh auto", display: "grid", gap: 10, background: "#fff", padding: 24, borderRadius: 10 }}>
      <h2 style={{ margin: 0 }}>MailHub</h2>
      {err && <div className="err">{err}</div>}
      <input placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} />
      <input placeholder="Password" type="password" value={password} onChange={e => setPassword(e.target.value)} />
      <button className="primary">Sign in</button>
    </form>
  );
}
