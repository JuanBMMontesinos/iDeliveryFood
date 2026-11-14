import {
  DEFAULT_LOCALE,
  translateMessage,
  type AuthenticatedActorProfileContract,
  type SupportedLocale,
} from "@ideliveryfood/contracts";
import { buildLanguageSelectorViewModel } from "@ideliveryfood/ui-web";
import {
  buildAdminRoleNavigationModules,
  type AdminModuleKey,
} from "../index.js";

export function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function normalizeApiBaseUrl(rawUrl: string): string {
  const trimmed = rawUrl.replace(/\/+$/, "");
  return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
}

export interface AdminLayoutProps {
  title: string;
  locale?: SupportedLocale;
  currentPath: string;
  actor?: AuthenticatedActorProfileContract | null;
  mainHtml: string;
}

const MODULE_LINKS: Record<
  AdminModuleKey,
  { href: string; labelEn: string; labelPtBr: string }
> = {
  CADASTRE_AND_APPROVALS: {
    href: "/admin/approvals",
    labelEn: "Cadastre & Approvals",
    labelPtBr: "Cadastros e Aprovações",
  },
  LOGISTICS_DISPATCH_CONSOLE: {
    href: "/logistics",
    labelEn: "Logistics & Dispatch (M14)",
    labelPtBr: "Logística e Despacho (M14)",
  },
  SUPPORT_AND_DISPUTES: {
    href: "/support",
    labelEn: "Support & Disputes (M17)",
    labelPtBr: "Suporte e Disputas (M17)",
  },
  FINANCE_LEDGER_AND_SETTLEMENTS: {
    href: "/finance",
    labelEn: "Finance & Ledger (M13)",
    labelPtBr: "Financeiro e Razão (M13)",
  },
  COMMERCIAL_CONTRACTS: {
    href: "/commercial",
    labelEn: "Commercial & Contracts (M18)",
    labelPtBr: "Comercial e Contratos (M18)",
  },
  GROWTH_PROMOTIONS: {
    href: "/marketing",
    labelEn: "Marketing & Promotions (M19)",
    labelPtBr: "Marketing e Promoções (M19)",
  },
  RISK_COMPLIANCE_AND_LGPD: {
    href: "/admin/audit",
    labelEn: "Risk, Compliance & LGPD",
    labelPtBr: "Risco, Compliance e LGPD",
  },
  IAM_AND_PROVIDER_GOVERNANCE: {
    href: "/admin/scopes",
    labelEn: "IAM Scopes & Providers",
    labelPtBr: "Escopos IAM e Provedores",
  },
};

export function renderAdminRootLayout(props: AdminLayoutProps): string {
  const locale = props.locale ?? props.actor?.preferredLocale ?? DEFAULT_LOCALE;
  const brandName = translateMessage("app.brand.name", locale);
  const portalTitle = translateMessage("admin.portal.title", locale);
  const langSelector = buildLanguageSelectorViewModel(locale);

  const allowedModules = props.actor
    ? buildAdminRoleNavigationModules(props.actor)
    : [];

  const navItems: Array<{ href: string; label: string }> = [
    {
      href: "/admin",
      label: locale === "pt-BR" ? "Visão Geral (M16)" : "Overview (M16)",
    },
  ];
  const seenHrefs = new Set<string>(["/admin"]);
  for (const modKey of allowedModules) {
    const def = MODULE_LINKS[modKey];
    if (!seenHrefs.has(def.href)) {
      seenHrefs.add(def.href);
      navItems.push({
        href: def.href,
        label: locale === "pt-BR" ? def.labelPtBr : def.labelEn,
      });
    }
  }
  navItems.push({
    href: "/fleets",
    label: locale === "pt-BR" ? "Frotas (M15)" : "Fleets (M15)",
  });

  const navHtml = navItems
    .map((item) => {
      const isCurrent =
        props.currentPath === item.href ||
        (item.href !== "/admin" && props.currentPath.startsWith(item.href));
      return `<a href="${escapeHtml(item.href)}?locale=${escapeHtml(locale)}" class="nav-link${isCurrent ? " active" : ""}"${isCurrent ? ' aria-current="page"' : ""}>${escapeHtml(item.label)}</a>`;
    })
    .join("\n          ");

  const aalBadge = props.actor
    ? `<span class="badge ${props.actor.aal === "aal2" ? "badge-ok" : "badge-warn"}" data-testid="actor-aal-badge">MFA: ${escapeHtml(props.actor.aal.toUpperCase())}</span>`
    : `<span class="badge badge-warn">UNAUTHENTICATED</span>`;

  return `<!DOCTYPE html>
<html lang="${escapeHtml(locale)}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(props.title)} — ${escapeHtml(brandName)} Backoffice</title>
  <style>
    :root {
      --bg: #f8fafc;
      --surface: #ffffff;
      --text: #0f172a;
      --muted: #475569;
      --primary: #1e293b;
      --accent: #0284c7;
      --border: #cbd5e1;
      --ok-bg: #dcfce7;
      --ok-text: #166534;
      --warn-bg: #fef3c7;
      --warn-text: #92400e;
      --err-bg: #fee2e2;
      --err-text: #991b1b;
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
      background: var(--primary);
      color: #fff;
      padding: 0.5rem 1rem;
      z-index: 100;
    }
    .skip-link:focus { left: 0.5rem; top: 0.5rem; }
    header.site-header {
      background: var(--primary);
      color: #fff;
      padding: 1rem 1.5rem;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
    }
    .brand-title { font-weight: 700; font-size: 1.15rem; color: #fff; text-decoration: none; }
    nav.primary-nav { display: flex; flex-wrap: wrap; gap: 0.75rem; align-items: center; }
    .nav-link {
      color: #e2e8f0;
      text-decoration: none;
      padding: 0.35rem 0.65rem;
      border-radius: 0.375rem;
      font-size: 0.9rem;
    }
    .nav-link.active, .nav-link:hover { background: rgba(255,255,255,0.16); color: #fff; }
    main { max-width: 1280px; margin: 1.5rem auto; padding: 0 1.5rem; }
    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 0.5rem;
      padding: 1.25rem;
      margin-bottom: 1.25rem;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 1rem;
    }
    .badge {
      display: inline-block;
      padding: 0.2rem 0.55rem;
      border-radius: 999px;
      font-size: 0.78rem;
      font-weight: 600;
    }
    .badge-ok { background: var(--ok-bg); color: var(--ok-text); }
    .badge-warn { background: var(--warn-bg); color: var(--warn-text); }
    .badge-err { background: var(--err-bg); color: var(--err-text); }
    .banner {
      padding: 1rem;
      border-radius: 0.5rem;
      margin-bottom: 1rem;
      font-weight: 600;
    }
    .banner-warn { background: var(--warn-bg); color: var(--warn-text); border: 1px solid #f59e0b; }
    .banner-err { background: var(--err-bg); color: var(--err-text); border: 1px solid #ef4444; }
    .banner-info { background: #e0f2fe; color: #075985; border: 1px solid #38bdf8; }
    table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
    th, td { text-align: left; padding: 0.6rem 0.5rem; border-bottom: 1px solid var(--border); }
    th { color: var(--muted); font-weight: 600; }
  </style>
</head>
<body>
  <a href="#main-content" class="skip-link">Skip to main content</a>
  <header class="site-header" role="banner">
    <div>
      <a href="/admin?locale=${escapeHtml(locale)}" class="brand-title">${escapeHtml(brandName)} — ${escapeHtml(portalTitle)}</a>
    </div>
    <nav class="primary-nav" aria-label="Central Backoffice Navigation">
      ${navHtml}
    </nav>
    <div style="display:flex;align-items:center;gap:0.75rem;">
      ${aalBadge}
      <span aria-label="${escapeHtml(langSelector.label)}" style="font-size:0.85rem;">
        <a href="${escapeHtml(props.currentPath)}?locale=en" style="color:#fff;">EN</a> |
        <a href="${escapeHtml(props.currentPath)}?locale=pt-BR" style="color:#fff;">PT-BR</a>
      </span>
    </div>
  </header>
  <main id="main-content" role="main">
    ${props.mainHtml}
  </main>
</body>
</html>`;
}
