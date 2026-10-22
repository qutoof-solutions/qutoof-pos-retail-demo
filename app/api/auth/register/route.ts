import { getRequestContext } from "@cloudflare/next-on-pages";
import { registerBusiness, type RegistrationEnv } from "@/lib/register-handler";

export const runtime = "edge";

export async function POST(request: Request): Promise<Response> {
  const env = getRequestContext().env as RegistrationEnv;
  return registerBusiness(request, env);
}
