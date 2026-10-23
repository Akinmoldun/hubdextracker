import { execSync } from "node:child_process";

const hasDeployKey = Boolean(process.env.CONVEX_DEPLOY_KEY?.trim());

if (hasDeployKey) {
  console.log("[Vercel Build] CONVEX_DEPLOY_KEY detected — deploying Convex functions and building frontend...");
  execSync('npx convex deploy --cmd "npm run build"', { stdio: "inherit" });
} else {
  console.log("[Vercel Build] No CONVEX_DEPLOY_KEY set — running frontend build directly...");
  execSync("npm run build", { stdio: "inherit" });
}
