import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Request, type Response } from "express";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const IS_PROD = process.env.NODE_ENV === "production";

interface PendingOAuthState {
  redirectUri: string;
  expiresAt: number;
}

const pendingStates = new Map<string, PendingOAuthState>();

function cleanupExpiredStates() {
  const now = Date.now();
  for (const [key, value] of pendingStates.entries()) {
    if (value.expiresAt <= now) {
      pendingStates.delete(key);
    }
  }
}

function getGoogleCredentials() {
  const clientId = (
    process.env.GOOGLE_CLIENT_ID ||
    process.env.AUTH_GOOGLE_ID ||
    ""
  ).trim();
  const clientSecret = (
    process.env.GOOGLE_CLIENT_SECRET ||
    process.env.AUTH_GOOGLE_SECRET ||
    ""
  ).trim();
  return { clientId, clientSecret };
}

function resolveOrigin(req: Request): string {
  const queryOrigin =
    typeof req.query.origin === "string" ? req.query.origin.trim() : "";
  if (/^https?:\/\/[^/\s]+$/i.test(queryOrigin)) {
    return queryOrigin.replace(/\/+$/, "");
  }

  const envAppUrl = (process.env.APP_URL || "").trim();
  if (/^https?:\/\/\S+/i.test(envAppUrl)) {
    return envAppUrl.replace(/\/+$/, "");
  }

  const forwardedProto = req.headers["x-forwarded-proto"];
  const proto =
    typeof forwardedProto === "string"
      ? forwardedProto.split(",")[0].trim()
      : req.protocol || "http";
  const forwardedHost = req.headers["x-forwarded-host"];
  const host =
    typeof forwardedHost === "string"
      ? forwardedHost.split(",")[0].trim()
      : req.get("host") || `localhost:${PORT}`;

  return `${proto}://${host}`;
}

function renderPopupResultHtml(payload: Record<string, unknown>, message: string): string {
  const serialized = JSON.stringify(payload).replace(/</g, "\\u003c");
  const escapedMessage = message
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Hubdex Authentication</title>
    <style>
      body {
        font-family: "IBM Plex Sans", system-ui, -apple-system, sans-serif;
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 100vh;
        margin: 0;
        background: #ffffff;
        color: #161616;
      }
      .box {
        border: 1px solid #e0e0e0;
        border-top: 4px solid #0f62fe;
        padding: 24px 28px;
        max-width: 360px;
        text-align: center;
      }
      p {
        margin: 0;
        font-size: 14px;
        line-height: 1.5;
      }
    </style>
  </head>
  <body>
    <div class="box">
      <p>${escapedMessage}</p>
    </div>
    <script>
      (function () {
        var data = ${serialized};
        if (window.opener) {
          window.opener.postMessage(data, "*");
          window.close();
        } else {
          window.location.href = "/auth";
        }
      })();
    </script>
  </body>
</html>`;
}

async function startServer() {
  const app = express();

  app.get("/api/auth/google/status", (_req: Request, res: Response) => {
    const { clientId, clientSecret } = getGoogleCredentials();
    res.json({ configured: Boolean(clientId && clientSecret) });
  });

  app.get("/api/auth/google/url", (req: Request, res: Response) => {
    const { clientId, clientSecret } = getGoogleCredentials();
    const origin = resolveOrigin(req);
    const redirectUri = `${origin}/auth/callback`;

    if (!clientId || !clientSecret) {
      res.status(503).json({
        configured: false,
        redirectUri,
        error:
          "Google Sign-In is not configured yet. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to your environment variables and register the callback URL in Google Cloud Console.",
      });
      return;
    }

    cleanupExpiredStates();
    const state = crypto.randomBytes(24).toString("hex");
    pendingStates.set(state, {
      redirectUri,
      expiresAt: Date.now() + 10 * 60 * 1000,
    });

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "openid email profile",
      prompt: "select_account",
      state,
    });

    res.json({
      configured: true,
      url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
    });
  });

  const handleOAuthCallback = async (req: Request, res: Response) => {
    const oauthError =
      typeof req.query.error === "string" ? req.query.error : "";
    if (oauthError) {
      res
        .status(200)
        .type("html")
        .send(
          renderPopupResultHtml(
            {
              type: "OAUTH_AUTH_ERROR",
              error:
                oauthError === "access_denied"
                  ? "Google sign-in was canceled."
                  : `Google sign-in failed (${oauthError}).`,
            },
            "Google sign-in was not completed. You can close this window.",
          ),
        );
      return;
    }

    const code = typeof req.query.code === "string" ? req.query.code : "";
    const state = typeof req.query.state === "string" ? req.query.state : "";

    cleanupExpiredStates();
    const stateEntry = state ? pendingStates.get(state) : undefined;
    if (state) {
      pendingStates.delete(state);
    }

    const { clientId, clientSecret } = getGoogleCredentials();
    if (!code || !clientId || !clientSecret) {
      res
        .status(400)
        .type("html")
        .send(
          renderPopupResultHtml(
            {
              type: "OAUTH_AUTH_ERROR",
              error: "Missing authorization code or Google OAuth credentials.",
            },
            "Authentication could not be completed. This window will close.",
          ),
        );
      return;
    }

    const redirectUri =
      stateEntry?.redirectUri || `${resolveOrigin(req)}/auth/callback`;

    try {
      const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }),
      });

      if (!tokenResponse.ok) {
        const errBody = await tokenResponse.text();
        console.error("[Google OAuth] Token exchange failed:", errBody);
        res
          .status(400)
          .type("html")
          .send(
            renderPopupResultHtml(
              {
                type: "OAUTH_AUTH_ERROR",
                error:
                  "Failed to exchange Google authorization code. Check your Client Secret and Authorized Redirect URI.",
              },
              "Google authentication failed. Closing window...",
            ),
          );
        return;
      }

      const tokenData = (await tokenResponse.json()) as {
        access_token?: string;
      };

      if (!tokenData.access_token) {
        throw new Error("Missing access_token in Google response");
      }

      const userInfoResponse = await fetch(
        "https://openidconnect.googleapis.com/v1/userinfo",
        {
          headers: {
            Authorization: `Bearer ${tokenData.access_token}`,
          },
        },
      );

      if (!userInfoResponse.ok) {
        throw new Error("Failed to fetch Google user profile");
      }

      const profile = (await userInfoResponse.json()) as {
        sub?: string;
        email?: string;
        name?: string;
        picture?: string;
      };

      if (!profile.email) {
        throw new Error("Google account did not return an email address");
      }

      res
        .status(200)
        .type("html")
        .send(
          renderPopupResultHtml(
            {
              type: "OAUTH_AUTH_SUCCESS",
              profile: {
                sub: profile.sub || profile.email,
                email: profile.email.trim().toLowerCase(),
                name: profile.name || "",
                picture: profile.picture || "",
              },
            },
            "Signed in with Google. Closing window...",
          ),
        );
    } catch (err) {
      console.error("[Google OAuth] Callback error:", err);
      res
        .status(500)
        .type("html")
        .send(
          renderPopupResultHtml(
            {
              type: "OAUTH_AUTH_ERROR",
              error:
                err instanceof Error
                  ? err.message
                  : "Google authentication failed.",
            },
            "Authentication failed. Closing window...",
          ),
        );
    }
  };

  app.get(["/auth/callback", "/auth/callback/"], handleOAuthCallback);

  if (!IS_PROD) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, "dist");
    app.use(express.static(distPath));
    app.use((_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Hubdex server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
