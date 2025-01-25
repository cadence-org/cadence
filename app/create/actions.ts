"use server";

import { createClient } from "@/utils/supabase/server";
import { SupabaseClient } from "@supabase/supabase-js";
import crypto from "crypto";

const MAX_FREE_SUBMISSIONS = 5;

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

/**
 * Generates a start time for message delivery based on submission ID.
 * Start time will be:
 * - Between 8 AM - 8 PM in user's timezone (waking hours)
 * - After minimum cadence period from current time
 * - Today or tomorrow only
 * - Deterministically random (same ID = same time) to help avoid collisions
 *
 * @param submissionId - UUID of the submission
 * @param timezone - User's timezone string (e.g. "America/New_York")
 * @param cadence - Frequency of messages (e.g. "receive-4" for 4 hours)
 * @returns Date object with calculated start time
 */
function generateStartTime(
  submissionId: string,
  timezone: string,
  cadence: string
): Date {
  // Create a hash of the submission ID
  const hash = crypto.createHash("sha256").update(submissionId).digest();
  const randomValue = hash.readUInt32BE(0) / 0xffffffff; // number between 0 and 1

  // Get current date in user's timezone
  const now = new Date();
  const userNow = new Date(now.toLocaleString("en-US", { timeZone: timezone }));

  // Get cadence hours
  const cadenceHours = CADENCE_HOURS[cadence] || 24;

  // Calculate minimum time based on cadence
  const minTime = new Date(userNow);
  minTime.setHours(minTime.getHours() + cadenceHours);

  // If minimum time is today but before 8 AM, set to 8 AM
  if (minTime.getHours() < 8) {
    minTime.setHours(8, 0, 0, 0);
  }

  // If minimum time is after 8 PM today, set to 8 AM tomorrow
  if (minTime.getHours() >= 20) {
    minTime.setDate(minTime.getDate() + 1);
    minTime.setHours(8, 0, 0, 0);
  }

  // Calculate available minutes in the valid window
  const startHour = minTime.getHours();
  const endHour = 20; // 8 PM
  const availableMinutes = (endHour - startHour) * 60;

  const minuteOffset = Math.floor(randomValue * availableMinutes);

  const finalTime = new Date(minTime);
  finalTime.setMinutes(finalTime.getMinutes() + minuteOffset);

  return finalTime;
}

function getCurrentTime(timezone: string): Date {
  // Get current date in user's timezone
  const now = new Date();
  const userNow = new Date(now.toLocaleString("en-US", { timeZone: timezone }));

  // Calculate minimum time based on cadence
  return new Date(userNow);
}

function isValidYouTubeUrl(url: string): boolean {
  // Extract video ID from URL
  const videoId = url.match(
    /(?:youtu\.be\/|youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/
  )?.[1];

  if (!videoId) {
    return false;
  }

  return true;
}

async function isPublicUrl(url: string) {
  try {
    // A HEAD request is often enough to see if it's public (2xx).
    // Alternatively, you can do a GET request if you need to inspect HTML content.
    const response = await fetch(url, { method: "HEAD" });
    if (!response.ok) {
      // e.g. 403, 401, 404 => treat as restricted or nonexistent
      console.log(`Non-200 status: ${response.status}`);
      return false;
    }
    return true;
  } catch (error) {
    console.error("Public URL check failed:", error);
    return false;
  }
}

async function checkUserCanSubmit(
  supabase: SupabaseClient<any, "public", any>,
  user_id: string
) {
  // validate if the user is allowed to submit
  const { data: user_data, error: userError } = await supabase
    .from("users")
    .select("is_subscribed")
    .eq("id", user_id)
    .single();

  if (userError) throw userError;

  // get number of submissions from user
  const { data: submissions, error: submissionError } = await supabase
    .from("submissions")
    .select("*")
    .eq("user_id", user_id);

  if (submissionError) throw submissionError;

  if (
    user_data.is_subscribed === false &&
    submissions.length >= MAX_FREE_SUBMISSIONS
  ) {
    console.log("User has reached submission limit");
    return false;
  }

  return true;
}

export async function getUser() {
  try {
    const supabase = await createClient();
    const user = await supabase.auth.getUser();
    return user.data.user;
  } catch (error) {
    console.error("Error getting user:", error);
    throw new Error("Failed to get user details");
  }
}

export async function handleSubmission(
  formData: FormData
): Promise<{ success: boolean; error?: string; submission_id?: string }> {
  const supabase = await createClient();
  const submission_id = formData.get("submission_id") as string;
  const url = formData.get("url") as string | undefined;
  const youtube_url = formData.get("youtube_url") as string | undefined;
  const raw_text = formData.get("raw_text") as string | undefined;
  const file_names = JSON.parse(formData.get("files") as string) as string[];
  const cadence = formData.get("cadence") as string;
  const repeat = formData.get("repeat") as string;
  const reading_level = formData.get("reading_level") as string;

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Not authenticated");

    const canSubmit = await checkUserCanSubmit(supabase, user.id);
    if (!canSubmit) {
      return {
        success: false,
        error:
          "You've hit the submission limit. Get Pro ✨ for unlimited submissions.",
      };
    }

    // Get user's timezone
    const { data: userData, error: userError } = await supabase
      .from("users")
      .select("timezone")
      .eq("id", user.id)
      .single();

    if (userError) throw userError;

    // if url, try scraping it to throw error if it fails
    if (url?.trim()) {
      try {
        if (!isPublicUrl(url)) {
          return {
            success: false,
            error:
              "The provided URL is not public. Please try copy-pasting the content text instead.",
          };
        }
      } catch (error: any) {
        return {
          success: false,
          error:
            "There was an issue processing the URL. Please try copy-pasting the content text instead.",
        };
      }
    }

    // if youtube_url, check if it's a valid YouTube URL
    if (youtube_url?.trim()) {
      const isValid = isValidYouTubeUrl(youtube_url);
      if (!isValid) {
        return {
          success: false,
          error: "Invalid YouTube URL. Make sure the pasted URL is correct.",
        };
      }
    }

    const startTime = generateStartTime(
      submission_id,
      userData.timezone,
      cadence
    );

    // Create initial submission record
    // Note: message_to_send is null by default, which indicates it needs processing
    const { error: submissionError } = await supabase
      .from("submissions")
      .insert({
        submission_id,
        user_id: user.id,
        text_field: youtube_url?.trim() || url?.trim() || raw_text || null,
        uploaded_files: file_names ?? [],
        cadence,
        repeat,
        timezone: userData.timezone,
        message_to_send: null,
        first_message_id: null,
        start_time: startTime.toISOString(),
        reading_level,
      });

    if (submissionError) throw submissionError;

    return { success: true, submission_id };
  } catch (error) {
    console.error("Error in submission:", error);
    throw error;
  }
}
