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
export function isOpen(room: { status: string; ends_at: string | null }): boolean {
  return room.status === 'running' && room.ends_at !== null && Date.parse(room.ends_at) > Date.now();
}
export function isEnded(room: { status: string; ends_at: string | null }): boolean {
  return room.status === 'ended';
}

