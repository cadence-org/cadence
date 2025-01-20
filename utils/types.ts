
type RepeatOption = "repeat-forever" | "do-not-repeat";

export interface Submission {
    submission_id: string;
    user_id: string;
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
