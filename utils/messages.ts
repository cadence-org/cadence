import { SupabaseClient } from "@supabase/supabase-js";
import { sendTextMessage } from "@/utils/twilio";
import {
  getCurrentMessage,
  shouldSendMessage,
  updateAfterSend,
} from "@/utils/submissions";

type MessageResult = {
  submission_id: string;
  status: "success" | "error";
  error?: string;
};

interface ProcessMessageResult {
  success: boolean;
  processed: number;
  results: MessageResult[];
  error?: string;
}

export async function processMessages(
  supabase: SupabaseClient,
  options: {
    submissionId?: string;
    skipTimeCheck?: boolean;
    isFirstMessage?: boolean;
  } = {}
): Promise<ProcessMessageResult> {
  try {
    const currentTime = new Date();

    // Get submissions to process
    let submissions;

    if (options.submissionId) {
      // If specific submission ID is provided
      const { data, error } = await supabase
        .from("submissions")
        .select(
          `
              *,
              users!inner (
                area_code,
                phone_number,
                timezone
              )
            `
        )
        .eq("submission_id", options.submissionId)
        .not("message_to_send", "is", null)
        .not("first_message_id", "is", null)
        .single();

      if (error) {
        console.error("Error fetching specific submission:", error);
        throw error;
      }

      if (!data) {
        throw new Error(
          `Submission not found or not ready: ${options.submissionId}`
        );
      }

      submissions = [data];
    } else {
      // Get all submissions
      const { data, error } = await supabase
        .from("submissions")
        .select(
          `
              *,
              users!inner (
                area_code,
                phone_number,
                timezone
              )
            `
        )
        .not("message_to_send", "is", null)
        .not("first_message_id", "is", null);

      if (error) throw error;
      submissions = data || [];
    }

    console.log(
      "Processing submissions:",
      submissions.map((s) => s?.submission_id)
    );

    // Process all submissions in parallel
    const results = await Promise.all(
      submissions
        .filter(
          (submission): submission is NonNullable<typeof submission> =>
            Boolean(submission) &&
            (options.skipTimeCheck ||
              shouldSendMessage(
                submission,
                currentTime,
                submission.users.timezone
              ))
        )
        .map(async (submission): Promise<MessageResult> => {
          try {
            // Double-check current message exists (extra safety)
            const currentMessage = await getCurrentMessage(
              supabase,
              submission.message_to_send
            );

            if (!currentMessage) {
              throw new Error(
                `Message not found: ${submission.message_to_send}`
              );
            }

            // Verify message belongs to this submission (extra safety)
            if (currentMessage.submission_id !== submission.submission_id) {
              throw new Error(
                `Message ${submission.message_to_send} does not belong to submission ${submission.submission_id}`
              );
            }

            // Send the message and update in parallel
            const fullPhone =
              `+${submission.users.area_code}${submission.users.phone_number}`.replace(
                /\s+/g,
                ""
              );

            await Promise.all([
              sendTextMessage(
                fullPhone,
                submission,
                currentMessage.message_text
              ),
              updateAfterSend(
                supabase,
                submission,
                currentMessage,
                currentTime
              ),
            ]);

            return {
              submission_id: submission.submission_id,
              status: "success" as const,
            };
          } catch (error) {
            console.error(
              `Error processing submission ${submission?.submission_id}:`,
              error
            );
            return {
              submission_id: submission.submission_id,
              status: "error" as const,
              error: error instanceof Error ? error.message : "Unknown error",
            };
          }
        })
    );

    return {
      success: true,
      processed: results.length,
      results,
    };
  } catch (error) {
    console.error("Message processing error:", error);
    return {
      success: false,
      processed: 0,
      results: [],
      error: error instanceof Error ? error.message : "Internal server error",
    };
  }
}
