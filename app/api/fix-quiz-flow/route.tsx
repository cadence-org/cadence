import { NextRequest } from "next/server";
import { createServiceClient } from "@/utils/supabase/service-client";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const supabase = createServiceClient();

    // Get all quiz submissions that have received at least one question
    // (they have a last_sent_time, but might not have is_answer_pending set)
    const { data: submissions, error } = await supabase
      .from("quiz_submissions")
      .select("*")
      .not("question_to_send", "is", null)
      .not("first_question_id", "is", null)
      .not("last_sent_time", "is", null);

    if (error) {
      throw error;
    }

    console.log(`Found ${submissions.length} quiz submissions to update`);

    // For each submission, check if it has an is_answer_pending field
    // If not (or if false), set it to true so the next run will send the answer
    const updates = await Promise.all(
      submissions.map(async (submission) => {
        // If submission has sent a question but not the answer, mark answer as pending
        if (submission.is_answer_pending !== true) {
          const { error: updateError } = await supabase
            .from("quiz_submissions")
            .update({ is_answer_pending: true })
            .eq("submission_id", submission.submission_id);

          if (updateError) {
            console.error(
              `Error updating submission ${submission.submission_id}:`,
              updateError
            );
            return {
              id: submission.submission_id,
              success: false,
              error: updateError.message,
            };
          }

          console.log(
            `Updated submission ${submission.submission_id} to set is_answer_pending=true`
          );
          return { id: submission.submission_id, success: true };
        }

        return { id: submission.submission_id, success: true, skipped: true };
      })
    );

    return Response.json({
      success: true,
      message: `Updated ${updates.filter((u) => !u.skipped).length} submissions, skipped ${updates.filter((u) => u.skipped).length} submissions`,
      updates,
    });
  } catch (error) {
    console.error("Error fixing quiz submissions:", error);
    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
