import { randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { db } from "@/lib/db";

export type UserRecord = {
  id: string;
  email: string;
  password_hash: string;
  created_at: string;
};

const MIN_PASSWORD_LENGTH = 8;

function hashPassword(password: string, salt = randomBytes(16).toString("hex")) {
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string) {
  const [salt, expected] = stored.split(":");
  if (!salt || !expected) return false;
  const actual = scryptSync(password, salt, 64);
  const expectedBuf = Buffer.from(expected, "hex");
  if (actual.length !== expectedBuf.length) return false;
  return timingSafeEqual(actual, expectedBuf);
}

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function findUserByEmail(email: string) {
  return db.prepare("SELECT * FROM users WHERE email = ?").get(normalizeEmail(email)) as UserRecord | undefined;
}

export function createUser(email: string, password: string) {
  const normalized = normalizeEmail(email);
  if (!normalized || !normalized.includes("@")) {
    return { ok: false as const, error: "Enter a valid email address." };
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false as const, error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` };
  }
  if (findUserByEmail(normalized)) {
    return { ok: false as const, error: "An account with that email already exists." };
  }

  const id = crypto.randomUUID();
  db.prepare("INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)").run(
    id,
    normalized,
    hashPassword(password),
  );
  return { ok: true as const, user: { id, email: normalized } };
}

export function authenticateUser(email: string, password: string) {
  const user = findUserByEmail(email);
  if (!user || !verifyPassword(password, user.password_hash)) return null;
  return { id: user.id, email: user.email };
}
