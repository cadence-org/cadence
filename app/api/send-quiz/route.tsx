import { NextRequest } from "next/server";
import { processQuizMessages } from "@/utils/quiz";
import { createServiceClient } from "@/utils/supabase/service-client";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    console.log("unauthorized");
    return new Response("Unauthorized", { status: 401 });
  }

  const supabase = createServiceClient();
  const result = await processQuizMessages(supabase);

  return Response.json(result, {
    status: result.success ? 200 : 500,
  });
}
