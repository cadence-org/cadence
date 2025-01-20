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
    const results: MessageResult[] = [];

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
        // Safety checks for fully processed submissions
        .not("message_to_send", "is", null) // Must have a message to send
        .not("first_message_id", "is", null) // Must have first message set
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
        // Safety checks for fully processed submissions
        .not("message_to_send", "is", null) // Must have a message to send
        .not("first_message_id", "is", null); // Must have first message set

      if (error) throw error;
      submissions = data || [];
    }

    console.log(
      "Processing submissions:",
      submissions.map((s) => s?.submission_id)
    );

    // Process each submission
    for (const submission of submissions) {
      if (!submission) {
        console.warn("Skipping null submission");
        continue;
      }

      try {
        // Skip time check if this is an immediate send
        if (
          !options.skipTimeCheck &&
          !shouldSendMessage(submission, currentTime)
        ) {
          console.log(
            "skipping submission with id: ",
            submission.submission_id
          );
          continue;
        }

        // Double-check current message exists (extra safety)
        const currentMessage = await getCurrentMessage(
          supabase,
          submission.message_to_send
        );

        if (!currentMessage) {
          throw new Error(`Message not found: ${submission.message_to_send}`);
        }

        // Verify message belongs to this submission (extra safety)
        if (currentMessage.submission_id !== submission.submission_id) {
          throw new Error(
            `Message ${submission.message_to_send} does not belong to submission ${submission.submission_id}`
          );
        }

        // Send the message
        const fullPhone =
          `+${submission.users.area_code}${submission.users.phone_number}`.replace(
            /\s+/g,
            ""
          );
        await sendTextMessage(fullPhone, submission, currentMessage.message_text);

        // For first message, skip updating last_sent_time but still update message_to_send
        await updateAfterSend(
          supabase,
          submission,
          currentMessage,
          currentTime,
          options.isFirstMessage
        );

        results.push({
          submission_id: submission.submission_id,
          status: "success" as const,
        });
      } catch (error) {
        console.error(
          `Error processing submission ${submission?.submission_id}:`,
          error
        );
        results.push({
          submission_id: submission.submission_id,
          status: "error" as const,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

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
