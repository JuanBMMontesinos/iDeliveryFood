import {
  DEFAULT_LOCALE,
  translateMessage,
  type SupportedLocale,
} from "@ideliveryfood/contracts";
import {
  buildLanguageSelectorViewModel,
  type UiScreenStateBanner,
} from "@ideliveryfood/ui-web";

export interface PartnerLayoutShellOptions {
  title: string;
  locale?: SupportedLocale;
  activeRoute:
    | "/dashboard"
    | "/kitchen"
    | "/catalog"
    | "/store/settings"
    | "/store/hours"
    | "/store/coverage"
    | "/team"
    | "/finance"
    | "/reviews"
    | "/contract"
    | "/support"
    | "/onboarding"
    | "/chain";
  actorSummary?: string | null;
  storeName?: string | null;
  banner?: UiScreenStateBanner | null;
  bodyHtml: string;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function formatBrlCents(cents: number, locale: SupportedLocale): string {
  const amount = (cents / 100).toFixed(2);
  if (locale === "pt-BR") {
    return `R$ ${amount.replace(".", ",")}`;
  }
  return `BRL ${amount}`;
}

export function renderPartnerLayoutHtml(options: PartnerLayoutShellOptions): string {
  const locale = options.locale ?? DEFAULT_LOCALE;
  const langSelector = buildLanguageSelectorViewModel(locale);
  const skipLabel =
    locale === "pt-BR" ? "Pular para o conteúdo principal" : "Skip to main content";

  const navItems: Array<{ href: string; label: string }> = [
    {
      href: "/dashboard",
      label: locale === "pt-BR" ? "Painel (KPIs)" : "Dashboard (KPIs)",
    },
    {
      href: "/kitchen",
      label: translateMessage("kitchen.queue.title", locale),
    },
    {
      href: "/catalog",
      label: locale === "pt-BR" ? "Cardápio (M07)" : "Catalog (M07)",
    },
    {
      href: "/store/settings",
      label: locale === "pt-BR" ? "Loja & Pausa" : "Store & Pause",
    },
    {
      href: "/store/hours",
      label: locale === "pt-BR" ? "Horários" : "Hours",
    },
    {
      href: "/store/coverage",
      label: locale === "pt-BR" ? "Área de Entrega" : "Coverage",
    },
    {
      href: "/team",
      label: locale === "pt-BR" ? "Equipe (RBAC)" : "Team (RBAC)",
    },
    {
      href: "/finance",
      label: locale === "pt-BR" ? "Financeiro & Repasses" : "Finance & Settlements",
    },
    {
      href: "/reviews",
      label: locale === "pt-BR" ? "Avaliações" : "Reviews",
    },
    {
      href: "/contract",
      label: locale === "pt-BR" ? "Contrato" : "Contract",
    },
    {
      href: "/support",
      label: locale === "pt-BR" ? "Suporte" : "Support",
    },
    {
      href: "/onboarding",
      label: locale === "pt-BR" ? "Onboarding & KYC" : "Onboarding & KYC",
    },
    {
      href: "/chain",
      label: locale === "pt-BR" ? "Rede Multi-Unidade (M09)" : "Multi-Unit Chain (M09)",
    },
  ];

  const bannerHtml = options.banner
    ? `<aside role="${escapeHtml(options.banner.role)}" aria-live="${escapeHtml(options.banner.ariaLive)}" class="state-banner state-banner--${escapeHtml(options.banner.kind)}">
        <p>${escapeHtml(options.banner.message)}</p>
      </aside>`
    : "";

  return `<!DOCTYPE html>
<html lang="${escapeHtml(locale)}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="theme-color" content="#0F172A" />
  <title>${escapeHtml(options.title)} — iDeliveryFood Partner</title>
  <style>
    :root {
      --brand: #EA1D2C;
      --bg: #F8FAFC;
      --surface: #FFFFFF;
      --text: #0F172A;
      --muted: #475569;
      --border: #CBD5E1;
      --focus: #2563EB;
      --success: #15803D;
      --warning: #B45309;
      --danger: #B91C1C;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: system-ui, -apple-system, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
    }
    .skip-link {
      position: absolute;
      left: -9999px;
      top: 0;
      background: var(--focus);
      color: #fff;
      padding: 0.5rem 1rem;
      z-index: 1000;
    }
    .skip-link:focus { left: 0.5rem; top: 0.5rem; }
    header.site-header {
      background: #0F172A;
      color: #F8FAFC;
      padding: 0.75rem 1.25rem;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
    }
    nav.primary-nav {
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      padding: 0.5rem 1.25rem;
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
    }
    nav.primary-nav a {
      color: var(--text);
      text-decoration: none;
      font-weight: 600;
      font-size: 0.875rem;
      padding: 0.35rem 0.65rem;
      border-radius: 0.375rem;
    }
    nav.primary-nav a[aria-current="page"] {
      background: #FEE2E2;
      color: var(--brand);
    }
    main#main-content {
      max-width: 1280px;
      margin: 1.25rem auto;
      padding: 0 1.25rem;
    }
    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 0.5rem;
      padding: 1rem;
      margin-bottom: 1rem;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
      gap: 1rem;
    }
    .kanban-board {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 0.75rem;
      align-items: start;
    }
    .kanban-col {
      background: #F1F5F9;
      border: 1px solid var(--border);
      border-radius: 0.5rem;
      padding: 0.75rem;
    }
    .badge {
      display: inline-block;
      padding: 0.15rem 0.5rem;
      border-radius: 999px;
      font-size: 0.75rem;
      font-weight: 700;
      background: #E2E8F0;
      color: var(--text);
    }
    .badge--open { background: #DCFCE7; color: var(--success); }
    .badge--closed { background: #FEE2E2; color: var(--danger); }
    .badge--warn { background: #FEF3C7; color: var(--warning); }
    .btn {
      display: inline-block;
      background: var(--brand);
      color: #fff;
      border: none;
      padding: 0.5rem 0.9rem;
      border-radius: 0.375rem;
      font-weight: 600;
      text-decoration: none;
      cursor: pointer;
    }
    .state-banner {
      border-left: 4px solid var(--brand);
      background: #FFF1F2;
      padding: 0.75rem 1rem;
      margin-bottom: 1rem;
      border-radius: 0.25rem;
    }
    table.data-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.9rem;
    }
    table.data-table th, table.data-table td {
      border-bottom: 1px solid var(--border);
      padding: 0.5rem;
      text-align: left;
    }
    @media print {
      header.site-header, nav.primary-nav, .no-print {
        display: none !important;
      }
      body {
        background: #fff;
        color: #000;
        font-family: monospace;
      }
      main#main-content {
        max-width: 80mm;
        margin: 0;
        padding: 0;
      }
      .thermal-ticket {
        border: 1px dashed #000;
        padding: 4mm;
        page-break-inside: avoid;
      }
    }
  </style>
</head>
<body>
  <a href="#main-content" class="skip-link">${escapeHtml(skipLabel)}</a>
  <header class="site-header" role="banner">
    <div>
      <strong>iDeliveryFood Partner Console</strong>
      ${options.storeName ? `<span class="badge" style="margin-left:0.5rem;">${escapeHtml(options.storeName)}</span>` : ""}
    </div>
    <div style="display:flex;align-items:center;gap:1rem;">
      ${options.actorSummary ? `<span data-testid="actor-summary">${escapeHtml(options.actorSummary)}</span>` : ""}
      <div role="group" aria-label="${escapeHtml(langSelector.label)}">
        ${langSelector.options
          .map(
            (opt) =>
              `<a href="?locale=${escapeHtml(opt.code)}" style="color:#F8FAFC;margin-left:0.4rem;" aria-current="${opt.isSelected ? "true" : "false"}">${escapeHtml(opt.displayLabel)}</a>`
          )
          .join(" | ")}
      </div>
    </div>
  </header>
  <nav class="primary-nav" aria-label="${locale === "pt-BR" ? "Navegação do Portal do Parceiro" : "Partner Portal Navigation"}">
    ${navItems
      .map(
        (item) =>
          `<a href="${escapeHtml(item.href)}?locale=${escapeHtml(locale)}" ${
            options.activeRoute === item.href ? 'aria-current="page"' : ""
          }>${escapeHtml(item.label)}</a>`
      )
      .join("\n    ")}
  </nav>
  <main id="main-content" role="main">
    ${bannerHtml}
    ${options.bodyHtml}
  </main>
</body>
</html>`;
}
