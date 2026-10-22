import { getRequestContext } from "@cloudflare/next-on-pages";
import { createLiveDemo, type LiveDemoEnv } from "@/lib/demo/provision";

export const runtime = "edge";

export async function POST(request: Request): Promise<Response> {
  const env = getRequestContext().env as LiveDemoEnv;
  return createLiveDemo(request, env);
}
