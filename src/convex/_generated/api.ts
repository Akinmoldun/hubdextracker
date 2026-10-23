import { anyApi } from "convex/server";
import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";
import type * as applications from "../applications";
import type * as auth from "../auth";
import type * as authAccounts from "../authAccounts";
import type * as http from "../http";
import type * as users from "../users";

declare const fullApi: ApiFromModules<{
  applications: typeof applications;
  auth: typeof auth;
  authAccounts: typeof authAccounts;
  http: typeof http;
  users: typeof users;
}>;

export const api: FilterApi<
  typeof fullApi,
  FunctionReference<"query" | "mutation" | "action", "public">
> = anyApi as unknown as FilterApi<
  typeof fullApi,
  FunctionReference<"query" | "mutation" | "action", "public">
>;

export const internal: FilterApi<
  typeof fullApi,
  FunctionReference<"query" | "mutation" | "action", "internal">
> = anyApi as unknown as FilterApi<
  typeof fullApi,
  FunctionReference<"query" | "mutation" | "action", "internal">
>;
