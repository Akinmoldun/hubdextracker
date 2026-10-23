// Unified Convex client & standalone runtime layer
// Uses ConvexReactClient when VITE_CONVEX_URL is configured; otherwise runs
// an in-memory/session store with Express-backed popup Google OAuth 2.0.

import React, { useMemo, useSyncExternalStore } from "react";
import {
  ConvexReactClient,
  useConvex as useRealConvex,
  useConvexAuth as useRealConvexAuth,
  useMutation as useRealMutation,
  useQuery as useRealQuery,
  type OptionalRestArgsOrSkip,
} from "convex/react";
import {
  ConvexAuthProvider as RealConvexAuthProvider,
  useAuthActions as useRealAuthActions,
} from "@convex-dev/auth/react";
import { anyApi } from "convex/server";
import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
  OptionalRestArgs,
} from "convex/server";
import type { Value } from "convex/values";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { STAGES, type Priority, type Stage } from "@/convex/schema";

const RAW_CONVEX_URL =
  (import.meta.env.VITE_CONVEX_URL as string | undefined)?.trim() ?? "";
export const IS_MOCK_CONVEX = !/^https?:\/\/\S+/.test(RAW_CONVEX_URL);

const realConvexClient = IS_MOCK_CONVEX
  ? null
  : new ConvexReactClient(RAW_CONVEX_URL);

function getRefName(ref: unknown): string {
  if (ref && typeof ref === "object" && "_name" in ref) {
    return String((ref as { _name: unknown })._name);
  }
  return "";
}

function resolveRealFunctionRef(
  ref: unknown,
): FunctionReference<"query" | "mutation" | "action"> {
  const name = getRefName(ref);
  if (!name) return ref as FunctionReference<"query" | "mutation" | "action">;
  const [mod, fn] = name.split(":");
  const apiRecord = anyApi as unknown as Record<
    string,
    Record<string, FunctionReference<"query" | "mutation" | "action">>
  >;
  return apiRecord[mod][fn];
}

// ---------- In-memory store (with safe sessionStorage backup for tab navigation) ----------

interface StoredAccount {
  userId: Id<"users">;
  email: string;
  password?: string;
  googleSub?: string;
  name?: string;
}

interface MockState {
  currentUserId: Id<"users"> | null;
  users: Map<Id<"users">, Doc<"users">>;
  accountsByEmail: Map<string, StoredAccount>;
  applications: Map<Id<"applications">, Doc<"applications">>;
}

const STORAGE_KEY = "hubdex_mock_store_v1";

function loadInitialState(): MockState {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as {
        currentUserId: Id<"users"> | null;
        users: Array<[Id<"users">, Doc<"users">]>;
        accountsByEmail: Array<[string, StoredAccount]>;
        applications: Array<[Id<"applications">, Doc<"applications">]>;
      };
      return {
        currentUserId: parsed.currentUserId ?? null,
        users: new Map(parsed.users ?? []),
        accountsByEmail: new Map(parsed.accountsByEmail ?? []),
        applications: new Map(parsed.applications ?? []),
      };
    }
  } catch {
    // Ignore storage errors in restricted iframes
  }
  return {
    currentUserId: null,
    users: new Map(),
    accountsByEmail: new Map(),
    applications: new Map(),
  };
}

const mockState: MockState = loadInitialState();
let stateVersion = 0;
const listeners = new Set<() => void>();

function notifyChange() {
  stateVersion += 1;
  try {
    window.sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        currentUserId: mockState.currentUserId,
        users: Array.from(mockState.users.entries()),
        accountsByEmail: Array.from(mockState.accountsByEmail.entries()),
        applications: Array.from(mockState.applications.entries()),
      }),
    );
  } catch {
    // Ignore storage errors
  }
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getVersion() {
  return stateVersion;
}

function makeId<T extends "users" | "applications">(table: T): Id<T> {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${table}_${Date.now()}_${rand}` as Id<T>;
}

const LIMITS: Record<string, number> = {
  company: 120,
  role: 120,
  location: 200,
  salary: 100,
  url: 500,
  notes: 2000,
};

function validateApplicationFields(
  fields: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const copy = { ...fields };
  for (const [key, limit] of Object.entries(LIMITS)) {
    const value = copy[key];
    if (value !== undefined && value !== null) {
      if (value.trim().length === 0) {
        copy[key] = undefined;
        continue;
      }
      if (value.length > limit) {
        throw new Error(`"${key}" is limited to ${limit} characters.`);
      }
    }
  }
  if (!copy.company || copy.company.trim().length === 0) {
    throw new Error("Company is required.");
  }
  if (!copy.role || copy.role.trim().length === 0) {
    throw new Error("Role is required.");
  }
  if (copy.url && !/^https?:\/\/\S+$/.test(copy.url.trim())) {
    throw new Error("Job URL must start with http:// or https://");
  }
  if (copy.appliedDate && !/^\d{4}-\d{2}-\d{2}$/.test(copy.appliedDate)) {
    throw new Error("Invalid applied date.");
  }
  return copy;
}

function evaluateMockQuery(
  fnName: string,
  args?: Record<string, unknown>,
): unknown {
  switch (fnName) {
    case "users:currentUser": {
      if (!mockState.currentUserId) return null;
      return mockState.users.get(mockState.currentUserId) ?? null;
    }
    case "authAccounts:passwordAccountExists": {
      const email = String(args?.email ?? "")
        .trim()
        .toLowerCase();
      const acct = mockState.accountsByEmail.get(email);
      return Boolean(acct && acct.password !== undefined);
    }
    case "applications:list": {
      if (!mockState.currentUserId) return [];
      const result: Doc<"applications">[] = [];
      for (const app of mockState.applications.values()) {
        if (app.userId === mockState.currentUserId) {
          result.push(app);
        }
      }
      return result;
    }
    case "applications:stats": {
      const byStage = Object.fromEntries(STAGES.map((s) => [s, 0])) as Record<
        string,
        number
      >;
      if (!mockState.currentUserId) {
        return {
          total: 0,
          active: 0,
          interviews: 0,
          offers: 0,
          byStage,
        };
      }
      let total = 0;
      for (const app of mockState.applications.values()) {
        if (app.userId === mockState.currentUserId) {
          total += 1;
          byStage[app.stage] = (byStage[app.stage] ?? 0) + 1;
        }
      }
      return {
        total,
        active: byStage["Applied"] + byStage["Interview"],
        interviews: byStage["Interview"],
        offers: byStage["Offer"],
        byStage,
      };
    }
    default:
      return null;
  }
}

async function executeMockMutation(
  fnName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const userId = mockState.currentUserId;
  if (!userId) {
    throw new Error("Not authenticated");
  }

  switch (fnName) {
    case "applications:create": {
      const clean = validateApplicationFields({
        company: args.company as string | undefined,
        role: args.role as string | undefined,
        location: args.location as string | undefined,
        salary: args.salary as string | undefined,
        url: args.url as string | undefined,
        appliedDate: args.appliedDate as string | undefined,
        notes: args.notes as string | undefined,
      });
      const id = makeId("applications");
      const doc: Doc<"applications"> = {
        _id: id,
        _creationTime: Date.now(),
        userId,
        company: (clean.company as string).trim(),
        role: (clean.role as string).trim(),
        location: clean.location,
        salary: clean.salary,
        url: clean.url,
        stage: args.stage as Stage,
        priority: args.priority as Priority,
        appliedDate: clean.appliedDate,
        notes: clean.notes,
      };
      mockState.applications.set(id, doc);
      notifyChange();
      return id;
    }
    case "applications:update": {
      const id = args.id as Id<"applications">;
      const existing = mockState.applications.get(id);
      if (!existing || existing.userId !== userId) {
        throw new Error("Application not found.");
      }
      const clean = validateApplicationFields({
        company: args.company as string | undefined,
        role: args.role as string | undefined,
        location: args.location as string | undefined,
        salary: args.salary as string | undefined,
        url: args.url as string | undefined,
        appliedDate: args.appliedDate as string | undefined,
        notes: args.notes as string | undefined,
      });
      mockState.applications.set(id, {
        ...existing,
        company: (clean.company as string).trim(),
        role: (clean.role as string).trim(),
        location: clean.location,
        salary: clean.salary,
        url: clean.url,
        stage: args.stage as Stage,
        priority: args.priority as Priority,
        appliedDate: clean.appliedDate,
        notes: clean.notes,
      });
      notifyChange();
      return null;
    }
    case "applications:updateStage": {
      const id = args.id as Id<"applications">;
      const existing = mockState.applications.get(id);
      if (!existing || existing.userId !== userId) {
        throw new Error("Application not found.");
      }
      mockState.applications.set(id, {
        ...existing,
        stage: args.stage as Stage,
      });
      notifyChange();
      return null;
    }
    case "applications:remove": {
      const id = args.id as Id<"applications">;
      const existing = mockState.applications.get(id);
      if (!existing || existing.userId !== userId) {
        throw new Error("Application not found.");
      }
      mockState.applications.delete(id);
      notifyChange();
      return null;
    }
    default:
      return null;
  }
}

interface GooglePopupProfile {
  sub: string;
  email: string;
  name?: string;
  picture?: string;
}

async function runPopupGoogleSignIn(): Promise<{ signingIn: boolean }> {
  const origin = window.location.origin;
  const response = await fetch(
    `/api/auth/google/url?origin=${encodeURIComponent(origin)}`,
  );
  const data = (await response.json()) as {
    configured?: boolean;
    url?: string;
    error?: string;
  };

  if (!response.ok || !data.url) {
    throw new Error(
      data.error ||
        "Google Sign-In is not configured yet. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in your environment settings.",
    );
  }

  const popup = window.open(
    data.url,
    "hubdex_google_oauth",
    "width=520,height=640,menubar=no,toolbar=no,status=no",
  );

  if (!popup) {
    throw new Error(
      "Popup blocked by your browser. Please allow popups for this site and try again.",
    );
  }

  const profile = await new Promise<GooglePopupProfile>((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      window.removeEventListener("message", handleMessage);
      window.clearInterval(closeTimer);
    };

    const handleMessage = (event: MessageEvent) => {
      const evOrigin = event.origin || "";
      if (
        evOrigin &&
        evOrigin !== window.location.origin &&
        !evOrigin.endsWith(".run.app") &&
        !evOrigin.includes("localhost")
      ) {
        return;
      }

      const payload = event.data as {
        type?: string;
        profile?: GooglePopupProfile;
        error?: string;
      } | null;

      if (!payload || typeof payload !== "object") return;

      if (payload.type === "OAUTH_AUTH_SUCCESS" && payload.profile?.email) {
        settled = true;
        cleanup();
        resolve(payload.profile);
      } else if (payload.type === "OAUTH_AUTH_ERROR") {
        settled = true;
        cleanup();
        reject(new Error(payload.error || "Google sign-in failed."));
      }
    };

    const closeTimer = window.setInterval(() => {
      if (popup.closed && !settled) {
        settled = true;
        cleanup();
        reject(new Error("Google sign-in was canceled."));
      }
    }, 500);

    window.addEventListener("message", handleMessage);
  });

  const email = profile.email.trim().toLowerCase();
  const existing = mockState.accountsByEmail.get(email);
  const userId = existing?.userId ?? makeId("users");
  const existingUserDoc = mockState.users.get(userId);
  const cleanName = profile.name?.trim().slice(0, 100);

  const userDoc: Doc<"users"> = {
    _id: userId,
    _creationTime: existingUserDoc?._creationTime ?? Date.now(),
    email,
    ...(cleanName || existingUserDoc?.name
      ? { name: cleanName || existingUserDoc?.name }
      : {}),
    ...(profile.picture || existingUserDoc?.image
      ? { image: profile.picture || existingUserDoc?.image }
      : {}),
    isAnonymous: false,
  };

  mockState.users.set(userId, userDoc);
  mockState.accountsByEmail.set(email, {
    ...existing,
    userId,
    email,
    googleSub: profile.sub,
    name: cleanName || existing?.name,
  });
  mockState.currentUserId = userId;
  notifyChange();

  return { signingIn: true };
}

type SignInParams =
  | FormData
  | (Record<string, Value> & { redirectTo?: string; code?: string });

async function mockSignIn(
  provider: string,
  params?: SignInParams,
): Promise<{ signingIn: boolean }> {
  const getParam = (key: string): string => {
    if (!params) return "";
    if (params instanceof FormData) {
      return String(params.get(key) ?? "");
    }
    return String(params[key] ?? "");
  };

  if (provider === "google") {
    return runPopupGoogleSignIn();
  }

  if (provider === "anonymous") {
    const userId = makeId("users");
    const guestUser: Doc<"users"> = {
      _id: userId,
      _creationTime: Date.now(),
      name: "Guest",
      isAnonymous: true,
    };
    mockState.users.set(userId, guestUser);
    mockState.currentUserId = userId;
    notifyChange();
    return { signingIn: true };
  }

  if (provider === "password") {
    const flow = getParam("flow");
    const email = getParam("email").trim().toLowerCase();
    const password = getParam("password");
    const rawName = getParam("name").trim();

    if (flow === "signUp") {
      if (!password || password.length < 8) {
        throw new Error("Password must be at least 8 characters.");
      }
      const existing = mockState.accountsByEmail.get(email);
      if (existing && existing.password !== undefined) {
        throw new Error("Account already exists.");
      }
      const userId = existing?.userId ?? makeId("users");
      const userDoc: Doc<"users"> = {
        _id: userId,
        _creationTime: Date.now(),
        email,
        ...(rawName ? { name: rawName.slice(0, 100) } : {}),
        isAnonymous: false,
      };
      mockState.users.set(userId, userDoc);
      mockState.accountsByEmail.set(email, {
        ...existing,
        userId,
        email,
        password,
        name: rawName || existing?.name,
      });
      mockState.currentUserId = userId;
      notifyChange();
      return { signingIn: true };
    }

    const acct = mockState.accountsByEmail.get(email);
    if (!acct || acct.password === undefined || acct.password !== password) {
      throw new Error("Invalid credentials");
    }
    mockState.currentUserId = acct.userId;
    notifyChange();
    return { signingIn: true };
  }

  throw new Error(`Unsupported auth provider: ${provider}`);
}

async function mockSignOut(): Promise<void> {
  mockState.currentUserId = null;
  notifyChange();
}

// ---------- Provider & Unified Hooks ----------

export function AppConvexProvider({ children }: { children: React.ReactNode }) {
  if (!IS_MOCK_CONVEX && realConvexClient) {
    return (
      <RealConvexAuthProvider client={realConvexClient}>
        {children}
      </RealConvexAuthProvider>
    );
  }
  return <>{children}</>;
}

function useMockConvexAuth(): { isLoading: boolean; isAuthenticated: boolean } {
  const version = useSyncExternalStore(subscribe, getVersion, getVersion);
  void version;
  return {
    isLoading: false,
    isAuthenticated: mockState.currentUserId !== null,
  };
}

export const useConvexAuth = IS_MOCK_CONVEX
  ? useMockConvexAuth
  : useRealConvexAuth;

function useMockAuthActions() {
  return {
    signIn: mockSignIn,
    signOut: mockSignOut,
  };
}

export const useAuthActions = IS_MOCK_CONVEX
  ? useMockAuthActions
  : useRealAuthActions;

function useMockQuery<Query extends FunctionReference<"query">>(
  query: Query,
  ...args: OptionalRestArgsOrSkip<Query>
): FunctionReturnType<Query> | undefined {
  const version = useSyncExternalStore(subscribe, getVersion, getVersion);
  const firstArg = args[0];

  return useMemo(() => {
    void version;
    if (firstArg === "skip") return undefined;
    const fnName = getRefName(query);
    return evaluateMockQuery(
      fnName,
      firstArg as Record<string, unknown> | undefined,
    ) as FunctionReturnType<Query>;
  }, [query, firstArg, version]);
}

function useLiveQuery<Query extends FunctionReference<"query">>(
  query: Query,
  ...args: OptionalRestArgsOrSkip<Query>
): FunctionReturnType<Query> | undefined {
  const realRef = resolveRealFunctionRef(query) as Query;
  return useRealQuery(realRef, ...args);
}

export const useQuery = IS_MOCK_CONVEX ? useMockQuery : useLiveQuery;

function useMockMutation<Mutation extends FunctionReference<"mutation">>(
  mutation: Mutation,
): (args: FunctionArgs<Mutation>) => Promise<FunctionReturnType<Mutation>> {
  return async (args: FunctionArgs<Mutation>) => {
    const fnName = getRefName(mutation);
    const res = await executeMockMutation(
      fnName,
      (args ?? {}) as Record<string, unknown>,
    );
    return res as FunctionReturnType<Mutation>;
  };
}

function useLiveMutation<Mutation extends FunctionReference<"mutation">>(
  mutation: Mutation,
): (args: FunctionArgs<Mutation>) => Promise<FunctionReturnType<Mutation>> {
  const realRef = resolveRealFunctionRef(mutation) as Mutation;
  const mutate = useRealMutation(realRef);
  return (args: FunctionArgs<Mutation>) =>
    mutate(
      ...([args] as unknown as OptionalRestArgs<Mutation>),
    ) as Promise<FunctionReturnType<Mutation>>;
}

export const useMutation = IS_MOCK_CONVEX ? useMockMutation : useLiveMutation;

function useMockConvexClient() {
  return {
    query: async <Query extends FunctionReference<"query">>(
      query: Query,
      ...args: OptionalRestArgs<Query>
    ): Promise<FunctionReturnType<Query>> => {
      const fnName = getRefName(query);
      return evaluateMockQuery(
        fnName,
        args[0] as Record<string, unknown> | undefined,
      ) as FunctionReturnType<Query>;
    },
  };
}

function useLiveConvexClient() {
  const client = useRealConvex();
  return {
    query: <Query extends FunctionReference<"query">>(
      query: Query,
      ...args: OptionalRestArgs<Query>
    ): Promise<FunctionReturnType<Query>> => {
      const realRef = resolveRealFunctionRef(query) as Query;
      return client.query(realRef, ...args);
    },
  };
}

export const useConvex = IS_MOCK_CONVEX
  ? useMockConvexClient
  : useLiveConvexClient;
