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
  is_answer_pending: boolean; // Whether the current question's answer needs to be sent
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
    console.log("Processing quiz messages at:", currentTime.toISOString());

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
      "Found quiz submissions:",
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
            console.log(
              `Processing submission ${submission.submission_id}, is_answer_pending: ${submission.is_answer_pending}`
            );

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

            // Determine what to send based on is_answer_pending and the quiz flow
            const sendingAnswer = submission.is_answer_pending === true;
            let messageText;
            let nextQuestionId = null;

            if (!sendingAnswer) {
              // First message or just sending a question (no answer to previous)
              console.log(
                `Sending first question for submission ${submission.submission_id}`
              );
              messageText = currentQuestion.question_text;

              // Mark question as sent and set is_answer_pending to true
              await supabase
                .from("quiz_questions")
                .update({
                  last_sent_time: currentTime.toISOString(),
                })
                .eq("question_id", currentQuestion.question_id);

              // Update the submission's last sent time and mark answer as pending
              await supabase
                .from("quiz_submissions")
                .update({
                  last_sent_time: currentTime.toISOString(),
                  is_answer_pending: true,
                })
                .eq("submission_id", submission.submission_id);

              console.log(
                `Updated question ${currentQuestion.question_id} as sent, marked answer as pending`
              );
            } else {
              // We need to send the answer to the current question
              // and possibly a new question

              // Check if we have a next question
              if (currentQuestion.next_question_id) {
                // Get the next question details
                const nextQuestion = await getCurrentQuestion(
                  supabase,
                  currentQuestion.next_question_id
                );

                // Create a combined message with answer and next question
                messageText = `Answer: ${currentQuestion.answer_text}\n\nHere is your next question:\n${nextQuestion.question_text}`;
                nextQuestionId = currentQuestion.next_question_id;

                console.log(
                  `Sending answer plus next question ${nextQuestionId}`
                );
              } else if (submission.repeat === "repeat-forever") {
                // For repeating submissions, get the first question again
                const firstQuestion = await getCurrentQuestion(
                  supabase,
                  submission.first_question_id
                );

                // Create a combined message with answer and the first question
                messageText = `Answer: ${currentQuestion.answer_text}\n\nHere is your next question:\n${firstQuestion.question_text}`;
                nextQuestionId = submission.first_question_id;

                console.log(
                  `Sending answer plus cycling back to first question ${nextQuestionId}`
                );
              } else {
                // This is the last answer, don't include a next question
                messageText = `Answer: ${currentQuestion.answer_text}\n\nYou've completed this quiz! Feel free to start a new one.`;
                nextQuestionId = null;

                console.log(
                  `Sending final answer for submission ${submission.submission_id}`
                );
              }

              // Update the database based on what we're sending
              if (nextQuestionId) {
                // We're sending an answer plus a new question
                await supabase
                  .from("quiz_submissions")
                  .update({
                    question_to_send: nextQuestionId,
                    last_sent_time: currentTime.toISOString(),
                    is_answer_pending: false, // Next time we'll send a question answer
                  })
                  .eq("submission_id", submission.submission_id);
              } else {
                // Just sending the final answer
                await supabase
                  .from("quiz_submissions")
                  .update({
                    last_sent_time: currentTime.toISOString(),
                    is_answer_pending: false,
                  })
                  .eq("submission_id", submission.submission_id);
              }
            }

            // Send the message
            const fullPhone =
              `+${submission.users.area_code}${submission.users.phone_number}`.replace(
                /\s+/g,
                ""
              );

            await sendTextMessage(fullPhone, submission, messageText);

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
    lastSentTime !== null &&
    !submission.is_answer_pending
  ) {
    // We've completed a full cycle
    console.log(
      `Quiz cycle complete for submission ${submission.submission_id}, no more messages will be sent`
    );
    return false;
  }

  // If never sent before, we can send immediately
  if (!lastSentTime) {
    console.log(
      `First time sending for submission ${submission.submission_id}`
    );
    return true;
  }

  // Check if user's time is in waking hours (8 AM to 10 PM)
  const userTimeOptions = { timeZone: timezone };
  const userHours = new Date(
    currentTime.toLocaleString("en-US", userTimeOptions)
  ).getHours();

  if (userHours < 8 || userHours > 22) {
    console.log(
      `Outside waking hours (${userHours}) for submission ${submission.submission_id}`
    );
    return false;
  }

  // Check if enough time has passed since last send
  const hoursSinceLastSent =
    (currentTime.getTime() - lastSentTime.getTime()) / (1000 * 60 * 60);

  const shouldSend = hoursSinceLastSent >= cadenceHours;
  console.log(
    `Hours since last sent: ${hoursSinceLastSent.toFixed(2)}, cadence: ${cadenceHours}h, should send: ${shouldSend}`
  );

  return shouldSend;
}
