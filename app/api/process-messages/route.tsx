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

interface Submission {
  submission_id: string;
  user_id: string;
  text_field: string | null;
  uploaded_files: string[] | null;
  timezone: string;
  message_to_send: string | null;
  first_message_id: string | null;
  reading_level: string;
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

const splitIntoChunks = traceable(async (text: string, readingLevel: string): Promise<string[]> => {
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

    let allChunks: string[] = [];

    // Process each segment
    for (const segment of textSegments) {
      const completion = await openai.beta.chat.completions.parse({
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
        response_format: zodResponseFormat(TextMessages, "messages"),
      });

      const response = completion.choices[0].message.parsed;

      if (!response) {
        console.warn("No response from GPT for segment");
        continue;
      }

      // Split response into chunks and add to collection
      const newChunks = response.text_messages
        .map((chunk) => chunk.trim())
        .filter((chunk) => chunk.length > 0);
      allChunks = [...allChunks, ...newChunks];
    }

    // Validate chunks
    allChunks = allChunks.filter((chunk) => {
      // Ensure each chunk is within size limits and has actual content
      return (
        chunk.length > 0 &&
        chunk.length <= 1000 && // Match database constraint
        chunk.split(/[.!?]+/).length >= 2 &&
        !chunk.slice(0, 10).toLowerCase().includes("i'm sorry")
      ); // At least 2 sentences
    });

    if (allChunks.length === 0) {
      // Fallback to simple chunking if GPT fails
      console.warn("GPT chunking failed, falling back to simple chunking");
      return text
        .split(/[.!?]+/)
        .reduce((acc: string[], sentence: string, i: number) => {
          if (i % 3 === 0) acc.push(sentence + ".");
          else if (acc.length > 0) acc[acc.length - 1] += " " + sentence + ".";
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
});

async function processSubmission(
  supabase: SupabaseClient<Database>,
  submission: Submission
): Promise<{ success: true }> {
  let allChunks: string[] = [];

  // Process files if any
  const files = submission.uploaded_files || [];
  if (files.length > 0) {
    for (const filename of files) {
      const filePath = `${submission.user_id}/${submission.submission_id}/${filename}`;

      const { data: signedUrlData } = await supabase.storage
        .from("attachments")
        .createSignedUrl(filePath, 60 * 60);

      if (!signedUrlData?.signedUrl) continue;

      const fileResponse = await fetch(signedUrlData.signedUrl);
      const fileBuffer = Buffer.from(await fileResponse.arrayBuffer());
      const pdfData = await pdfParse(fileBuffer);
      const cleanedText = cleanText(pdfData.text);
      const chunks = await splitIntoChunks(cleanedText, submission.reading_level);
      allChunks = [...allChunks, ...chunks];
    }
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
      const response = await fetch(submission.text_field);
      const html = await response.text();
      const $ = cheerio.load(html);

      $(
        "script, style, nav, header, footer, .comments, #comments, img"
      ).remove();
      cleanedText = cleanText($("body").text());
    } else {
      cleanedText = cleanText(submission.text_field);
    }

    const chunks = await splitIntoChunks(cleanedText);
    allChunks = [...allChunks, ...chunks];
  }

  if (allChunks.length === 0) {
    throw new Error("No content was extracted from the provided source");
  }

  // Create messages
  const messageIds: string[] = [];
  for (const chunk of allChunks) {
    const message_id = randomUUID();
    messageIds.push(message_id);

    await supabase.from("messages").insert({
      message_id,
      submission_id: submission.submission_id,
      message_text: chunk,
      timezone: submission.timezone,
    });
  }

  // Link messages together
  for (let i = 0; i < messageIds.length; i++) {
    await supabase
      .from("messages")
      .update({
        next_message_to_send: messageIds[(i + 1) % messageIds.length],
      })
      .eq("message_id", messageIds[i]);
  }

  // Update submission with first message
  await supabase
    .from("submissions")
    .update({
      message_to_send: messageIds[0],
      first_message_id: messageIds[0],
    })
    .eq("submission_id", submission.submission_id);

  return { success: true };
}
