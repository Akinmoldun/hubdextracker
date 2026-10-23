import { execSync } from "node:child_process";

const isVercel = Boolean(process.env.VERCEL);
const hasDeployKey = Boolean(process.env.CONVEX_DEPLOY_KEY?.trim());

if (isVercel && hasDeployKey) {
  console.log(
    "[Vercel Build] VERCEL + CONVEX_DEPLOY_KEY detected — deploying Convex functions and building frontend with VITE_CONVEX_URL...",
  );
  execSync(
    'npx convex deploy --cmd "npm run build" --cmd-url-env-var-name VITE_CONVEX_URL',
    { stdio: "inherit" },
  );
} else {
  console.log(
    "[Vercel Build] Running frontend build directly (using committed src/convex/_generated types)...",
  );
  execSync("npm run build", { stdio: "inherit" });
}
