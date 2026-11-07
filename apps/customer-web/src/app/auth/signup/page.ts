import {
  DEFAULT_LOCALE,
  translateMessage,
  type SupportedLocale,
} from "@ideliveryfood/contracts";
import { escapeHtml, renderCustomerAppShellHtml } from "../../layout.js";

export interface CustomerAuthSignUpScreenModel {
  title: string;
  emailLabel: string;
  submitLabel: string;
  locale: SupportedLocale;
  supabaseSignUpEndpoint: string;
}

export function buildCustomerAuthSignUpScreenModel(params: {
  locale?: SupportedLocale;
  supabaseUrl: string;
}): CustomerAuthSignUpScreenModel {
  const locale = params.locale ?? DEFAULT_LOCALE;
  return {
    title: translateMessage("auth.sign_up.title", locale),
    emailLabel: translateMessage("auth.sign_in.email_label", locale),
    submitLabel: translateMessage("auth.sign_in.submit", locale),
    locale,
    supabaseSignUpEndpoint: `${params.supabaseUrl.replace(/\/+$/, "")}/auth/v1/signup`,
  };
}

export function renderCustomerAuthSignUpHtml(
  model: CustomerAuthSignUpScreenModel
): string {
  const isPt = model.locale === "pt-BR";
  const mainContentHtml = `
    <section class="card" aria-labelledby="auth-signup-heading">
      <h1 id="auth-signup-heading">${escapeHtml(model.title)}</h1>
      <form method="POST" action="${escapeHtml(model.supabaseSignUpEndpoint)}" aria-label="${escapeHtml(model.title)}">
        <div>
          <label for="signup-name">${isPt ? "Nome completo" : "Full name"}</label><br/>
          <input id="signup-name" name="fullName" type="text" autocomplete="name" required />
        </div>
        <div style="margin-top:0.75rem;">
          <label for="signup-email">${escapeHtml(model.emailLabel)}</label><br/>
          <input id="signup-email" name="email" type="email" autocomplete="email" required />
        </div>
        <div style="margin-top:0.75rem;">
          <label for="signup-password">${isPt ? "Senha" : "Password"}</label><br/>
          <input id="signup-password" name="password" type="password" autocomplete="new-password" minlength="8" required />
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
    activePath: "/auth/signup",
    mainContentHtml,
  });
}
