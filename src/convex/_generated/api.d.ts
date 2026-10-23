/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";
import type * as applications from "../applications.js";
import type * as auth from "../auth.js";
import type * as authAccounts from "../authAccounts.js";
import type * as http from "../http.js";
import type * as users from "../users.js";

/**
 * A utility for referencing Convex functions in your app's API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
declare const fullApi: ApiFromModules<{
  applications: typeof applications;
  auth: typeof auth;
  authAccounts: typeof authAccounts;
  http: typeof http;
  users: typeof users;
}>;
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<"query" | "mutation" | "action", "public">
>;
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<"query" | "mutation" | "action", "internal">
>;
export declare const components: Record<string, never>;
