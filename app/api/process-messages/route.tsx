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
import { Submission } from "@/utils/types";
import FireCrawlApp from "@mendable/firecrawl-js";

const firecrawl = new FireCrawlApp({
  apiKey: process.env.FIRECRAWL_API_KEY,
});

// Type definitions
type SubmissionResult = {
  id: string;
  status: "success" | "error";
  error?: string;
};

type ProcessResult = {
  success: boolean;
  message?: string;
  processed?: SubmissionResult[];
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

const readingLevelExamples: Record<string, string> = {
  simple: `
    - "🌱 Here's something cool: plants are basically solar-powered! They take sunlight and turn it into food using their leaves. The green color you see is from chlorophyll, which is like tiny solar panels inside the leaves."
    - "💧 Water plays a huge role in photosynthesis! Plants drink it up from their roots and combine it with CO2 from the air. This chemical reaction helps create glucose - basically plant food!"
  `,
  balanced: `
    - "🌱 During photosynthesis, inside the leaves, cholorophyll molecules absorb sunlight, which provides the energy needed to start the process. This energy helps split water molecules (H₂O) from the roots into oxygen (O₂) and hydrogen (H). The oxygen is released into the air, while the hydrogen is used to make energy-rich molecules like ATP and NADPH."
    - "💧 Next, in the second stage of photosynthesis (the Calvin cycle), plants use the ATP and NADPH produced earlier to combine carbon dioxide (CO₂) from the air with other molecules in the chloroplast. This process gradually builds glucose, a type of sugar that the plant uses for energy and growth."
  `,
  detailed: `
    - "🌱 In the light-dependent reactions of photosynthesis, photons of light are absorbed by chlorophyll molecules in the photosystems (PSI and PSII) located in the thylakoid membrane. This energy excites electrons, which are transferred through the electron transport chain (ETC), ultimately generating ATP and NADPH, which are essential for the Calvin cycle."
    - "💧 The light-independent reactions (Calvin cycle) occur in the stroma of the chloroplast, where ribulose-1,5-bisphosphate carboxylase/oxygenase (RuBisCO) catalyzes the fixation of CO₂ into organic molecules. This cycle converts CO₂ into glucose through a series of enzymatic reactions, using ATP and NADPH produced in the light-dependent reactions."
  `,
};

// Zod schema for GPT response
const TextMessages = z.object({
  text_messages: z.array(z.string()),
}) satisfies z.ZodType<{ text_messages: string[] }>;

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
  console.log("Starting job at:", new Date(startTime).toISOString());

  const supabase = createServiceClient();
  const result = await processUnprocessedSubmissions(supabase);

  const endTime = Date.now();
  const duration = (endTime - startTime) / 1000; // in seconds
  console.log("Job completed in:", duration, "seconds");

  return Response.json(result, {
    status: result.success ? 200 : 500,
  });
}

async function processUnprocessedSubmissions(
  supabase: SupabaseClient<Database>
): Promise<ProcessResult> {
  try {
    const { data: submissions, error } = (await supabase
      .from("submissions")
      .select("*")
      .is("message_to_send", null)
      .order("created_at", { ascending: true })
      .limit(5)) as {
      data: Submission[] | null;
      error: any;
    };

    if (error) throw error;

    if (!submissions || submissions.length === 0) {
      return { success: true, message: "No submissions to process" };
    }

    const results: SubmissionResult[] = [];
    for (const submission of submissions) {
      try {
        await processSubmission(supabase, submission);
        console.log("Processed submission with id: ", submission.submission_id);
        results.push({ id: submission.submission_id, status: "success" });
      } catch (error) {
        console.error(
          `Error processing submission ${submission.submission_id}:`,
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
          .from("submissions")
          .delete()
          .eq("submission_id", submission.submission_id);

        if (deleteError) {
          console.error("Error deleting failed submission:", deleteError);
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
        const { data: userData } = (await supabase
          .from("users")
          .select("first_name, area_code, phone_number")
          .eq("id", submission.user_id)
          .single()) as { data: UserData | null; error: any };

        if (userData?.phone_number) {
          const userName = userData.first_name || "there";
          let errorMessage = `Hey ${userName}, there was an issue processing your recent ${submissionType} submission on Cadence.`;

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
    console.error("Error in processUnprocessedSubmissions:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

const splitIntoChunks = traceable(
  async (text: string, readingLevel: string): Promise<string[]> => {
    const gptModel = text.length > 120_000 ? "gpt-4o-mini" : "gpt-4o";
    console.log(`Using model: ${gptModel} to split text into chunks`);

    const systemPrompt = `You are an expert at breaking down and explaining complex information. Break down the content given by a user seeking to understand the content into engaing text messages that will be delivered back to the user in timely intervals. Some rules to follow are:
      1. Each text message must be around 4-5 sentences under 1000 characters total.
      2. Make each text message focus on a single concept, topic, idea, or quote from the content.
      3. Write in a text message style while keeping the information accurate.
      4. Ensure each text message is self-contained and easily understood.
      5. Use simple language and explanatory analogies where helpful.
      6. Exclude any unnecessary information that may be present in the content. This includes information about the author, references, any small talk, introductory content etc. that doesn't have meaningful informational value to the reader.
      7. Make the information memorable and easy to understand.
      8. If the body of text is instructional, break it into clear, actionable steps.
      9. Ignore any content related to appendix or index. Only generate messages on the main content of the material.
      10. DO NOT EXCEED more than 5 messages in total.
    
    Output format should be a series of text messages. Do not include a message that only introduces the topic, remember each text message should have some informational value.
  
    Informational value can be determined based on the content. If its a blogpost or interview, capture the main essence, teachings and quotes. If its an academic paper, capture the main technique and results. If its a news article, capture the main events. and so on.
    
    For example, if given a technical article about photosynthesis, good text messages would be:
    ${readingLevelExamples[readingLevel]}
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
          max_tokens: 2000,
          response_format: zodResponseFormat(TextMessages, "json"),
        })
      );

      // Wait for all GPT calls to complete
      const completions = await Promise.all(segmentPromises);

      // Process all responses and collect chunks
      let allChunks = completions
        .map((completion) => completion.choices[0].message.parsed)
        .filter((response): response is NonNullable<typeof response> => {
          if (!response) {
            console.warn("No response from GPT for segment");
            return false;
          }
          return true;
        })
        .flatMap((response) =>
          response.text_messages
            .map((chunk) => chunk.trim())
            .filter((chunk) => chunk.length > 0)
        );

      allChunks = allChunks.filter((chunk) => {
        return (
          chunk.length > 0 &&
          chunk.length <= 1000 && // Match database constraint
          chunk.split(/[.!?]+/).length >= 2 &&
          !chunk.slice(0, 10).toLowerCase().includes("i'm sorry")
        );
      });

      if (allChunks.length === 0) {
        // Fallback to simple chunking if GPT fails
        console.warn("GPT chunking failed, falling back to simple chunking");
        return text
          .split(/[.!?]+/)
          .reduce((acc: string[], sentence: string, i: number) => {
            if (i % 3 === 0) acc.push(sentence + ".");
            else if (acc.length > 0)
              acc[acc.length - 1] += " " + sentence + ".";
            return acc;
          }, [])
          .filter((chunk) => chunk.trim().length > 0);
      }

      console.log("All chunks:", allChunks);

      return allChunks;
    } catch (error) {
      console.error("Error in GPT text chunking:", error);
      // Fallback to simple chunking
      return text
        .split(/[.!?]+/)
        .reduce((acc: string[], sentence: string, i: number) => {
          if (i % 3 === 0) acc.push(sentence + ".");
          else if (acc.length > 0) acc[acc.length - 1] += " " + sentence + ".";
          return acc;
        }, [])
        .filter((chunk) => chunk.trim().length > 0);
    }
  }
);

const getTitle = async (chunks: string[]): Promise<string> => {
  const systemPrompt = `Your job is to assign a title to the following content. Keep the title short and concise, not exceeding more than 5 words.`;
  const gptModel = "gpt-4o-mini";
  const shuffledChunks = [...chunks]
    .sort(() => Math.random() - 0.5)
    .slice(0, 5);
  const completion = await openai.beta.chat.completions.parse({
    model: gptModel,
    messages: [
      {
        role: "system",
        content: systemPrompt,
      },
      {
        role: "user",
        content: shuffledChunks.join("\n"),
      },
    ],
    temperature: 0.7,
    max_tokens: 2000,
    response_format: zodResponseFormat(Title, "json"),
  });
  const response = completion.choices[0].message.parsed;
  const result = response?.title || "";
  return result;
};

async function processSubmission(
  supabase: SupabaseClient<Database>,
  submission: Submission
): Promise<{ success: true }> {
  let allChunks: string[] = [];

  // Process files if any in parallel
  const files = submission.uploaded_files || [];
  if (files.length > 0) {
    const fileProcessingPromises = files.map(async (filename) => {
      const filePath = `${submission.user_id}/${submission.submission_id}/${filename}`;

      const { data: signedUrlData } = await supabase.storage
        .from("attachments")
        .createSignedUrl(filePath, 60 * 60);

      if (!signedUrlData?.signedUrl) return [];

      // Parallelize file fetching and processing
      const [fileResponse, pdfData] = await Promise.all([
        fetch(signedUrlData.signedUrl),
        (async () => {
          const fileBuffer = Buffer.from(
            await (await fetch(signedUrlData.signedUrl)).arrayBuffer()
          );
          return pdfParse(fileBuffer);
        })(),
      ]);

      const cleanedText = cleanText(pdfData.text);
      return splitIntoChunks(cleanedText, submission.reading_level);
    });

    // Wait for all files to be processed and flatten the results
    const fileChunks = await Promise.all(fileProcessingPromises);
    allChunks = fileChunks.flat();
  }

  // Process text content if any
  if (submission.text_field) {
    let cleanedText = "";

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

    const textChunks = await splitIntoChunks(
      cleanedText,
      submission.reading_level
    );
    allChunks = [...allChunks, ...textChunks];
  }

  if (allChunks.length === 0) {
    throw new Error("No content was extracted from the provided source");
  }

  // Generate message IDs upfront
  const messageIds = allChunks.map(() => randomUUID());

  // Start title generation in parallel with message creation
  const titlePromise = getTitle(allChunks);

  // Create messages in parallel
  const messageInsertPromises = allChunks.map((chunk, index) =>
    supabase.from("messages").insert({
      message_id: messageIds[index],
      submission_id: submission.submission_id,
      message_text: chunk,
      timezone: submission.timezone,
    })
  );

  // Link messages in parallel
  const messageLinkPromises = messageIds.map((messageId, index) =>
    supabase
      .from("messages")
      .update({
        next_message_to_send: messageIds[(index + 1) % messageIds.length],
      })
      .eq("message_id", messageId)
  );

  // Wait for all operations to complete
  const [title] = await Promise.all([
    titlePromise,
    ...messageInsertPromises,
    ...messageLinkPromises,
  ]);

  // Update submission with first message and title
  await supabase
    .from("submissions")
    .update({
      message_to_send: messageIds[0],
      first_message_id: messageIds[0],
      title,
    })
    .eq("submission_id", submission.submission_id);

  return { success: true };
}
