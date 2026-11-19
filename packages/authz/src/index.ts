import crypto from "node:crypto";
import type {
  AuthenticatedActorProfileContract,
  PartnerRole,
  StaffRole,
} from "@ideliveryfood/contracts";

export interface AuthorizationDecision {
  allowed: boolean;
  reasonCode:
    | "ALLOWED"
    | "DENIED_ACCOUNT_INACTIVE"
    | "DENIED_MFA_STEP_UP_REQUIRED"
    | "DENIED_TENANT_SCOPE_MISMATCH"
    | "DENIED_ROLE_INSUFFICIENT";
}

/**
 * Strips any untrusted role/scope claims from client-writable user_metadata so
 * authorization is exclusively derived from server tables (organization_members & staff_scopes).
 */
export function sanitizeClientUserMetadata(
  rawUserMetadata: Record<string, unknown> | null | undefined
): Record<string, unknown> {
  if (!rawUserMetadata || typeof rawUserMetadata !== "object") {
    return {};
  }

  const forbiddenClaims = new Set([
    "role",
    "roles",
    "staff_role",
    "partner_role",
    "is_admin",
    "is_super_admin",
    "organization_id",
    "store_id",
    "mfa_enforced",
    "aal",
    "permissions",
  ]);

  const clean: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(rawUserMetadata)) {
    if (!forbiddenClaims.has(key.toLowerCase())) {
      clean[key] = val;
    }
  }
  return clean;
}

/**
 * Evaluates partner access to an organization or store resource (RBAC + Multi-Tenant ABAC).
 */
export function authorizePartnerScope(params: {
  actor: AuthenticatedActorProfileContract;
  organizationId: string;
  storeId?: string | null;
  allowedRoles: readonly PartnerRole[];
  requireMfaAal2?: boolean;
}): AuthorizationDecision {
  if (params.actor.status !== "ACTIVE") {
    return { allowed: false, reasonCode: "DENIED_ACCOUNT_INACTIVE" };
  }

  if ((params.requireMfaAal2 || params.actor.mfaEnforced) && params.actor.aal !== "aal2") {
    return { allowed: false, reasonCode: "DENIED_MFA_STEP_UP_REQUIRED" };
  }

  const orgMatches = params.actor.organizationMemberships.filter(
    (m) => m.organizationId === params.organizationId
  );

  if (orgMatches.length === 0) {
    return { allowed: false, reasonCode: "DENIED_TENANT_SCOPE_MISMATCH" };
  }

  const scopedMatches = orgMatches.filter((m) => {
    if (!params.storeId) return true;
    return m.storeId === null || m.storeId === params.storeId;
  });

  if (scopedMatches.length === 0) {
    return { allowed: false, reasonCode: "DENIED_TENANT_SCOPE_MISMATCH" };
  }

  const hasRole = scopedMatches.some((m) => params.allowedRoles.includes(m.role));
  if (!hasRole) {
    return { allowed: false, reasonCode: "DENIED_ROLE_INSUFFICIENT" };
  }

  return { allowed: true, reasonCode: "ALLOWED" };
}

/**
 * Evaluates internal platform staff access, enforcing MFA aal2 and financial/regional limits.
 */
export function authorizeStaffAction(params: {
  actor: AuthenticatedActorProfileContract;
  allowedRoles: readonly StaffRole[];
  requireMfaAal2?: boolean;
  regionCode?: string | null;
  refundAmountCents?: number;
}): AuthorizationDecision {
  if (params.actor.status !== "ACTIVE") {
    return { allowed: false, reasonCode: "DENIED_ACCOUNT_INACTIVE" };
  }

  const matchingScopes = params.actor.staffScopes.filter((s) =>
    params.allowedRoles.includes(s.role)
  );

  if (matchingScopes.length === 0) {
    return { allowed: false, reasonCode: "DENIED_ROLE_INSUFFICIENT" };
  }

  const requiresMfa =
    params.requireMfaAal2 === true ||
    params.actor.mfaEnforced ||
    matchingScopes.some((s) => s.requiresMfa);

  if (requiresMfa && params.actor.aal !== "aal2") {
    return { allowed: false, reasonCode: "DENIED_MFA_STEP_UP_REQUIRED" };
  }

  const abacSatisfied = matchingScopes.some((s) => {
    if (params.regionCode && s.regionCode !== null && s.regionCode !== params.regionCode) {
      return false;
    }
    if (
      params.refundAmountCents !== undefined &&
      params.refundAmountCents > s.maxRefundApprovalCents
    ) {
      return false;
    }
    return true;
  });

  if (!abacSatisfied) {
    return { allowed: false, reasonCode: "DENIED_TENANT_SCOPE_MISMATCH" };
  }

  return { allowed: true, reasonCode: "ALLOWED" };
}

/**
 * Hashes an invitation token with SHA-256 so raw tokens are never stored in the database.
 */
export function hashInvitationToken(rawToken: string): string {
  if (!rawToken || rawToken.trim().length < 16) {
    throw new Error("INVALID_INVITATION_TOKEN: Token must be at least 16 characters.");
  }
  return crypto.createHash("sha256").update(rawToken.trim(), "utf8").digest("hex");
}

export interface StoredInvitationRecord {
  id: string;
  email: string;
  tokenHash: string;
  expiresAtIso: string;
  consumedAtIso: string | null;
}

export function validateInvitationAcceptance(params: {
  rawToken: string;
  actorEmail: string;
  invitation: StoredInvitationRecord;
  now?: Date;
}): { valid: boolean; reasonCode: "VALID" | "TOKEN_MISMATCH" | "ALREADY_CONSUMED" | "EXPIRED" | "EMAIL_MISMATCH" } {
  const now = params.now ?? new Date();
  const computedHash = hashInvitationToken(params.rawToken);

  if (computedHash !== params.invitation.tokenHash) {
    return { valid: false, reasonCode: "TOKEN_MISMATCH" };
  }

  if (params.invitation.consumedAtIso !== null) {
    return { valid: false, reasonCode: "ALREADY_CONSUMED" };
  }

  if (new Date(params.invitation.expiresAtIso).getTime() <= now.getTime()) {
    return { valid: false, reasonCode: "EXPIRED" };
  }

  if (params.invitation.email.trim().toLowerCase() !== params.actorEmail.trim().toLowerCase()) {
    return { valid: false, reasonCode: "EMAIL_MISMATCH" };
  }

  return { valid: true, reasonCode: "VALID" };
}

const ALLOWED_REDIRECT_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "app.ideliveryfood.com.br",
  "partner.ideliveryfood.com.br",
  "admin.ideliveryfood.com.br",
]);

const ALLOWED_CUSTOM_SCHEMES = new Set([
  "ideliveryfood-customer:",
  "ideliveryfood-courier:",
]);

/**
 * Validates OAuth / magic-link / deep-link redirect URIs against an explicit allowlist
 * to prevent open-redirect vulnerabilities across Web, Android, and iOS.
 */
export function isAllowedAuthRedirectUri(redirectUri: string): boolean {
  try {
    const parsed = new URL(redirectUri);
    if (ALLOWED_CUSTOM_SCHEMES.has(parsed.protocol)) {
      return parsed.hostname === "auth-callback";
    }
    if (parsed.protocol === "https:" || parsed.protocol === "http:") {
      if (parsed.protocol === "http:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
        return false;
      }
      return ALLOWED_REDIRECT_HOSTS.has(parsed.hostname);
    }
    return false;
  } catch {
    return false;
  }
}

export const ALL_PLATFORM_ROLES = [
  "customer",
  "courier",
  "partner_owner",
  "partner_manager",
  "partner_operator",
  "partner_catalog",
  "partner_finance",
  "operations",
  "logistics",
  "support",
  "finance",
  "commercial",
  "marketing",
  "risk_compliance",
  "auditor_privacy",
  "tech_admin",
  "fleet_operator",
] as const;

export type PlatformRoleName = (typeof ALL_PLATFORM_ROLES)[number];

export type PlatformCapability =
  | "CUSTOMER_PLACE_ORDER"
  | "COURIER_ACCEPT_OFFER"
  | "PARTNER_KDS_OPERATIONS"
  | "PARTNER_CATALOG_EDIT"
  | "PARTNER_FINANCE_VIEW"
  | "PARTNER_BANK_CHANGE_REQUEST"
  | "STAFF_OPS_CADASTRE"
  | "STAFF_LOGISTICS_DISPATCH"
  | "STAFF_SUPPORT_TICKET"
  | "STAFF_FINANCE_SETTLEMENT"
  | "STAFF_COMMERCIAL_CONTRACT"
  | "STAFF_MARKETING_PROMO"
  | "STAFF_RISK_HUMAN_REVIEW"
  | "STAFF_PRIVACY_LGPD_AUDIT"
  | "STAFF_IAM_GRANT_SCOPE"
  | "FLEET_OPERATOR_VIEW_COURIERS";

const ROLE_CAPABILITY_MATRIX: Readonly<
  Record<
    PlatformRoleName,
    {
      capabilities: ReadonlySet<PlatformCapability>;
      requiresMfaAal2ForMutations: boolean;
    }
  >
> = {
  customer: {
    capabilities: new Set(["CUSTOMER_PLACE_ORDER"]),
    requiresMfaAal2ForMutations: false,
  },
  courier: {
    capabilities: new Set(["COURIER_ACCEPT_OFFER"]),
    requiresMfaAal2ForMutations: false,
  },
  partner_owner: {
    capabilities: new Set([
      "PARTNER_KDS_OPERATIONS",
      "PARTNER_CATALOG_EDIT",
      "PARTNER_FINANCE_VIEW",
      "PARTNER_BANK_CHANGE_REQUEST",
    ]),
    requiresMfaAal2ForMutations: true,
  },
  partner_manager: {
    capabilities: new Set(["PARTNER_KDS_OPERATIONS", "PARTNER_CATALOG_EDIT"]),
    requiresMfaAal2ForMutations: false,
  },
  partner_operator: {
    capabilities: new Set(["PARTNER_KDS_OPERATIONS"]),
    requiresMfaAal2ForMutations: false,
  },
  partner_catalog: {
    capabilities: new Set(["PARTNER_CATALOG_EDIT"]),
    requiresMfaAal2ForMutations: false,
  },
  partner_finance: {
    capabilities: new Set(["PARTNER_FINANCE_VIEW"]),
    requiresMfaAal2ForMutations: true,
  },
  operations: {
    capabilities: new Set([
      "STAFF_OPS_CADASTRE",
      "STAFF_LOGISTICS_DISPATCH",
      "STAFF_SUPPORT_TICKET",
    ]),
    requiresMfaAal2ForMutations: true,
  },
  logistics: {
    capabilities: new Set(["STAFF_LOGISTICS_DISPATCH"]),
    requiresMfaAal2ForMutations: true,
  },
  support: {
    capabilities: new Set(["STAFF_SUPPORT_TICKET"]),
    requiresMfaAal2ForMutations: false,
  },
  finance: {
    capabilities: new Set(["STAFF_FINANCE_SETTLEMENT"]),
    requiresMfaAal2ForMutations: true,
  },
  commercial: {
    capabilities: new Set(["STAFF_COMMERCIAL_CONTRACT"]),
    requiresMfaAal2ForMutations: false,
  },
  marketing: {
    capabilities: new Set(["STAFF_MARKETING_PROMO"]),
    requiresMfaAal2ForMutations: false,
  },
  risk_compliance: {
    capabilities: new Set(["STAFF_RISK_HUMAN_REVIEW", "STAFF_PRIVACY_LGPD_AUDIT"]),
    requiresMfaAal2ForMutations: true,
  },
  auditor_privacy: {
    capabilities: new Set(["STAFF_PRIVACY_LGPD_AUDIT"]),
    requiresMfaAal2ForMutations: true,
  },
  tech_admin: {
    capabilities: new Set([
      "STAFF_OPS_CADASTRE",
      "STAFF_LOGISTICS_DISPATCH",
      "STAFF_SUPPORT_TICKET",
      "STAFF_FINANCE_SETTLEMENT",
      "STAFF_COMMERCIAL_CONTRACT",
      "STAFF_MARKETING_PROMO",
      "STAFF_RISK_HUMAN_REVIEW",
      "STAFF_PRIVACY_LGPD_AUDIT",
      "STAFF_IAM_GRANT_SCOPE",
    ]),
    requiresMfaAal2ForMutations: true,
  },
  fleet_operator: {
    capabilities: new Set(["FLEET_OPERATOR_VIEW_COURIERS"]),
    requiresMfaAal2ForMutations: false,
  },
};

/**
 * Evaluates capability authorization across all 17 canonical platform roles,
 * enforcing MFA `aal2` on privileged roles and anti-self-elevation on `STAFF_IAM_GRANT_SCOPE` (M01/M02/M24).
 */
export function evaluateCanonicalRoleCapability(params: {
  role: PlatformRoleName;
  capability: PlatformCapability;
  actorId: string;
  targetUserId?: string | null;
  aal: "aal1" | "aal2";
  isMutation?: boolean;
}): {
  allowed: boolean;
  reasonCode:
    | "ALLOWED"
    | "DENIED_ROLE_INSUFFICIENT"
    | "DENIED_MFA_STEP_UP_REQUIRED"
    | "DENIED_SELF_ELEVATION_FORBIDDEN";
} {
  const def = ROLE_CAPABILITY_MATRIX[params.role];
  if (!def || !def.capabilities.has(params.capability)) {
    return { allowed: false, reasonCode: "DENIED_ROLE_INSUFFICIENT" };
  }

  if (
    params.capability === "STAFF_IAM_GRANT_SCOPE" &&
    params.targetUserId &&
    params.targetUserId === params.actorId
  ) {
    return { allowed: false, reasonCode: "DENIED_SELF_ELEVATION_FORBIDDEN" };
  }

  const requiresMfa =
    (params.isMutation ?? true) &&
    (def.requiresMfaAal2ForMutations ||
      params.capability === "PARTNER_BANK_CHANGE_REQUEST" ||
      params.capability === "STAFF_FINANCE_SETTLEMENT" ||
      params.capability === "STAFF_IAM_GRANT_SCOPE" ||
      params.capability === "STAFF_RISK_HUMAN_REVIEW");

  if (requiresMfa && params.aal !== "aal2") {
    return { allowed: false, reasonCode: "DENIED_MFA_STEP_UP_REQUIRED" };
  }

  return { allowed: true, reasonCode: "ALLOWED" };
}

