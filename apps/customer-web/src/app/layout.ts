import {
  DEFAULT_LOCALE,
  translateMessage,
  type SupportedLocale,
} from "@ideliveryfood/contracts";
import {
  buildLanguageSelectorViewModel,
  type LanguageSelectorViewModel,
  type UiScreenStateBanner,
} from "@ideliveryfood/ui-web";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderScreenStateBannerHtml(banner: UiScreenStateBanner | null): string {
  if (!banner) return "";
  return `<div class="ui-state-banner ui-state-${escapeHtml(banner.kind)}" role="${escapeHtml(banner.role)}" aria-live="${escapeHtml(banner.ariaLive)}">${escapeHtml(banner.message)}</div>`;
}

export function renderCustomerAppShellHtml(params: {
  locale?: SupportedLocale;
  pageTitle: string;
  activePath: string;
  banner?: UiScreenStateBanner | null;
  mainContentHtml: string;
}): string {
  const locale = params.locale ?? DEFAULT_LOCALE;
  const selector: LanguageSelectorViewModel = buildLanguageSelectorViewModel(locale);
  const brandName = translateMessage("app.brand.name", locale);
  const brandTagline = translateMessage("app.brand.tagline", locale);

  const navItems =
    locale === "pt-BR"
      ? [
          { href: "/", label: "Descoberta" },
          { href: "/addresses", label: "Endereços" },
          { href: "/cart", label: "Sacola" },
          { href: "/checkout", label: "Checkout" },
          { href: "/profile", label: "Perfil & LGPD" },
          { href: "/auth/login", label: "Entrar" },
        ]
      : [
          { href: "/", label: "Discovery" },
          { href: "/addresses", label: "Addresses" },
          { href: "/cart", label: "Cart" },
          { href: "/checkout", label: "Checkout" },
          { href: "/profile", label: "Profile & LGPD" },
          { href: "/auth/login", label: "Sign In" },
        ];

  const navHtml = navItems
    .map((item) => {
      const isCurrent = params.activePath === item.href;
      return `<a href="${escapeHtml(item.href)}?locale=${escapeHtml(locale)}" class="nav-link${isCurrent ? " active" : ""}"${isCurrent ? ' aria-current="page"' : ""}>${escapeHtml(item.label)}</a>`;
    })
    .join("");

  const optionsHtml = selector.options
    .map(
      (opt) =>
        `<option value="${escapeHtml(opt.code)}"${opt.isSelected ? " selected" : ""}>${escapeHtml(opt.displayLabel)}</option>`
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="${escapeHtml(locale)}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="theme-color" content="#D92D20" />
  <link rel="manifest" href="/manifest.webmanifest" />
  <title>${escapeHtml(params.pageTitle)} | ${escapeHtml(brandName)}</title>
  <style>
    :root {
      --bg-primary: #0F172A;
      --bg-card: #1E293B;
      --text-primary: #F8FAFC;
      --text-muted: #CBD5E1;
      --brand-accent: #F97066;
      --border-subtle: #334155;
      --status-open: #34D399;
      --status-warn: #FBBF24;
      --status-error: #F87171;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background-color: var(--bg-primary);
      color: var(--text-primary);
      line-height: 1.5;
    }
    .skip-link {
      position: absolute;
      left: -9999px;
      top: 0;
      background: #FFFFFF;
      color: #0F172A;
      padding: 0.5rem 1rem;
      z-index: 1000;
    }
    .skip-link:focus { left: 0.5rem; top: 0.5rem; }
    header.site-header {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      padding: 1rem 1.5rem;
      background: var(--bg-card);
      border-bottom: 1px solid var(--border-subtle);
    }
    .brand-title { font-weight: 700; font-size: 1.25rem; color: var(--text-primary); text-decoration: none; }
    .brand-tagline { font-size: 0.875rem; color: var(--text-muted); margin-left: 0.5rem; }
    nav.primary-nav { display: flex; flex-wrap: wrap; gap: 0.75rem; align-items: center; }
    .nav-link {
      color: var(--text-muted);
      text-decoration: none;
      padding: 0.375rem 0.75rem;
      border-radius: 0.375rem;
      border: 1px solid transparent;
    }
    .nav-link[aria-current="page"], .nav-link:hover, .nav-link:focus-visible {
      color: var(--text-primary);
      border-color: var(--brand-accent);
      background: rgba(249, 112, 102, 0.12);
    }
    main#main-content { max-width: 1120px; margin: 0 auto; padding: 1.5rem; }
    .card {
      background: var(--bg-card);
      border: 1px solid var(--border-subtle);
      border-radius: 0.75rem;
      padding: 1.25rem;
      margin-bottom: 1rem;
    }
    .badge {
      display: inline-block;
      padding: 0.2rem 0.6rem;
      border-radius: 999px;
      font-size: 0.75rem;
      font-weight: 600;
      background: rgba(248, 250, 252, 0.1);
      margin-right: 0.4rem;
    }
    .ui-state-banner {
      padding: 1rem;
      border-radius: 0.5rem;
      margin-bottom: 1rem;
      border: 1px solid var(--border-subtle);
      background: rgba(251, 191, 36, 0.12);
    }
    .ui-state-error, .ui-state-forbidden, .ui-state-offline {
      border-color: var(--status-error);
      background: rgba(248, 113, 113, 0.15);
    }
    button, .btn {
      background: #D92D20;
      color: #FFFFFF;
      border: none;
      border-radius: 0.5rem;
      padding: 0.6rem 1rem;
      font-weight: 600;
      cursor: pointer;
    }
    button[disabled] { opacity: 0.5; cursor: not-allowed; }
    input, select, textarea {
      background: #0F172A;
      color: #F8FAFC;
      border: 1px solid var(--border-subtle);
      border-radius: 0.375rem;
      padding: 0.5rem 0.75rem;
    }
  </style>
</head>
<body>
  <a href="#main-content" class="skip-link">${locale === "pt-BR" ? "Pular para o conteúdo principal" : "Skip to main content"}</a>
  <header class="site-header">
    <div>
      <a href="/?locale=${escapeHtml(locale)}" class="brand-title">${escapeHtml(brandName)}</a>
      <span class="brand-tagline">${escapeHtml(brandTagline)}</span>
    </div>
    <nav class="primary-nav" aria-label="${locale === "pt-BR" ? "Navegação principal do cliente" : "Customer primary navigation"}">
      ${navHtml}
    </nav>
    <form method="GET" action="${escapeHtml(params.activePath)}" class="locale-switcher">
      <label for="global-locale-select">${escapeHtml(selector.label)}:</label>
      <select id="global-locale-select" name="locale" aria-label="${escapeHtml(selector.label)}">
        ${optionsHtml}
      </select>
      <button type="submit">${locale === "pt-BR" ? "Aplicar" : "Apply"}</button>
    </form>
  </header>
  <main id="main-content" tabindex="-1">
    ${renderScreenStateBannerHtml(params.banner ?? null)}
    ${params.mainContentHtml}
  </main>
  <script>
    if ("serviceWorker" in navigator) {
      window.addEventListener("load", function () {
        navigator.serviceWorker.register("/sw.js").catch(function () {});
      });
    }
  </script>
</body>
</html>`;
}
