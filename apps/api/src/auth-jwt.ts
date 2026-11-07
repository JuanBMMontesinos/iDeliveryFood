import crypto from "node:crypto";
import type http from "node:http";
import type { AuthenticatedActorProfileContract } from "@ideliveryfood/contracts";
import type { ApiDataRepository } from "./index.js";

export interface VerifiedSupabaseJwtClaims {
  sub: string;
  aal: "aal1" | "aal2";
  exp: number;
  iat?: number;
  email?: string;
  role?: string;
}

function base64UrlEncode(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function base64UrlDecodeToBuffer(input: string): Buffer {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const padLen = (4 - (padded.length % 4)) % 4;
  return Buffer.from(padded + "=".repeat(padLen), "base64");
}

/**
 * Signs a standard HS256 JWT compatible with Supabase Auth claims.
 */
export function signSupabaseHs256Jwt(
  claims: VerifiedSupabaseJwtClaims,
  jwtSecret: string
): string {
  if (!jwtSecret || jwtSecret.trim().length < 16) {
    throw new Error("AUTH_JWT_SECRET_INVALID: JWT secret must be at least 16 characters.");
  }
  const headerSegment = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payloadSegment = base64UrlEncode(JSON.stringify(claims));
  const signingInput = `${headerSegment}.${payloadSegment}`;
  const signature = crypto
    .createHmac("sha256", jwtSecret)
    .update(signingInput)
    .digest();
  return `${signingInput}.${base64UrlEncode(signature)}`;
}

/**
 * Cryptographically verifies a Supabase Auth HS256 Bearer JWT, checking signature,
 * expiration (exp), subject UUID (sub), and Authenticator Assurance Level (aal1/aal2).
 */
export function verifySupabaseHs256Jwt(params: {
  token: string;
  jwtSecret: string;
  nowSeconds?: number;
}): VerifiedSupabaseJwtClaims {
  const { token, jwtSecret } = params;
  const nowSeconds = params.nowSeconds ?? Math.floor(Date.now() / 1000);

  if (!jwtSecret || jwtSecret.trim().length < 16) {
    throw new Error("AUTH_JWT_MISCONFIGURED: SUPABASE_JWT_SECRET is not configured on server.");
  }

  const parts = token.trim().split(".");
  if (parts.length !== 3) {
    throw new Error("AUTH_JWT_MALFORMED: Bearer token must contain 3 segments.");
  }

  const [headerSeg, payloadSeg, sigSeg] = parts as [string, string, string];
  let headerObj: { alg?: string; typ?: string };
  try {
    headerObj = JSON.parse(base64UrlDecodeToBuffer(headerSeg).toString("utf8")) as {
      alg?: string;
      typ?: string;
    };
  } catch {
    throw new Error("AUTH_JWT_MALFORMED: Unable to decode JWT header.");
  }

  if (headerObj.alg !== "HS256") {
    throw new Error(`AUTH_JWT_UNSUPPORTED_ALG: Expected HS256, received ${String(headerObj.alg)}.`);
  }

  const signingInput = `${headerSeg}.${payloadSeg}`;
  const expectedSig = crypto
    .createHmac("sha256", jwtSecret)
    .update(signingInput)
    .digest();
  const actualSig = base64UrlDecodeToBuffer(sigSeg);

  if (
    expectedSig.length !== actualSig.length ||
    !crypto.timingSafeEqual(expectedSig, actualSig)
  ) {
    throw new Error("AUTH_JWT_INVALID_SIGNATURE: Token signature verification failed.");
  }

  let payloadObj: Record<string, unknown>;
  try {
    payloadObj = JSON.parse(base64UrlDecodeToBuffer(payloadSeg).toString("utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    throw new Error("AUTH_JWT_MALFORMED: Unable to decode JWT payload.");
  }

  const exp = Number(payloadObj.exp ?? 0);
  if (!Number.isFinite(exp) || exp <= nowSeconds) {
    throw new Error("AUTH_JWT_EXPIRED: Bearer token has expired.");
  }

  const sub = String(payloadObj.sub ?? "").trim();
  if (!sub || sub.length < 8) {
    throw new Error("AUTH_JWT_INVALID_SUB: Missing subject claim (sub).");
  }

  const rawAal = String(payloadObj.aal ?? "aal1");
  const aal: "aal1" | "aal2" = rawAal === "aal2" ? "aal2" : "aal1";

  return {
    sub,
    aal,
    exp,
    ...(typeof payloadObj.iat === "number" ? { iat: payloadObj.iat } : {}),
    ...(typeof payloadObj.email === "string" ? { email: payloadObj.email } : {}),
    ...(typeof payloadObj.role === "string" ? { role: payloadObj.role } : {}),
  };
}

/**
 * Resolves the authenticated actor for a request:
 * 1. If `Authorization: Bearer <jwt>` is present, cryptographically verifies the JWT
 *    and loads the actor profile + RBAC scopes from the repository.
 * 2. If `X-Actor-Id` header is present, only accepts it when test actor headers are
 *    explicitly allowed (never in production or when ALLOW_TEST_ACTOR_HEADERS=false).
 */
export async function resolveRequestActor(params: {
  req: http.IncomingMessage;
  repository: ApiDataRepository;
  env: Record<string, string | undefined>;
  allowTestActorHeaders?: boolean;
}): Promise<{
  actor: AuthenticatedActorProfileContract | null;
  authErrorCode?: string;
  authErrorMessage?: string;
}> {
  const { req, repository, env } = params;
  const authHeader = req.headers.authorization;

  if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
    const rawToken = authHeader.slice(7).trim();
    const jwtSecret = env.SUPABASE_JWT_SECRET ?? "";
    try {
      const claims = verifySupabaseHs256Jwt({ token: rawToken, jwtSecret });
      const actor = await repository.getActorById(claims.sub, claims.aal);
      if (!actor || actor.status !== "ACTIVE") {
        return {
          actor: null,
          authErrorCode: "AUTH_ACTOR_INACTIVE_OR_NOT_FOUND",
          authErrorMessage: "Authenticated subject does not have an active profile.",
        };
      }
      return { actor };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Invalid Bearer token";
      const code = msg.split(":")[0] ?? "AUTH_JWT_INVALID";
      return {
        actor: null,
        authErrorCode: code,
        authErrorMessage: msg,
      };
    }
  }

  const appEnv = (env.APP_ENV ?? env.NODE_ENV ?? "development").toLowerCase();
  const allowHeaders =
    params.allowTestActorHeaders !== undefined
      ? params.allowTestActorHeaders
      : appEnv !== "production" && env.ALLOW_TEST_ACTOR_HEADERS !== "false";

  const actorId = req.headers["x-actor-id"] as string | undefined;
  if (actorId) {
    if (!allowHeaders) {
      return {
        actor: null,
        authErrorCode: "AUTH_BEARER_JWT_REQUIRED",
        authErrorMessage:
          "Raw X-Actor-Id headers are forbidden in production; a verified Bearer JWT is required.",
      };
    }
    const actorAal = (req.headers["x-actor-aal"] as "aal1" | "aal2" | undefined) ?? "aal1";
    const actor = await repository.getActorById(actorId, actorAal);
    return { actor };
  }

  return { actor: null };
}
