// utils/twilio.ts
import { Twilio } from "twilio";
import { Submission } from "@/utils/types";
let twilioClient: Twilio | null = null;

function getTwilioClient() {
  if (!twilioClient) {
    twilioClient = new Twilio(
      process.env.TWILIO_ACCOUNT_SID!,
      process.env.TWILIO_AUTH_TOKEN!
    );
  }
  return twilioClient;
}

export async function sendTextMessage(to: string, submission: Submission, message: string) {
  try {
    const client = getTwilioClient();
    const formattedMessage = `${message}\n\n${submission.title ? `Title: ${submission.title}\n` : ""}Sent by: Cadence`;
    const result = await client.messages.create({
      body: formattedMessage,
      to,
      from: process.env.TWILIO_PHONE_NUMBER!,
    });
    return { success: true, messageId: result.sid };
  } catch (error) {
    console.error("Error sending text message:", error);
    throw error;
  }
}
