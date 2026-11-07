// Server-side authorization helpers. Never expose the service key to browsers.
export const cors = {
  'Access-Control-Allow-Origin': 'https://phototeam.vercel.app',
  'Access-Control-Allow-Headers': 'content-type, apikey, authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
};
export function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}
export function randomToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
}
export async function hashToken(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}
export function isOpen(room: { status: string; ends_at: string | null; remaining_seconds?: number }): boolean {
  return (room.status === 'running' && room.ends_at !== null && Date.parse(room.ends_at) > Date.now()) || (room.status === 'paused' && (room.remaining_seconds || 0) > 0);
}
export function isEnded(room: { status: string; ends_at: string | null }): boolean {
  // Before the manual-finish feature, an expired timer exposed the gallery.
  // Preserve access for those earlier rooms until a timer is restarted.
  return room.status === 'ended' || (room.status === 'running' && room.ends_at !== null && Date.parse(room.ends_at) < Date.parse('2026-11-07T14:54:16Z'));
}

