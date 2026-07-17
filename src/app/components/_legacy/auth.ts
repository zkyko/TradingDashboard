import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { authConfig } from "@/auth.config";

export function isAuthConfigured() {
  return Boolean(process.env.AUTH_SECRET);
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!isAuthConfigured()) return null;
        // Dynamic import keeps SQLite / Node crypto out of the Edge middleware graph.
        const { authenticateUser } = await import("@/lib/users");
        const email = typeof credentials?.email === "string" ? credentials.email : "";
        const password = typeof credentials?.password === "string" ? credentials.password : "";
        const user = authenticateUser(email, password);
        if (!user) return null;
        return { id: user.id, email: user.email, name: user.email };
      },
    }),
  ],
});
