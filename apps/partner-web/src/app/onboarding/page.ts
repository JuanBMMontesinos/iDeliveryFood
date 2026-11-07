import type { IDeliveryApiClient } from "@ideliveryfood/api-client";
import {
  DEFAULT_LOCALE,
  type AuthenticatedActorProfileContract,
  type SignedUploadUrlResponseContract,
  type StoreDetailResponseContract,
  type SupportedLocale,
} from "@ideliveryfood/contracts";
import { escapeHtml, renderPartnerLayoutHtml } from "../layout.js";

export interface PartnerOnboardingScreenModel {
  locale: SupportedLocale;
  actor: AuthenticatedActorProfileContract;
  storeDetail: StoreDetailResponseContract;
  kycUploadIntent: SignedUploadUrlResponseContract | null;
}

export async function loadPartnerOnboardingScreen(params: {
  apiClient: IDeliveryApiClient;
  storeId: string;
  requestKycUploadFileName?: string;
  locale?: SupportedLocale;
}): Promise<PartnerOnboardingScreenModel> {
  const [meRes, storeRes] = await Promise.all([
    params.apiClient.getMe(),
    params.apiClient.getStoreDetail(params.storeId),
  ]);

  const locale = params.locale ?? meRes.data.preferredLocale ?? DEFAULT_LOCALE;
  let kycUploadIntent: SignedUploadUrlResponseContract | null = null;

  if (params.requestKycUploadFileName) {
    const uploadRes = await params.apiClient.createSignedUploadUrl({
      bucket: "partner-kyc-docs",
      storeId: storeRes.data.store.id,
      fileName: params.requestKycUploadFileName,
      mimeType: "application/pdf",
      fileSizeBytes: 245_760,
    });
    kycUploadIntent = uploadRes.data;
  }

  return {
    locale,
    actor: meRes.data,
    storeDetail: storeRes.data,
    kycUploadIntent,
  };
}

export function renderPartnerOnboardingHtml(model: PartnerOnboardingScreenModel): string {
  const { locale, actor, storeDetail, kycUploadIntent } = model;
  const isPt = locale === "pt-BR";
  const store = storeDetail.store;

  const hasHours = storeDetail.hours.length > 0;
  const hasCoverage = storeDetail.serviceAreas.some((a) => a.isActive);
  const allProducts = storeDetail.categories.flatMap((c) => c.products);
  const hasCatalog = allProducts.some((p) => p.isAvailable);

  const bodyHtml = `
    <section aria-labelledby="onboarding-heading">
      <div class="card">
        <h1 id="onboarding-heading" style="margin-top:0;">
          ${isPt ? "Onboarding Comercial & Documentação KYC (M07)" : "Merchant Onboarding & KYC Documentation (M07)"}
        </h1>
        <p>
          ${
            isPt
              ? "Verifique os requisitos de ativação da unidade e envie documentos societários para o bucket privado partner-kyc-docs."
              : "Verify store activation readiness and upload corporate KYC documents to the private partner-kyc-docs bucket."
          }
        </p>

        <ul data-testid="onboarding-checklist">
          <li>
            <strong>${isPt ? "Status operacional da loja:" : "Store operational status:"}</strong>
            <span class="badge ${storeDetail.availability.isOpen ? "badge--open" : "badge--warn"}">
              ${escapeHtml(storeDetail.availability.reasonCode)}
            </span>
          </li>
          <li>
            <strong>${isPt ? "Horários de funcionamento configurados:" : "Operating hours configured:"}</strong>
            ${hasHours ? "✓ OK" : "✗ Pendente"} (${storeDetail.hours.length})
          </li>
          <li>
            <strong>${isPt ? "Área de cobertura ativa:" : "Active delivery coverage:"}</strong>
            ${hasCoverage ? "✓ OK" : "✗ Pendente"} (${storeDetail.serviceAreas.length})
          </li>
          <li>
            <strong>${isPt ? "Cardápio com produtos ativos:" : "Catalog with active products:"}</strong>
            ${hasCatalog ? "✓ OK" : "✗ Pendente"} (${allProducts.length})
          </li>
        </ul>
      </div>

      <div class="card" data-testid="kyc-upload-card">
        <h2 style="margin-top:0;">${isPt ? "Envio Seguro de Documento KYC (URL Assinada)" : "Secure KYC Document Upload (Signed URL)"}</h2>
        <p>${isPt ? "Bucket privado: partner-kyc-docs (PDF, JPEG, PNG, WEBP até 10 MB)." : "Private bucket: partner-kyc-docs (PDF, JPEG, PNG, WEBP up to 10 MB)."}</p>
        ${
          kycUploadIntent
            ? `<div data-testid="kyc-signed-url-result">
                <p><strong>Object Path:</strong> <code>${escapeHtml(kycUploadIntent.objectPath)}</code></p>
                <p><strong>Signed Upload URL:</strong> <code>${escapeHtml(kycUploadIntent.signedUploadUrl)}</code></p>
                <p><strong>Expires At:</strong> ${escapeHtml(kycUploadIntent.expiresAtIso)}</p>
              </div>`
            : `<a href="/onboarding?kycFile=contrato-social-cnpj.pdf&locale=${escapeHtml(locale)}" class="btn">
                ${isPt ? "Gerar URL Assinada para Contrato Social PDF" : "Generate Signed URL for Corporate Charter PDF"}
              </a>`
        }
      </div>
    </section>
  `;

  return renderPartnerLayoutHtml({
    title: isPt ? "Onboarding & KYC" : "Onboarding & KYC",
    locale,
    activeRoute: "/onboarding",
    actorSummary: `${actor.fullName} (${actor.email})`,
    storeName: store.name,
    bodyHtml,
  });
}
