import {
  DEFAULT_LOCALE,
  translateMessage,
  type SupportedLocale,
} from "@ideliveryfood/contracts";
import { escapeHtml, renderCustomerAppShellHtml } from "../../layout.js";

export interface CustomerAuthSignInScreenModel {
  title: string;
  emailLabel: string;
  submitLabel: string;
  locale: SupportedLocale;
  supabaseAuthEndpoint: string;
}

export function buildCustomerAuthSignInScreenModel(params: {
  locale?: SupportedLocale;
  supabaseUrl: string;
}): CustomerAuthSignInScreenModel {
  const locale = params.locale ?? DEFAULT_LOCALE;
  return {
    title: translateMessage("auth.sign_in.title", locale),
    emailLabel: translateMessage("auth.sign_in.email_label", locale),
    submitLabel: translateMessage("auth.sign_in.submit", locale),
    locale,
    supabaseAuthEndpoint: `${params.supabaseUrl.replace(/\/+$/, "")}/auth/v1/token?grant_type=password`,
  };
}

export function renderCustomerAuthSignInHtml(
  model: CustomerAuthSignInScreenModel
): string {
  const isPt = model.locale === "pt-BR";
  const mainContentHtml = `
    <section class="card" aria-labelledby="auth-login-heading">
      <h1 id="auth-login-heading">${escapeHtml(model.title)}</h1>
      <form method="POST" action="${escapeHtml(model.supabaseAuthEndpoint)}" aria-label="${escapeHtml(model.title)}">
        <div>
          <label for="login-email">${escapeHtml(model.emailLabel)}</label><br/>
          <input id="login-email" name="email" type="email" autocomplete="email" required />
        </div>
        <div style="margin-top:0.75rem;">
          <label for="login-password">${isPt ? "Senha" : "Password"}</label><br/>
          <input id="login-password" name="password" type="password" autocomplete="current-password" required />
        </div>
        <div style="margin-top:1rem;">
          <button type="submit">${escapeHtml(model.submitLabel)}</button>
        </div>
      </form>
      <p style="margin-top:1rem;">
        <a href="/auth/signup?locale=${escapeHtml(model.locale)}" class="nav-link">${escapeHtml(translateMessage("auth.sign_up.title", model.locale))}</a>
        <a href="/auth/recover?locale=${escapeHtml(model.locale)}" class="nav-link">${escapeHtml(translateMessage("auth.recover.title", model.locale))}</a>
      </p>
    </section>
  `;
  return renderCustomerAppShellHtml({
    locale: model.locale,
    pageTitle: model.title,
    activePath: "/auth/login",
    mainContentHtml,
  });
}
