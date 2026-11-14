import assert from "node:assert/strict";
import fs from "node:fs";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  createApiServer,
  createSupabasePostgresRepository,
  signSupabaseHs256Jwt,
  type SupabasePostgresRepositoryInstance,
} from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const candidates = [
    path.resolve(__dirname, "../../../.env"),
    path.resolve(__dirname, "../../../../.env"),
    path.resolve(process.cwd(), ".env"),
  ];
  for (const envPath of candidates) {
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, "utf8");
      const match = content.match(/^DATABASE_URL=(.+)$/m);
      if (match?.[1]) {
        return match[1].trim().replace(/^["']|["']$/g, "");
      }
    }
  }
  throw new Error("DATABASE_URL not found in environment or .env");
}

describe("Fase N (M17) — Live Supabase Support Cases, SLA, Internal Note Stripping & Refund Authority Tests", () => {
  const TEST_JWT_SECRET = "test_supabase_jwt_secret_phase_n_support_32chars!!";

  const ALICE_CUSTOMER_ID = "00000000-0000-4000-8000-000000000001";
  const BRUNO_CUSTOMER_ID = "00000000-0000-4000-8000-000000000002";
  const HELENA_PARTNER_ID = "00000000-0000-4000-8000-000000000010";
  const MARINA_OPS_SUPPORT_ID = "00000000-0000-4000-8000-000000000090";
  const ROBERTO_FINANCE_ID = "00000000-0000-4000-8000-000000000091";
  const TECH_ADMIN_ID = "00000000-0000-4000-8000-000000000099";

  const SEEDED_STORE_ID = "00000000-0000-4000-8000-000000000201";
  const SEEDED_ORG_ID = "00000000-0000-4000-8000-000000000101";
  const SEEDED_TASK_ID = "00000000-0000-4000-8000-000000001201";
  const SEEDED_ORDER_ID = "00000000-0000-4000-8000-000000001001";

  let repo: SupabasePostgresRepositoryInstance;
  let server: ReturnType<typeof createApiServer>;
  let baseUrl = "";
  const createdCaseIds: string[] = [];
  const createdActionRequestIds: string[] = [];
  const createdRefundIds: string[] = [];

  function tokenFor(sub: string, email: string, aal: "aal1" | "aal2" = "aal1"): string {
    return signSupabaseHs256Jwt(
      {
        sub,
        email,
        aal,
        exp: Math.floor(Date.now() / 1000) + 3600,
      },
      TEST_JWT_SECRET
    );
  }

  const aliceToken = tokenFor(ALICE_CUSTOMER_ID, "customer.alice@test.ideliveryfood.invalid", "aal1");
  const brunoToken = tokenFor(BRUNO_CUSTOMER_ID, "customer.bruno@test.ideliveryfood.invalid", "aal1");
  const helenaToken = tokenFor(HELENA_PARTNER_ID, "owner.paulista@test.ideliveryfood.invalid", "aal1");
  const marinaTokenAal2 = tokenFor(MARINA_OPS_SUPPORT_ID, "staff.ops@test.ideliveryfood.invalid", "aal2");
  const robertoTokenAal1 = tokenFor(ROBERTO_FINANCE_ID, "staff.finance@test.ideliveryfood.invalid", "aal1");
  const robertoTokenAal2 = tokenFor(ROBERTO_FINANCE_ID, "staff.finance@test.ideliveryfood.invalid", "aal2");
  const techAdminTokenAal2 = tokenFor(TECH_ADMIN_ID, "staff.admin@test.ideliveryfood.invalid", "aal2");

  before(async () => {
    repo = createSupabasePostgresRepository({
      connectionString: loadDatabaseUrl(),
      isTestData: true,
    });

    // Ensure only the seeded refund (00000000-0000-4000-8000-000000001712) is on SEEDED_ORDER_ID
    await repo.pool.query(
      `DELETE FROM public.refunds WHERE order_id = $1 AND id <> '00000000-0000-4000-8000-000000001712'`,
      [SEEDED_ORDER_ID]
    );
    await repo.pool.query(
      `UPDATE public.orders SET payment_status = 'CAPTURED' WHERE id = $1`,
      [SEEDED_ORDER_ID]
    );

    server = createApiServer({
      repository: repo,
      env: {
        SUPABASE_JWT_SECRET: TEST_JWT_SECRET,
      },
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const port = (server.address() as AddressInfo).port;
    baseUrl = `http://127.0.0.1:${port}/v1`;
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (createdRefundIds.length > 0) {
      await repo.pool.query(`DELETE FROM public.refunds WHERE id = ANY($1::uuid[])`, [
        createdRefundIds,
      ]);
    }
    if (createdActionRequestIds.length > 0) {
      await repo.pool.query(
        `DELETE FROM public.support_action_requests WHERE id = ANY($1::uuid[])`,
        [createdActionRequestIds]
      );
    }
    if (createdCaseIds.length > 0) {
      await repo.pool.query(`DELETE FROM public.support_attachments WHERE case_id = ANY($1::uuid[])`, [
        createdCaseIds,
      ]);
      await repo.pool.query(`DELETE FROM public.support_messages WHERE case_id = ANY($1::uuid[])`, [
        createdCaseIds,
      ]);
      await repo.pool.query(`DELETE FROM public.support_cases WHERE id = ANY($1::uuid[])`, [
        createdCaseIds,
      ]);
    }
    await repo.pool.query(
      `UPDATE public.orders SET payment_status = 'CAPTURED' WHERE id = $1`,
      [SEEDED_ORDER_ID]
    );
    await repo.close();
  });

  it("1. creates a support case with deterministic SLA and upgrades ROUTE_INCIDENT to CRITICAL_IN_ROUTE", async () => {
    const createRes = await fetch(`${baseUrl}/support/cases`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${aliceToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        orderId: SEEDED_ORDER_ID,
        deliveryTaskId: SEEDED_TASK_ID,
        category: "ROUTE_INCIDENT",
        priority: "LOW",
        subject: "Courier reported flat tire during delivery",
        initialMessage: "My order is stuck in route, please help.",
      }),
    });

    const rawText = await createRes.text();
    assert.equal(createRes.status, 201, `Unexpected status ${createRes.status}: ${rawText}`);
    const body = JSON.parse(rawText) as {
      data: {
        id: string;
        priority: string;
        status: string;
        organizationId: string;
        storeId: string;
        deliveryTaskId: string;
        slaDueAtIso: string;
        createdAtIso: string;
      };
    };

    createdCaseIds.push(body.data.id);
    assert.equal(body.data.priority, "CRITICAL_IN_ROUTE");
    assert.equal(body.data.status, "OPEN");
    assert.equal(body.data.organizationId, SEEDED_ORG_ID);
    assert.equal(body.data.storeId, SEEDED_STORE_ID);
    assert.equal(body.data.deliveryTaskId, SEEDED_TASK_ID);

    const slaDiffMinutes = Math.round(
      (Date.parse(body.data.slaDueAtIso) - Date.parse(body.data.createdAtIso)) / 60000
    );
    assert.equal(slaDiffMinutes, 15);
  });

  it("2. enforces strict internal staff note & attachment visibility and strips internal notes for CUSTOMER and PARTNER actors", async () => {
    const caseId = createdCaseIds[0]!;

    // Customer Alice cannot author an internal note
    const forbiddenInternalRes = await fetch(`${baseUrl}/support/cases/${caseId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${aliceToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        body: "Customer trying to spoof internal note",
        isInternalNote: true,
      }),
    });
    assert.equal(forbiddenInternalRes.status, 403);
    const forbiddenErr = (await forbiddenInternalRes.json()) as { error: { code: string } };
    assert.equal(forbiddenErr.error.code, "FORBIDDEN_INTERNAL_NOTE");

    // Customer Alice posts a public message + public photo attachment
    const publicMsgRes = await fetch(`${baseUrl}/support/cases/${caseId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${aliceToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        body: "Attaching screenshot of the map showing the stop.",
        isInternalNote: false,
        attachments: [
          {
            objectPath: `cases/${caseId}/customer-map-screenshot.jpg`,
            mimeType: "image/jpeg",
            byteSize: 84210,
            isInternalOnly: false,
          },
        ],
      }),
    });
    assert.equal(publicMsgRes.status, 201);

    // Staff Marina posts an internal-only note + internal-only attachment
    const staffInternalRes = await fetch(`${baseUrl}/support/cases/${caseId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${marinaTokenAal2}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        body: "INTERNAL_STAFF_SECRET: Verified GPS telemetry spike; eligible for instant compensation.",
        isInternalNote: true,
        attachments: [
          {
            objectPath: `cases/${caseId}/internal-telemetry-dump.json`,
            mimeType: "application/json",
            byteSize: 4096,
            isInternalOnly: true,
          },
        ],
      }),
    });
    assert.equal(staffInternalRes.status, 201);

    // 2a. Staff Marina sees ALL messages (including INTERNAL_STAFF_SECRET) and ALL attachments
    const staffDetailRes = await fetch(`${baseUrl}/support/cases/${caseId}`, {
      headers: { Authorization: `Bearer ${marinaTokenAal2}` },
    });
    assert.equal(staffDetailRes.status, 200);
    const staffDetail = (await staffDetailRes.json()) as {
      data: {
        messages: Array<{ body: string; isInternalNote: boolean }>;
        attachments: Array<{ objectPath: string; isInternalOnly: boolean }>;
      };
    };
    assert.equal(
      staffDetail.data.messages.some((m) => m.body.includes("INTERNAL_STAFF_SECRET")),
      true
    );
    assert.equal(
      staffDetail.data.attachments.some((a) =>
        a.objectPath.includes("internal-telemetry-dump.json")
      ),
      true
    );

    // 2b. Customer Alice sees public messages/attachments, and ZERO internal notes/attachments
    const customerDetailRes = await fetch(`${baseUrl}/support/cases/${caseId}`, {
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    assert.equal(customerDetailRes.status, 200);
    const customerDetail = (await customerDetailRes.json()) as {
      data: {
        messages: Array<{ body: string; isInternalNote: boolean }>;
        attachments: Array<{ objectPath: string; isInternalOnly: boolean }>;
      };
    };
    assert.equal(
      customerDetail.data.messages.some(
        (m) => m.isInternalNote || m.body.includes("INTERNAL_STAFF_SECRET")
      ),
      false
    );
    assert.equal(
      customerDetail.data.attachments.some(
        (a) => a.isInternalOnly || a.objectPath.includes("internal-telemetry-dump.json")
      ),
      false
    );

    // 2c. Store Owner Helena (PARTNER of the store) also has internal notes/attachments stripped
    const partnerDetailRes = await fetch(`${baseUrl}/support/cases/${caseId}`, {
      headers: { Authorization: `Bearer ${helenaToken}` },
    });
    assert.equal(partnerDetailRes.status, 200);
    const partnerDetail = (await partnerDetailRes.json()) as {
      data: {
        messages: Array<{ body: string; isInternalNote: boolean }>;
        attachments: Array<{ objectPath: string; isInternalOnly: boolean }>;
      };
    };
    assert.equal(
      partnerDetail.data.messages.some((m) => m.isInternalNote),
      false
    );
    assert.equal(
      partnerDetail.data.attachments.some((a) => a.isInternalOnly),
      false
    );

    // 2d. Unrelated customer Bruno is denied access (403)
    const brunoDetailRes = await fetch(`${baseUrl}/support/cases/${caseId}`, {
      headers: { Authorization: `Bearer ${brunoToken}` },
    });
    assert.equal(brunoDetailRes.status, 403);
  });

  it("3. transitions support case status and auto-approves partial refund within platform_policies threshold (<= 1500 cents)", async () => {
    const caseId = createdCaseIds[0]!;

    // Transition OPEN -> IN_PROGRESS
    const inProgRes = await fetch(`${baseUrl}/support/cases/${caseId}/status`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${marinaTokenAal2}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        status: "IN_PROGRESS",
        reason: "Investigating route incident with courier",
      }),
    });
    assert.equal(inProgRes.status, 200);

    // Request partial refund of 1200 cents (<= 1500 cents limit) -> Auto-approved & case RESOLVED
    const autoRefundRes = await fetch(`${baseUrl}/support/cases/${caseId}/action-requests`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${marinaTokenAal2}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        orderId: SEEDED_ORDER_ID,
        actionType: "PARTIAL_REFUND",
        amountCents: 1200,
        reason: "Delivery delay compensation within L1 automatic authority",
      }),
    });
    assert.equal(autoRefundRes.status, 201);
    const autoData = (await autoRefundRes.json()) as {
      data: {
        autoApproved: boolean;
        autoApproveLimitCents: number;
        actionRequest: { id: string; status: string; amountCents: number };
        supportCase: { status: string };
        refund: { id: string; status: string; amountCents: number } | null;
      };
    };

    createdActionRequestIds.push(autoData.data.actionRequest.id);
    if (autoData.data.refund) {
      createdRefundIds.push(autoData.data.refund.id);
    }

    assert.equal(autoData.data.autoApproved, true);
    assert.equal(autoData.data.autoApproveLimitCents, 1500);
    assert.equal(autoData.data.actionRequest.status, "APPROVED");
    assert.equal(autoData.data.supportCase.status, "RESOLVED");
    assert.ok(autoData.data.refund);
    assert.equal(autoData.data.refund.amountCents, 1200);
    assert.equal(autoData.data.refund.status, "PROCESSED");
  });

  it("4. escalates refund above threshold (> 1500 cents) to PENDING_FINANCE and enforces Finance MFA aal2 + Segregation of Duties", async () => {
    // Open a second support case on SEEDED_ORDER_ID
    const caseRes = await fetch(`${baseUrl}/support/cases`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${aliceToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        orderId: SEEDED_ORDER_ID,
        category: "DAMAGED_ITEMS",
        priority: "HIGH",
        subject: "Main burger arrived crushed",
      }),
    });
    assert.equal(caseRes.status, 201);
    const newCase = (await caseRes.json()) as { data: { id: string } };
    const caseId = newCase.data.id;
    createdCaseIds.push(caseId);

    // 4a. Tech Admin requests 2500 cents (> 1500 cents) -> PENDING_FINANCE + ESCALATED_FINANCE
    const escalateRes = await fetch(`${baseUrl}/support/cases/${caseId}/action-requests`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${techAdminTokenAal2}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        orderId: SEEDED_ORDER_ID,
        actionType: "PARTIAL_REFUND",
        amountCents: 2500,
        reason: "Damaged main item exceeds R$ 15,00 auto-refund ceiling",
      }),
    });
    assert.equal(escalateRes.status, 201);
    const escData = (await escalateRes.json()) as {
      data: {
        autoApproved: boolean;
        actionRequest: { id: string; status: string; amountCents: number };
        supportCase: { status: string };
        refund: null;
      };
    };
    const requestId = escData.data.actionRequest.id;
    createdActionRequestIds.push(requestId);

    assert.equal(escData.data.autoApproved, false);
    assert.equal(escData.data.actionRequest.status, "PENDING_FINANCE");
    assert.equal(escData.data.supportCase.status, "ESCALATED_FINANCE");
    assert.equal(escData.data.refund, null);

    // 4b. Finance Officer Roberto at MFA aal1 is blocked (403 SUPPORT_FINANCE_MFA_AAL2_REQUIRED)
    const aal1Attempt = await fetch(`${baseUrl}/support/action-requests/${requestId}/decide`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${robertoTokenAal1}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        decision: "APPROVED",
        decisionNotes: "Trying to approve without MFA aal2",
      }),
    });
    assert.equal(aal1Attempt.status, 403);
    const aal1Err = (await aal1Attempt.json()) as { error: { code: string } };
    assert.equal(aal1Err.error.code, "SUPPORT_FINANCE_MFA_AAL2_REQUIRED");

    // 4c. Tech Admin attempting to self-approve their own escalated request is blocked (403 SEGREGATION_OF_DUTIES_VIOLATION)
    const selfApproveAttempt = await fetch(
      `${baseUrl}/support/action-requests/${requestId}/decide`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${techAdminTokenAal2}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          decision: "APPROVED",
          decisionNotes: "Attempting to self-approve my own escalated refund request",
        }),
      }
    );
    assert.equal(selfApproveAttempt.status, 403);
    const selfErr = (await selfApproveAttempt.json()) as { error: { code: string } };
    assert.equal(selfErr.error.code, "SEGREGATION_OF_DUTIES_VIOLATION");

    // 4d. Finance Officer Roberto at MFA aal2 (distinct actor) approves the escalated request -> 200 OK
    const approveRes = await fetch(`${baseUrl}/support/action-requests/${requestId}/decide`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${robertoTokenAal2}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        decision: "APPROVED",
        decisionNotes: "Verified photo evidence of crushed burger; approved R$ 25,00 partial refund.",
      }),
    });
    assert.equal(approveRes.status, 200);
    const approvedData = (await approveRes.json()) as {
      data: {
        actionRequest: { status: string; decidedBy: string };
        supportCase: { status: string };
        refund: { id: string; amountCents: number; status: string } | null;
      };
    };

    if (approvedData.data.refund) {
      createdRefundIds.push(approvedData.data.refund.id);
    }

    assert.equal(approvedData.data.actionRequest.status, "APPROVED");
    assert.equal(approvedData.data.actionRequest.decidedBy, ROBERTO_FINANCE_ID);
    assert.equal(approvedData.data.supportCase.status, "RESOLVED");
    assert.ok(approvedData.data.refund);
    assert.equal(approvedData.data.refund.amountCents, 2500);
    assert.equal(approvedData.data.refund.status, "PROCESSED");
  });
});
