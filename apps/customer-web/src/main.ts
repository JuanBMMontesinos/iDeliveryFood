import { IDeliveryApiClient } from "@ideliveryfood/api-client";
import { createCustomerWebServer } from "./server.js";

const port = Number(process.env.CUSTOMER_WEB_PORT ?? 3000);
const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000/v1";

const apiClient = new IDeliveryApiClient({
  baseUrl: apiBaseUrl,
});

const server = createCustomerWebServer({ apiClient });
server.listen(port, () => {
  process.stdout.write(
    `[@ideliveryfood/customer-web] Listening on http://localhost:${port} (API: ${apiBaseUrl})\n`
  );
});
