"use client";
// Shared UI bits: icons and initials avatars

export const I = {
  inbox: "M4 13h4l2 3h4l2-3h4M4 13l2.5-7h11L20 13v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z",
  sent: "M21 3 10 14M21 3l-7 18-4-7-7-4z",
  tag: "M3 12V4h8l9 9-8 8zM7.5 7.5h.01",
  refresh: "M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7",
  edit: "M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4",
  plus: "M12 5v14M5 12h14",
  search: "M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14zM21 21l-5-5",
  logout: "M9 4H5v16h4M14 8l4 4-4 4M18 12H9",
  back: "M15 6l-6 6 6 6",
  x: "M6 6l12 12M18 6 6 18",
  mail: "M4 6h16v12H4zM4 7l8 6 8-6",
  reply: "M9 14 4 9l5-5M4 9h11a5 5 0 0 1 5 5v5",
  ban: "M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18zM5.6 5.6l12.8 12.8",
  layers: "M12 3 3 8l9 5 9-5zM3 13l9 5 9-5",
  news: "M4 5h13v14H6a2 2 0 0 1-2-2zM17 9h3v8a2 2 0 0 1-2 2M8 9h5M8 13h5M8 17h3",
  auto: "M12 7v5l3 2M3 12a9 9 0 1 0 2.6-6.4L3 8M3 3v5h5",
  users: "M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM22 19v-1a4 4 0 0 0-3-3.9M16 4.1a3 3 0 0 1 0 5.8",
};
export function Icon({ d, size = 16 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
  );
}

const PALETTE = ["#2563eb", "#7c3aed", "#db2777", "#dc2626", "#ea580c", "#b45309", "#16a34a", "#0d9488", "#0891b2", "#4f46e5"];

// "Orly Bondoc" → "OB", "Amazon" → "A", no name → from the email ("orly.bondoc@x" → "OB")
export function initials(name?: string | null, email?: string) {
  const words = (name || "").replace(/[<>"'()]/g, "").split(/[\s,]+/).filter(w => /[\p{L}\p{N}]/u.test(w));
  if (words.length >= 2) return (words[0][0] + words[words.length - 1][0]).toUpperCase();
  if (words.length === 1) return words[0][0].toUpperCase();
  const local = (email || "?").split("@")[0];
  const parts = local.split(/[._-]+/).filter(Boolean);
  return (parts.length >= 2 ? parts[0][0] + parts[1][0] : local[0] || "?").toUpperCase();
}
export function colorFor(key: string) {
  let h = 0;
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length];
}
export function Avatar({ name, email, size = 36 }: { name?: string | null; email?: string; size?: number }) {
  return (
    <span className="avatar" title={name || email}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38), background: colorFor((email || name || "").toLowerCase()) }}>
      {initials(name, email)}
    </span>
  );
}
