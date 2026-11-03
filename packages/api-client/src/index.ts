import {
  DEFAULT_LOCALE,
  type ApiErrorEnvelope,
  type PaginatedResponse,
  type PublishedStoreContract,
  type SupportedLocale,
  type UserPreferencesContract,
} from "@ideliveryfood/contracts";

export interface ApiClientOptions {
  baseUrl: string;
  locale?: SupportedLocale;
  getAccessToken?: () => Promise<string | null> | string | null;
  fetchImpl?: typeof fetch;
}

export class IDeliveryApiError extends Error {
  public readonly status: number;
  public readonly envelope: ApiErrorEnvelope;

  constructor(status: number, envelope: ApiErrorEnvelope) {
    super(envelope.error.message);
    this.name = "IDeliveryApiError";
    this.status = status;
    this.envelope = envelope;
  }
}

export class IDeliveryApiClient {
  private readonly baseUrl: string;
  private locale: SupportedLocale;
  private readonly getAccessToken: (() => Promise<string | null> | string | null) | undefined;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.locale = options.locale ?? DEFAULT_LOCALE;
    this.getAccessToken = options.getAccessToken;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
  }

  public setLocale(locale: SupportedLocale): void {
    this.locale = locale;
  }

  public getLocale(): SupportedLocale {
    return this.locale;
  }

  public async request<T>(params: {
    path: string;
    method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
    body?: unknown;
    correlationId?: string;
    idempotencyKey?: string;
    requireIdempotency?: boolean;
  }): Promise<T> {
    if (params.requireIdempotency && (!params.idempotencyKey || params.idempotencyKey.trim().length < 8)) {
      throw new Error("IDEMPOTENCY_KEY_REQUIRED: Mutation requires a valid X-Idempotency-Key header.");
    }

    const correlationId = params.correlationId ?? `corr_${Date.now()}`;
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Accept-Language": this.locale,
      "X-Correlation-Id": correlationId,
    };

    if (params.idempotencyKey) {
      headers["X-Idempotency-Key"] = params.idempotencyKey;
    }

    if (this.getAccessToken) {
      const token = await this.getAccessToken();
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }
    }

    const init: RequestInit = {
      method: params.method ?? "GET",
      headers,
    };

    if (params.body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(params.body);
    }

    const response = await this.fetchImpl(`${this.baseUrl}${params.path}`, init);
    const payload = (await response.json()) as unknown;

    if (!response.ok) {
      const fallbackEnvelope: ApiErrorEnvelope =
        payload && typeof payload === "object" && "error" in payload
          ? (payload as ApiErrorEnvelope)
          : {
              error: {
                code: `HTTP_${response.status}`,
                message: `Request failed with status ${response.status}`,
                correlationId,
                timestamp: new Date().toISOString(),
              },
            };
      throw new IDeliveryApiError(response.status, fallbackEnvelope);
    }

    return payload as T;
  }

  public async listPublishedStores(): Promise<PaginatedResponse<PublishedStoreContract>> {
    return this.request<PaginatedResponse<PublishedStoreContract>>({
      path: `/stores?locale=${encodeURIComponent(this.locale)}`,
      method: "GET",
    });
  }

  public async updateLocalePreference(
    locale: SupportedLocale,
    idempotencyKey: string
  ): Promise<UserPreferencesContract> {
    this.setLocale(locale);
    return this.request<UserPreferencesContract>({
      path: "/me/preferences",
      method: "PATCH",
      body: { locale },
      idempotencyKey,
      requireIdempotency: true,
    });
  }
}
