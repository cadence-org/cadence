import { createClient } from "@/utils/supabase/server";
import { SupabaseClient } from "@supabase/supabase-js";
import { Submission } from "@/utils/types";
import { toZonedTime } from "date-fns-tz";

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

interface Message {
  submission_id: any;
  message_id: string;
  message_text: string;
  next_message_to_send: string;
  last_sent_time: string | null;
}

export async function getSubmissionsForProcessing(supabase: SupabaseClient) {
  const { data: submissions, error } = await supabase.from("submissions")
    .select(`
      *,
      users!inner (
        area_code,
        phone_number,
        timezone
      )
    `);

  if (error) throw error;
  return submissions;
}

export async function getCurrentMessage(
  supabase: SupabaseClient,
  messageId: string
): Promise<Message> {
  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .eq("message_id", messageId)
    .single();

  if (error) throw error;
  return data;
}

export function shouldSendMessage(
  submission: Submission,
  currentTime: Date,
  timezeone: string
): boolean {
  const startTime = new Date(submission.start_time);
  const lastSentTime = submission.last_sent_time
    ? new Date(submission.last_sent_time)
    : null;
  const cadenceHours = CADENCE_HOURS[submission.cadence] || 24;

  // Check if messages have lapped and submission is not repeatable
  if (
    submission.repeat === "do-not-repeat" &&
    lastSentTime !== null &&
    submission.message_to_send === submission.first_message_id
  ) {
    return false;
  }

  // If never sent before, check if start time has passed
  if (!lastSentTime) {
    return currentTime >= startTime;
  }

  // check if user's time is in waking hours
  const userTime = toZonedTime(currentTime, timezeone);
  if (userTime.getHours() < 8 || userTime.getHours() > 22) {
    return false;
  }

  // Check if enough time has passed since last send
  const hoursSinceLastSent =
    (currentTime.getTime() - lastSentTime.getTime()) / (1000 * 60 * 60);
  return hoursSinceLastSent >= cadenceHours;
}

export async function updateAfterSend(
  supabase: SupabaseClient,
  submission: Submission,
  currentMessage: Message,
  currentTime: Date
) {
  const updates = [
    // Update submission - always update message_to_send, conditionally update last_sent_time
    supabase
      .from("submissions")
      .update({
        message_to_send: currentMessage.next_message_to_send,
        last_sent_time: currentTime.toISOString(),
      })
      .eq("submission_id", submission.submission_id),

    // Always update message last_sent_time
    supabase
      .from("messages")
      .update({
        last_sent_time: currentTime.toISOString(),
      })
      .eq("message_id", currentMessage.message_id),
  ];

  await Promise.all(updates);
}
