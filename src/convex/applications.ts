import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import { STAGES, stageValidator, priorityValidator, type Stage } from "./schema";

interface ApplicationFieldsInput {
  company: string;
  role: string;
  location?: string;
  salary?: string;
  url?: string;
  appliedDate?: string;
  notes?: string;
}

interface ValidatedApplicationFields {
  company: string;
  role: string;
  location?: string;
  salary?: string;
  url?: string;
  appliedDate?: string;
  notes?: string;
}

function cleanOptionalText(
  value: string | undefined,
  fieldLabel: string,
  limit: number,
): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed.length > limit) {
    throw new Error(`"${fieldLabel}" is limited to ${limit} characters.`);
  }
  return trimmed;
}

async function requireUser(ctx: QueryCtx | MutationCtx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new Error("Not authenticated");
  }
  return userId;
}

function validateFields(
  fields: ApplicationFieldsInput,
): ValidatedApplicationFields {
  const company = fields.company.trim();
  if (company.length === 0) {
    throw new Error("Company is required.");
  }
  if (company.length > 120) {
    throw new Error('"company" is limited to 120 characters.');
  }

  const role = fields.role.trim();
  if (role.length === 0) {
    throw new Error("Role is required.");
  }
  if (role.length > 120) {
    throw new Error('"role" is limited to 120 characters.');
  }

  const location = cleanOptionalText(fields.location, "location", 200);
  const salary = cleanOptionalText(fields.salary, "salary", 100);
  const url = cleanOptionalText(fields.url, "url", 500);
  const notes = cleanOptionalText(fields.notes, "notes", 2000);
  const appliedDate = cleanOptionalText(fields.appliedDate, "appliedDate", 20);

  if (url && !/^https?:\/\/\S+$/.test(url)) {
    throw new Error("Job URL must start with http:// or https://");
  }
  if (appliedDate && !/^\d{4}-\d{2}-\d{2}$/.test(appliedDate)) {
    throw new Error("Invalid applied date.");
  }

  return {
    company,
    role,
    location,
    salary,
    url,
    appliedDate,
    notes,
  };
}

function createEmptyStageCounts(): Record<Stage, number> {
  return {
    Wishlist: 0,
    Applied: 0,
    Interview: 0,
    Offer: 0,
    Rejected: 0,
  };
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    return await ctx.db
      .query("applications")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
  },
});

export const stats = query({
  args: {},
  handler: async (ctx) => {
    const byStage = createEmptyStageCounts();
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return {
        total: 0,
        active: 0,
        interviews: 0,
        offers: 0,
        byStage,
      };
    }
    const apps = await ctx.db
      .query("applications")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    for (const a of apps) {
      if (STAGES.includes(a.stage)) {
        byStage[a.stage] += 1;
      }
    }
    return {
      total: apps.length,
      active: byStage.Applied + byStage.Interview,
      interviews: byStage.Interview,
      offers: byStage.Offer,
      byStage,
    };
  },
});

export const create = mutation({
  args: {
    company: v.string(),
    role: v.string(),
    location: v.optional(v.string()),
    salary: v.optional(v.string()),
    url: v.optional(v.string()),
    stage: stageValidator,
    priority: priorityValidator,
    appliedDate: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const clean = validateFields(args);
    return await ctx.db.insert("applications", {
      company: clean.company,
      role: clean.role,
      location: clean.location,
      salary: clean.salary,
      url: clean.url,
      stage: args.stage,
      priority: args.priority,
      appliedDate: clean.appliedDate,
      notes: clean.notes,
      userId,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("applications"),
    company: v.string(),
    role: v.string(),
    location: v.optional(v.string()),
    salary: v.optional(v.string()),
    url: v.optional(v.string()),
    stage: stageValidator,
    priority: priorityValidator,
    appliedDate: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const existing = await ctx.db.get(args.id);
    if (!existing || existing.userId !== userId) {
      throw new Error("Application not found.");
    }
    const clean = validateFields(args);
    await ctx.db.patch(args.id, {
      company: clean.company,
      role: clean.role,
      location: clean.location,
      salary: clean.salary,
      url: clean.url,
      stage: args.stage,
      priority: args.priority,
      appliedDate: clean.appliedDate,
      notes: clean.notes,
    });
  },
});

export const updateStage = mutation({
  args: { id: v.id("applications"), stage: stageValidator },
  handler: async (ctx, { id, stage }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const existing = await ctx.db.get(id);
    if (!existing || existing.userId !== userId) {
      throw new Error("Application not found.");
    }
    await ctx.db.patch(id, { stage });
  },
});

export const remove = mutation({
  args: { id: v.id("applications") },
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const existing = await ctx.db.get(id);
    if (!existing || existing.userId !== userId) {
      throw new Error("Application not found.");
    }
    await ctx.db.delete(id);
  },
});
