import { IDeliveryApiClient } from "@ideliveryfood/api-client";
import { createPartnerWebServer } from "./server.js";

const port = Number(process.env.PARTNER_WEB_PORT ?? 3001);
const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000/v1";

const apiClient = new IDeliveryApiClient({
  baseUrl: apiBaseUrl,
  getAccessToken: () => process.env.PARTNER_ACCESS_TOKEN ?? null,
});

const server = createPartnerWebServer({ apiClient });
server.listen(port, () => {
  process.stdout.write(`iDeliveryFood Partner Web listening on http://localhost:${port}\n`);
});
