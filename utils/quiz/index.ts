import { SupabaseClient } from "@supabase/supabase-js";
import { sendTextMessage } from "@/utils/twilio";

type QuizMessageResult = {
  submission_id: string;
  status: "success" | "error";
  error?: string;
};

interface ProcessQuizMessageResult {
  success: boolean;
  processed: number;
  results: QuizMessageResult[];
  error?: string;
}

interface QuizSubmission {
  submission_id: string;
  user_id: string;
  question_to_send: string;
  first_question_id: string;
  cadence: string;
  repeat: string;
  last_sent_time: string | null;
  timezone: string;
  title: string;
  users: {
    area_code: string;
    phone_number: string;
    timezone: string;
  };
}

interface QuizQuestion {
  question_id: string;
  submission_id: string;
  question_text: string;
  answer_text: string;
  next_question_id: string | null;
  last_sent_time: string | null;
  timezone: string;
}

export async function processQuizMessages(
  supabase: SupabaseClient,
  options: {
    submissionId?: string;
    skipTimeCheck?: boolean;
    isFirstMessage?: boolean;
  } = {}
): Promise<ProcessQuizMessageResult> {
  try {
    const currentTime = new Date();

    // Get submissions to process
    let submissions;

    if (options.submissionId) {
      // If specific submission ID is provided
      const { data, error } = await supabase
        .from("quiz_submissions")
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
        .not("question_to_send", "is", null)
        .not("first_question_id", "is", null)
        .single();

      if (error) {
        console.error("Error fetching specific quiz submission:", error);
        throw error;
      }

      if (!data) {
        throw new Error(
          `Quiz submission not found or not ready: ${options.submissionId}`
        );
      }

      submissions = [data];
    } else {
      // Get all submissions
      const { data, error } = await supabase
        .from("quiz_submissions")
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
        .not("question_to_send", "is", null)
        .not("first_question_id", "is", null);

      if (error) throw error;
      submissions = data || [];
    }

    console.log(
      "Processing quiz submissions:",
      submissions.map((s) => s?.submission_id)
    );

    // Process all submissions in parallel
    const results = await Promise.all(
      submissions
        .filter(
          (submission): submission is QuizSubmission =>
            Boolean(submission) &&
            (options.skipTimeCheck ||
              shouldSendQuizMessage(
                submission,
                currentTime,
                submission.users.timezone
              ))
        )
        .map(async (submission): Promise<QuizMessageResult> => {
          try {
            // Get current question
            const currentQuestion = await getCurrentQuestion(
              supabase,
              submission.question_to_send
            );

            if (!currentQuestion) {
              throw new Error(
                `Question not found: ${submission.question_to_send}`
              );
            }

            // Verify question belongs to this submission
            if (currentQuestion.submission_id !== submission.submission_id) {
              throw new Error(
                `Question ${submission.question_to_send} does not belong to submission ${submission.submission_id}`
              );
            }

            // Determine if we're sending a question or an answer
            const isQuestion = !currentQuestion.last_sent_time;
            const messageText = isQuestion
              ? currentQuestion.question_text
              : currentQuestion.answer_text;

            // Send the message
            const fullPhone =
              `+${submission.users.area_code}${submission.users.phone_number}`.replace(
                /\s+/g,
                ""
              );

            await sendTextMessage(fullPhone, submission, messageText);

            // Update based on whether it was a question or answer
            if (isQuestion) {
              // We just sent a question, mark it as sent
              await supabase
                .from("quiz_questions")
                .update({
                  last_sent_time: currentTime.toISOString(),
                })
                .eq("question_id", currentQuestion.question_id);

              // Update the submission's last sent time
              await supabase
                .from("quiz_submissions")
                .update({
                  last_sent_time: currentTime.toISOString(),
                })
                .eq("submission_id", submission.submission_id);
            } else {
              // We just sent an answer, update to the next question
              if (currentQuestion.next_question_id) {
                // Move to the next question
                await supabase
                  .from("quiz_submissions")
                  .update({
                    question_to_send: currentQuestion.next_question_id,
                    last_sent_time: currentTime.toISOString(),
                  })
                  .eq("submission_id", submission.submission_id);
              } else if (submission.repeat === "repeat-forever") {
                // Cycle back to the first question
                await supabase
                  .from("quiz_submissions")
                  .update({
                    question_to_send: submission.first_question_id,
                    last_sent_time: currentTime.toISOString(),
                  })
                  .eq("submission_id", submission.submission_id);
              }
              // If not repeating and no next question, we're done with this quiz
            }

            return {
              submission_id: submission.submission_id,
              status: "success" as const,
            };
          } catch (error) {
            console.error(
              `Error processing quiz submission ${submission?.submission_id}:`,
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
    console.error("Quiz message processing error:", error);
    return {
      success: false,
      processed: 0,
      results: [],
      error: error instanceof Error ? error.message : "Internal server error",
    };
  }
}

async function getCurrentQuestion(
  supabase: SupabaseClient,
  questionId: string
): Promise<QuizQuestion> {
  const { data, error } = await supabase
    .from("quiz_questions")
    .select("*")
    .eq("question_id", questionId)
    .single();

  if (error) throw error;
  return data;
}

function shouldSendQuizMessage(
  submission: QuizSubmission,
  currentTime: Date,
  timezone: string
): boolean {
  type CadenceMap = {
    [key: string]: number;
  };

  const CADENCE_HOURS: CadenceMap = {
    "receive-daily": 24,
    "receive-12": 12,
    "receive-6": 6,
    "receive-4": 4,
    "receive-1": 1,
  };

  const lastSentTime = submission.last_sent_time
    ? new Date(submission.last_sent_time)
    : null;
  const cadenceHours = CADENCE_HOURS[submission.cadence] || 24;

  // Check if all questions have been sent and submission is not repeatable
  if (
    submission.repeat === "do-not-repeat" &&
    submission.first_question_id === submission.question_to_send &&
    lastSentTime !== null
  ) {
    // We've completed a full cycle
    return false;
  }

  // If never sent before, we can send immediately
  if (!lastSentTime) {
    return true;
  }

  // Check if user's time is in waking hours (8 AM to 10 PM)
  const userTimeOptions = { timeZone: timezone };
  const userHours = new Date(
    currentTime.toLocaleString("en-US", userTimeOptions)
  ).getHours();

  if (userHours < 8 || userHours > 22) {
    return false;
  }

  // Check if enough time has passed since last send
  const hoursSinceLastSent =
    (currentTime.getTime() - lastSentTime.getTime()) / (1000 * 60 * 60);

  return hoursSinceLastSent >= cadenceHours;
}
