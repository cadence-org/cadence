import { NextRequest } from "next/server";
import { createServiceClient } from "@/utils/supabase/service-client";

export async function GET(request: NextRequest) {
  try {
    const supabase = createServiceClient();

    // First check if the is_answer_pending column exists, by describing the table
    const { data: tableInfo, error: tableError } = await supabase.rpc(
      "pg_dump_table",
      { table_name: "quiz_submissions" }
    );

    if (tableError) {
      // Postgres desc command not available or error fetching schema
      console.log("Could not get schema, attempting update anyway");
    } else {
      // Check if is_answer_pending exists in the schema
      console.log("Table schema:", tableInfo);
    }

    // Get all quiz submissions that have received at least one question
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

    // For each submission that has sent a question but not an answer,
    // set is_answer_pending to true
    const updates = await Promise.all(
      submissions.map(async (submission) => {
        // Try to add the is_answer_pending column if it doesn't exist
        try {
          // First try an update to see if column exists
          const { error: updateError } = await supabase
            .from("quiz_submissions")
            .update({ is_answer_pending: true })
            .eq("submission_id", submission.submission_id);

          if (updateError) {
            // If column doesn't exist, Supabase will return an error
            if (
              updateError.message.includes("column") &&
              updateError.message.includes("does not exist")
            ) {
              console.log(
                "Column does not exist, attempting to add it to the schema"
              );

              // This would require schema modification permissions
              // In real world, you would add the column via Supabase dashboard
              // or a migration script
              console.log(
                "Please add is_answer_pending column manually via Supabase dashboard"
              );

              return {
                id: submission.submission_id,
                success: false,
                error:
                  "Column does not exist in schema. Add is_answer_pending BOOLEAN column to quiz_submissions table.",
              };
            }

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
        } catch (err) {
          return {
            id: submission.submission_id,
            success: false,
            error: err instanceof Error ? err.message : "Unknown error",
          };
        }
      })
    );

    // Count successes and failures
    const successCount = updates.filter((u) => u.success).length;
    const failureCount = updates.filter((u) => !u.success).length;

    return Response.json({
      success: true,
      message: `Updated ${successCount} submissions, failed to update ${failureCount} submissions`,
      note: "If all updates failed with 'column does not exist', you need to add is_answer_pending BOOLEAN column to quiz_submissions table in Supabase",
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
