import type { IDeliveryApiClient } from "@ideliveryfood/api-client";
import {
  DEFAULT_LOCALE,
  type AuthenticatedActorProfileContract,
  type PartnerRole,
  type SupportedLocale,
} from "@ideliveryfood/contracts";
import { escapeHtml, renderPartnerLayoutHtml } from "../layout.js";

export interface PartnerTeamMemberRow {
  userId: string;
  role: PartnerRole;
  storeId: string | null;
}

export interface PartnerTeamScreenModel {
  locale: SupportedLocale;
  organizationId: string;
  actor: AuthenticatedActorProfileContract;
  members: readonly PartnerTeamMemberRow[];
}

export async function loadPartnerTeamScreen(params: {
  apiClient: IDeliveryApiClient;
  organizationId: string;
  locale?: SupportedLocale;
}): Promise<PartnerTeamScreenModel> {
  const [meRes, membersRes] = await Promise.all([
    params.apiClient.getMe(),
    params.apiClient.listOrganizationMembers(params.organizationId),
  ]);

  const locale = params.locale ?? meRes.data.preferredLocale ?? DEFAULT_LOCALE;
  return {
    locale,
    organizationId: params.organizationId,
    actor: meRes.data,
    members: membersRes.data,
  };
}

export function renderPartnerTeamHtml(model: PartnerTeamScreenModel): string {
  const { locale, actor, members, organizationId } = model;
  const isPt = locale === "pt-BR";

  const rowsHtml = members
    .map(
      (m) => `
      <tr data-testid="team-member-row-${escapeHtml(m.userId)}">
        <td><code>${escapeHtml(m.userId)}</code></td>
        <td><span class="badge">${escapeHtml(m.role)}</span></td>
        <td>${m.storeId ? `<code>${escapeHtml(m.storeId)}</code>` : isPt ? "Organização Inteira" : "Entire Organization"}</td>
      </tr>
    `
    )
    .join("");

  const bodyHtml = `
    <section aria-labelledby="team-heading">
      <div class="card">
        <h1 id="team-heading" style="margin-top:0;">
          ${isPt ? "Equipe da Organização & Papéis RBAC (M03/M07)" : "Organization Team & RBAC Roles (M03/M07)"}
        </h1>
        <p>
          ${
            isPt
              ? `Organização: ${organizationId}. Convites de uso único expiram automaticamente e exigem MFA aal2 para partner_owner.`
              : `Organization: ${organizationId}. Single-use invitations expire automatically and require MFA aal2 for partner_owner.`
          }
        </p>

        <table class="data-table" data-testid="team-members-table">
          <thead>
            <tr>
              <th>User ID</th>
              <th>${isPt ? "Papel (Role)" : "Role"}</th>
              <th>${isPt ? "Escopo de Unidade" : "Store Scope"}</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </div>
    </section>
  `;

  return renderPartnerLayoutHtml({
    title: isPt ? "Gestão de Equipe" : "Team Management",
    locale,
    activeRoute: "/team",
    actorSummary: `${actor.fullName} (${actor.email})`,
    bodyHtml,
  });
}
