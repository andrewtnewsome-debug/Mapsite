import "server-only";

/**
 * Request context: who is acting, for which tenant and company.
 *
 * The local prototype has exactly one tenant and one owner. Every server
 * entry point resolves a context and checks permissions through `can()`, so
 * real authentication and role-based access can be added later without
 * touching the financial logic.
 */

export type Role = "owner" | "admin" | "accountant" | "viewer";

export type Action =
  | "view:financials"
  | "manage:integrations"
  | "sync:data"
  | "use:ai"
  | "edit:forecast"
  | "manage:collections"
  | "draft:invoices";

export interface RequestContext {
  tenantId: string;
  userId: string;
  role: Role;
}

const ROLE_PERMISSIONS: Record<Role, Action[]> = {
  owner: ["view:financials", "manage:integrations", "sync:data", "use:ai", "edit:forecast", "manage:collections", "draft:invoices"],
  admin: ["view:financials", "manage:integrations", "sync:data", "use:ai", "edit:forecast", "manage:collections", "draft:invoices"],
  accountant: ["view:financials", "sync:data", "use:ai", "edit:forecast", "manage:collections", "draft:invoices"],
  viewer: ["view:financials", "use:ai"],
};

export function getRequestContext(): RequestContext {
  return { tenantId: "local", userId: "local-owner", role: "owner" };
}

export function can(ctx: RequestContext, action: Action): boolean {
  return ROLE_PERMISSIONS[ctx.role].includes(action);
}

export class ForbiddenError extends Error {
  constructor(action: Action) {
    super(`Not permitted: ${action}`);
  }
}

export function requirePermission(ctx: RequestContext, action: Action): void {
  if (!can(ctx, action)) throw new ForbiddenError(action);
}
