import {
  DEFAULT_LOCALE,
  translateMessage,
  type SupportedLocale,
} from "@ideliveryfood/contracts";
import { escapeHtml, renderCustomerAppShellHtml } from "../../layout.js";

export interface CustomerAuthRecoverScreenModel {
  title: string;
  emailLabel: string;
  submitLabel: string;
  locale: SupportedLocale;
  supabaseRecoverEndpoint: string;
}

export function buildCustomerAuthRecoverScreenModel(params: {
  locale?: SupportedLocale;
  supabaseUrl: string;
}): CustomerAuthRecoverScreenModel {
  const locale = params.locale ?? DEFAULT_LOCALE;
  return {
    title: translateMessage("auth.recover.title", locale),
    emailLabel: translateMessage("auth.sign_in.email_label", locale),
    submitLabel: translateMessage("auth.sign_in.submit", locale),
    locale,
    supabaseRecoverEndpoint: `${params.supabaseUrl.replace(/\/+$/, "")}/auth/v1/recover`,
  };
}

export function renderCustomerAuthRecoverHtml(
  model: CustomerAuthRecoverScreenModel
): string {
  const mainContentHtml = `
    <section class="card" aria-labelledby="auth-recover-heading">
      <h1 id="auth-recover-heading">${escapeHtml(model.title)}</h1>
      <form method="POST" action="${escapeHtml(model.supabaseRecoverEndpoint)}" aria-label="${escapeHtml(model.title)}">
        <div>
          <label for="recover-email">${escapeHtml(model.emailLabel)}</label><br/>
          <input id="recover-email" name="email" type="email" autocomplete="email" required />
        </div>
        <div style="margin-top:1rem;">
          <button type="submit">${escapeHtml(model.submitLabel)}</button>
        </div>
      </form>
    </section>
  `;
  return renderCustomerAppShellHtml({
    locale: model.locale,
    pageTitle: model.title,
    activePath: "/auth/recover",
    mainContentHtml,
  });
}
