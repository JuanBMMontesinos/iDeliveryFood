import { createAdminWebServer } from "./server.js";

const port = Number(process.env.ADMIN_WEB_PORT ?? 3002);
const apiBaseUrl =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:4000/v1";

const server = createAdminWebServer({
  apiBaseUrl,
  env: process.env as Record<string, string | undefined>,
});

server.listen(port, "127.0.0.1", () => {
  console.log(
    `[@ideliveryfood/admin-web] Central Admin, Finance & Logistics Backoffice listening on http://127.0.0.1:${port}`
  );
});
