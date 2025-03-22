import { NextRequest } from "next/server";
import { processQuizMessages } from "@/utils/quiz";
import { createServiceClient } from "@/utils/supabase/service-client";

// WARNING: This endpoint should be removed or secured in production
// It's only for local testing purposes

export async function GET(request: NextRequest) {
  try {
    console.log("Starting test quiz send at:", new Date().toISOString());
    const supabase = createServiceClient();

    // Get all submissions to check
    const { data: submissions, error } = await supabase
      .from("quiz_submissions")
      .select(`*, users!inner(area_code, phone_number, timezone)`)
      .not("question_to_send", "is", null)
      .not("first_question_id", "is", null);

    if (error) {
      throw error;
    }

    console.log(`Found ${submissions.length} quiz submissions to process`);

    // Log the state of each submission
    for (const sub of submissions) {
      console.log(
        `Submission ${sub.submission_id}: is_answer_pending=${sub.is_answer_pending || false}, question_to_send=${sub.question_to_send}`
      );

      // Get the current question
      const { data: question, error: qError } = await supabase
        .from("quiz_questions")
        .select("*")
        .eq("question_id", sub.question_to_send)
        .single();

      if (qError) {
        console.error("Error fetching question:", qError);
      } else {
        console.log(
          `Current question: ${question.question_text.substring(0, 30)}... | Answer: ${question.answer_text.substring(0, 30)}...`
        );
        console.log(`Last sent time: ${sub.last_sent_time}`);
      }
    }

    // Process all quiz messages with skipTimeCheck=true to force sending
    const result = await processQuizMessages(supabase, { skipTimeCheck: true });

    console.log("Processing result:", result);

    return Response.json({
      success: true,
      message: `Processed ${result.processed} quiz messages`,
      details: result,
    });
  } catch (error) {
    console.error("Error in test quiz send:", error);
    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
