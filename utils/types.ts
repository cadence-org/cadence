type RepeatOption = "repeat-forever" | "do-not-repeat";

export interface Submission {
  submission_id: string;
  user_id: string;
  created_at: string;
  message_to_send: string;
  first_message_id: string;
  last_sent_time: string | null;
  start_time: string;
  text_field: string | null;
  uploaded_files: string[] | null;
  cadence: string;
  repeat: RepeatOption;
  timezone: string;
  reading_level: string;
  title: string;
}

export interface QuizSubmission {
  submission_id: string;
  user_id: string;
  created_at: string;
  question_to_send: string;
  first_question_id: string;
  last_sent_time: string | null;
  start_time: string;
  text_field: string | null;
  uploaded_files: string[] | null;
  cadence: string;
  repeat: RepeatOption;
  timezone: string;
  reading_level: string;
  title: string;
  users?: {
    area_code: string;
    phone_number: string;
    timezone: string;
  };
}

export interface QuizQuestion {
  question_id: string;
  submission_id: string;
  question_text: string;
  answer_text: string;
  next_question_id: string | null;
  last_sent_time: string | null;
  timezone: string;
}
