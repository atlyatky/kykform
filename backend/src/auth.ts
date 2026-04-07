import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET ?? "dev-secret-change-in-production";

export async function hashPassword(plain: string) {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain: string, hash: string) {
  return bcrypt.compare(plain, hash);
}

export function signToken(adminId: string, email: string, role: string) {
  return jwt.sign({ sub: adminId, email, role }, JWT_SECRET, { expiresIn: "7d" });
}

export function verifyToken(header: string | undefined): { sub: string; email: string; role?: string } | null {
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7);
  try {
    const p = jwt.verify(token, JWT_SECRET) as { sub: string; email: string; role?: string };
    return p;
  } catch {
    return null;
  }
}
