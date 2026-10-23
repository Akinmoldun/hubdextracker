import Google from "@auth/core/providers/google";
import { Anonymous } from "@convex-dev/auth/providers/Anonymous";
import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID ?? process.env.GOOGLE_CLIENT_ID,
      clientSecret:
        process.env.AUTH_GOOGLE_SECRET ?? process.env.GOOGLE_CLIENT_SECRET,
      profile(profile) {
        return {
          id: profile.sub,
          name: profile.name,
          email: profile.email.trim().toLowerCase(),
          image: profile.picture,
        };
      },
    }),
    Password({
      profile(params) {
        const email = String(params.email ?? "")
          .trim()
          .toLowerCase();
        const raw =
          typeof params.name === "string" ? params.name.trim() : "";
        const name = raw ? raw.slice(0, 100) : undefined;
        return {
          email,
          ...(name !== undefined ? { name } : {}),
        };
      },
      validatePasswordRequirements(password: string) {
        if (!password || password.length < 8) {
          throw new Error("Password must be at least 8 characters.");
        }
      },
    }),
    Anonymous,
  ],
});