import { NextRequest } from "next/server";
import { createServiceClient } from "@/utils/supabase/service-client";
import { randomUUID } from "crypto";
import OpenAI from "openai";
import { z } from "zod";
import { sendTextMessage } from "@/utils/twilio";
import * as cheerio from "cheerio";
import { YoutubeTranscript } from "youtube-transcript";
import pdfParse from "pdf-parse";
import { SupabaseClient } from "@supabase/supabase-js";
import { Database } from "@/lib/database.types";
import { zodResponseFormat } from "openai/helpers/zod";
import { traceable } from "langsmith/traceable";
import { wrapOpenAI } from "langsmith/wrappers";
import FireCrawlApp from "@mendable/firecrawl-js";
import { processQuizMessages } from "@/utils/quiz/index";

const firecrawl = new FireCrawlApp({
  apiKey: process.env.FIRECRAWL_API_KEY,
});

// Type definitions
type QuizSubmissionResult = {
  id: string;
  status: "success" | "error";
  error?: string;
};

type ProcessResult = {
  success: boolean;
  message?: string;
  processed?: QuizSubmissionResult[];
  error?: string;
};

interface UserData {
  first_name: string | null;
  area_code: string;
  phone_number: string;
}

interface TranscriptResponse {
  transcript: string;
}

// OpenAI configuration
const openai = wrapOpenAI(
  new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  })
);

// Zod schemas for GPT responses
const Questions = z.object({
  questions: z.array(
    z.object({
      question: z.string(),
      answer: z.string(),
    })
  ),
}) satisfies z.ZodType<{ questions: { question: string; answer: string }[] }>;

const Title = z.object({
  title: z.string(),
}) satisfies z.ZodType<{ title: string }>;

const cleanText = (text: string): string => {
  return text
    .replace(/\s+/g, " ")
    .replace(/\\n+/g, "\\n")
    .replace(/\[\s*\]/g, "")
    .replace(/\(\s*\)/g, "")
    .replace(/\s+([.,!?])/g, "$1")
    .replace(/\s+$/gm, "")
    .replace(/^\s+/gm, "")
    .replace(/\b(Reply|Comment)\b/g, "")
    .replace(/Loading\.\.\./g, "")
    .replace(/<[^>]*>/g, "")
    .replace(/&[a-z]+;/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
};

const cleanMarkdown = (markdown: string | null): string => {
  if (!markdown) {
    throw new Error("Markdown response was null");
  }
  return (
    markdown
      // Remove images
      .replace(/!\[.*?\]\(.*?\)/g, "")
      // Remove links but keep text
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
      // Remove headers
      .replace(/#{1,6}\s+/g, "")
      // Remove HTML comments
      .replace(/<!--[\s\S]*?-->/g, "")
      // Remove HTML tags
      .replace(/<[^>]*>/g, "")
      // Remove multiple newlines
      .replace(/\n{3,}/g, "\n\n")
      // Remove horizontal rules
      .replace(/---/g, "")
      // Clean extra whitespace
      .replace(/\s+/g, " ")
      // Remove URLs
      .replace(/https?:\/\/[^\s]+/g, "")
      // Clean up any markdown artifacts
      .replace(/[*_`~]/g, "")
      // Trim whitespace
      .trim()
  );
};

export async function GET(request: NextRequest): Promise<Response> {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const startTime = Date.now();
  console.log(
    "Starting quiz processing job at:",
    new Date(startTime).toISOString()
  );

  const supabase = createServiceClient();
  const processResult = await processUnprocessedQuizSubmissions(supabase);

  if (
    processResult.success &&
    processResult.processed &&
    processResult.processed.length > 0
  ) {
    // Get IDs of successfully processed submissions
    const successfulIds = processResult.processed
      .filter((result) => result.status === "success")
      .map((result) => result.id);

    // Process all first messages in parallel
    await Promise.all(
      successfulIds.map((id) =>
        processQuizMessages(supabase, {
          submissionId: id,
          skipTimeCheck: true,
          isFirstMessage: true,
        })
      )
    );
  }

  const endTime = Date.now();
  const duration = (endTime - startTime) / 1000; // in seconds
  console.log("Quiz job completed in:", duration, "seconds");

  return Response.json(processResult, {
    status: processResult.success ? 200 : 500,
  });
}

async function processUnprocessedQuizSubmissions(
  supabase: SupabaseClient<Database>
): Promise<ProcessResult> {
  try {
    const { data: submissions, error } = await supabase
      .from("quiz_submissions")
      .select("*")
      .is("question_to_send", null)
      .order("created_at", { ascending: true })
      .limit(5);

    if (error) throw error;

    if (!submissions || submissions.length === 0) {
      return { success: true, message: "No quiz submissions to process" };
    }

    const results: QuizSubmissionResult[] = [];
    for (const submission of submissions) {
      try {
        await processQuizSubmission(supabase, submission);
        console.log(
          "Processed quiz submission with id: ",
          submission.submission_id
        );
        results.push({ id: submission.submission_id, status: "success" });
      } catch (error) {
        console.error(
          `Error processing quiz submission ${submission.submission_id}:`,
          error
        );
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        results.push({
          id: submission.submission_id,
          status: "error",
          error: errorMessage,
        });

        // Delete the failed submission
        const { error: deleteError } = await supabase
          .from("quiz_submissions")
          .delete()
          .eq("submission_id", submission.submission_id);

        if (deleteError) {
          console.error("Error deleting failed quiz submission:", deleteError);
        }

        // Get submission type and details
        let submissionType = "content";
        let submissionDetail = "";

        if (submission.text_field) {
          if (
            submission.text_field.includes("youtube.com") ||
            submission.text_field.includes("youtu.be")
          ) {
            submissionType = "YouTube video";
            submissionDetail = submission.text_field;
          } else if (submission.text_field.startsWith("http")) {
            submissionType = "article/URL";
            submissionDetail = submission.text_field;
          } else {
            submissionType = "text";
          }
        } else if (submission.uploaded_files?.length) {
          submissionType =
            "PDF" + (submission.uploaded_files.length > 1 ? "s" : "");
          submissionDetail = submission.uploaded_files.join(", ");
        }

        // Notify user of error
        const { data: userData } = await supabase
          .from("users")
          .select("first_name, area_code, phone_number")
          .eq("id", submission.user_id)
          .single();

        if (userData?.phone_number) {
          const userName = userData.first_name || "there";
          let errorMessage = `Hey ${userName}, there was an issue processing your recent ${submissionType} quiz submission on Cadence.`;

          if (submissionDetail) {
            // Truncate long URLs/filenames to keep message readable
            const truncatedDetail =
              submissionDetail.length > 50
                ? submissionDetail.substring(0, 47) + "..."
                : submissionDetail;
            errorMessage += `\n\nSubmission: ${truncatedDetail}`;
          }

          errorMessage +=
            "\n\nThe submission has been removed - please try submitting again. If the issue persists, contact support.";

          await sendTextMessage(
            `+${userData.area_code}${userData.phone_number}`,
            submission,
            errorMessage
          );
        }
      }
    }

    return { success: true, processed: results };
  } catch (error) {
    console.error("Error in processUnprocessedQuizSubmissions:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

const generateQuizQuestions = traceable(
  async (
    text: string,
    readingLevel: string
  ): Promise<{ question: string; answer: string }[]> => {
    const gptModel = text.length > 120_000 ? "gpt-4o-mini" : "gpt-4o";
    console.log(`Using model: ${gptModel} to generate quiz questions`);

    const systemPrompt = `You are an expert at creating educational quiz questions with answers. Based on the content provided, create a series of quiz questions and answers that will help the user learn the material.

    Rules to follow:
    1. Create 5-10 quiz questions that cover the key concepts from the content.
    2. Each question should be clear, specific, and require knowledge of the content to answer.
    3. Each answer should be comprehensive and educational, helping the user understand the concept.
    4. Questions should range from basic recall to more complex application of concepts.
    5. Ensure questions are engaging and thought-provoking.
    6. Don't include any questions about the author, publication date, or other metadata.
    7. Focus on the core concepts that would be most valuable for the user to learn.
    
    The output should be in the form of an array of question-answer pairs.
    `;

    try {
      // Split text into smaller segments if it's too long
      const maxCharsPerRequest = 20000; // Safe limit for context window
      const textSegments = [];
      for (let i = 0; i < text.length; i += maxCharsPerRequest) {
        textSegments.push(text.slice(i, i + maxCharsPerRequest));
      }

      // Process all segments in parallel
      const segmentPromises = textSegments.map((segment) =>
        openai.beta.chat.completions.parse({
          model: gptModel,
          messages: [
            {
              role: "system",
              content: systemPrompt,
            },
            {
              role: "user",
              content: `${segment}`,
            },
          ],
          temperature: 0.7,
          max_tokens: 4000,
          response_format: zodResponseFormat(Questions, "json"),
        })
      );

      // Wait for all GPT calls to complete
      const completions = await Promise.all(segmentPromises);

      // Process all responses and collect questions
      let allQuestions = completions
        .map((completion) => completion.choices[0].message.parsed)
        .filter((response): response is NonNullable<typeof response> => {
          if (!response) {
            console.warn("No response from GPT for segment");
            return false;
          }
          return true;
        })
        .flatMap((response) => response.questions);

      // Ensure we don't have too many questions
      if (allQuestions.length > 10) {
        allQuestions = allQuestions.slice(0, 10);
      }

      if (allQuestions.length === 0) {
        throw new Error("Failed to generate any quiz questions");
      }

      console.log(`Generated ${allQuestions.length} quiz questions`);
      return allQuestions;
    } catch (error) {
      console.error("Error in GPT quiz question generation:", error);
      throw error;
    }
  }
);

const getTitle = async (
  questions: { question: string; answer: string }[]
): Promise<string> => {
  const systemPrompt = `Your job is to assign a title to the following quiz. Keep the title short and concise, not exceeding more than 5 words.`;
  const gptModel = "gpt-4o-mini";
  const shuffledQuestions = [...questions]
    .sort(() => Math.random() - 0.5)
    .slice(0, 3);

  const questionText = shuffledQuestions.map((q) => q.question).join("\n");

  const completion = await openai.beta.chat.completions.parse({
    model: gptModel,
    messages: [
      {
        role: "system",
        content: systemPrompt,
      },
      {
        role: "user",
        content: questionText,
      },
    ],
    temperature: 0.7,
    max_tokens: 100,
    response_format: zodResponseFormat(Title, "json"),
  });
  const response = completion.choices[0].message.parsed;
  const result = response?.title || "";
  return result;
};

async function processQuizSubmission(
  supabase: SupabaseClient<Database>,
  submission: any
): Promise<{ success: true }> {
  let cleanedText = "";

  // Process files if any in parallel
  const files = submission.uploaded_files || [];
  if (files.length > 0) {
    const fileProcessingPromises = files.map(async (filename: string) => {
      const filePath = `${submission.user_id}/${submission.submission_id}/${filename}`;

      const { data: signedUrlData } = await supabase.storage
        .from("attachments")
        .createSignedUrl(filePath, 60 * 60);

      if (!signedUrlData?.signedUrl) return "";

      // Parallelize file fetching and processing
      const fileBuffer = Buffer.from(
        await (await fetch(signedUrlData.signedUrl)).arrayBuffer()
      );
      const pdfData = await pdfParse(fileBuffer);
      return cleanText(pdfData.text);
    });

    // Wait for all files to be processed and combine the results
    const fileTexts = await Promise.all(fileProcessingPromises);
    cleanedText = fileTexts.join("\n\n");
  }

  // Process text content if any
  if (submission.text_field) {
    if (
      submission.text_field.includes("youtube.com") ||
      submission.text_field.includes("youtu.be")
    ) {
      const transcriptResponse = await fetch(
        `https://web-production-5d97.up.railway.app/transcript?url=${encodeURIComponent(
          submission.text_field
        )}`,
        {
          headers: {
            Authorization: `Bearer ${process.env.TRANSCRIPT_SERVICE_API_KEY!}`,
          },
        }
      );

      if (!transcriptResponse.ok) {
        const error = await transcriptResponse.json();
        throw new Error(`Failed to fetch transcript: ${error.error}`);
      }

      const data = (await transcriptResponse.json()) as TranscriptResponse;
      cleanedText = data.transcript;
    } else if (submission.text_field.startsWith("http")) {
      try {
        const scrapeResult = await firecrawl.scrapeUrl(submission.text_field, {
          formats: ["markdown"],
        });

        if (scrapeResult.success) {
          cleanedText = cleanMarkdown(scrapeResult?.markdown ?? null);
        } else {
          throw new Error("Failed to extract content from URL");
        }
      } catch (error) {
        console.error("FireCrawl scraping error:", error);
        throw new Error(
          `Failed to scrape URL content: ${error instanceof Error ? error.message : "Unknown error"}`
        );
      }
    } else {
      cleanedText = cleanText(submission.text_field);
    }
  }

  if (!cleanedText) {
    throw new Error("No content was extracted from the provided source");
  }

  // Generate quiz questions and answers
  const quizQuestions = await generateQuizQuestions(
    cleanedText,
    submission.reading_level
  );

  if (quizQuestions.length === 0) {
    throw new Error("Failed to generate quiz questions");
  }

  // Generate question IDs
  const questionIds = quizQuestions.map(() => randomUUID());

  // Start title generation in parallel with question creation
  const titlePromise = getTitle(quizQuestions);

  // Create questions in database
  const questionInsertPromises = quizQuestions.map((q, index) =>
    supabase.from("quiz_questions").insert({
      question_id: questionIds[index],
      submission_id: submission.submission_id,
      question_text: q.question,
      answer_text: q.answer,
      timezone: submission.timezone,
    })
  );

  // Link questions in sequence
  const questionLinkPromises = questionIds.map((questionId, index) => {
    // If this is the last question, next_question_id should be null
    const nextQuestionId =
      index < questionIds.length - 1 ? questionIds[index + 1] : null;

    return supabase
      .from("quiz_questions")
      .update({
        next_question_id: nextQuestionId,
      })
      .eq("question_id", questionId);
  });

  // 1. Insert questions first
  await Promise.all(questionInsertPromises);

  // 2. Then update questions to link them
  await Promise.all(questionLinkPromises);

  // 3. Get the title from GPT
  const title = await titlePromise;

  // 4. Finally, update the submission with the first question ID and title
  await supabase
    .from("quiz_submissions")
    .update({
      question_to_send: questionIds[0],
      first_question_id: questionIds[0],
      title,
    })
    .eq("submission_id", submission.submission_id);

  return { success: true };
}
