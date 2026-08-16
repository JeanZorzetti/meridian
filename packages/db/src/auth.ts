import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";
import { sql } from "./db.ts";

export const SESSION_COOKIE = "mrd_session";
const DAY = 24 * 60 * 60 * 1000;
const SESSION_DAYS = 30;

export function hashPassword(pw: string): string {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(pw, salt, 64).toString("hex")}`;
}

export function verifyPassword(pw: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, "hex");
  const got = scryptSync(pw, salt, 64);
  return expected.length === got.length && timingSafeEqual(expected, got);
}

export async function authenticate(username: string, password: string) {
  const [u] = await sql`select id, username, password_hash from users where username = ${username}`;
  if (!u || !verifyPassword(password, u.password_hash)) return null;
  return { id: u.id as number, username: u.username as string };
}

export async function createSession(userId: number) {
  const token = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + SESSION_DAYS * DAY);
  await sql`insert into sessions (token, user_id, expires_at) values (${token}, ${userId}, ${expires})`;
  // opportunistic cleanup (index-backed); fire-and-forget so login isn't blocked
  sql`delete from sessions where expires_at < now()`.catch(() => {});
  return { token, expires };
}

export async function getSessionUser(token: string | undefined) {
  if (!token) return null;
  const [row] = await sql`
    select u.id, u.username from sessions s
    join users u on u.id = s.user_id
    where s.token = ${token} and s.expires_at > now()`;
  return row ? { id: row.id as number, username: row.username as string } : null;
}

export async function destroySession(token: string | undefined) {
  if (token) await sql`delete from sessions where token = ${token}`;
}
