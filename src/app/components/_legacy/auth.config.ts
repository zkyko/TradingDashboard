import type { NextAuthConfig } from "next-auth";

/** Edge-safe Auth.js config for middleware — no Node, crypto, or SQLite imports. */
export const authConfig = {
  providers: [],
  session: {
    strategy: "jwt" as const,
    maxAge: Number(process.env.AUTH_SESSION_MAX_AGE ?? 43_200),
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  callbacks: {
    authorized({ auth, request }) {
      const path = request.nextUrl.pathname;
      if (
        path.startsWith("/api/auth")
        || path === "/login"
        || path === "/register"
        || path.startsWith("/login/")
        || path.startsWith("/register/")
      ) {
        return true;
      }
      return Boolean(auth?.user);
    },
    async jwt({ token, user }) {
      if (user) {
        token.sub = user.id;
        token.email = user.email;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub ?? "";
        if (token.email) session.user.email = String(token.email);
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
