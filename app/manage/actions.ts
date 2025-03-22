"use server";

import { createClient } from "@/utils/supabase/server";
import { redirect } from "next/navigation";
import { Submission, QuizSubmission } from "@/utils/types";

export async function handleGetSubmissions() {
  const supabase = await createClient();
  const user = await supabase.auth.getUser();
  if (user == null || user.data.user == null) {
    throw new Error("Error getting user, user is null in get submissions");
  }
  const { data, error } = await supabase
    .from("submissions")
    .select("*")
    .eq("user_id", `${user.data.user.id}`)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error("Error getting submissions");
  }

  const resp = data.map((submission) => {
    return submission as Submission;
  });

  return resp;
}

export async function handleGetQuizSubmissions() {
  const supabase = await createClient();
  const user = await supabase.auth.getUser();
  if (user == null || user.data.user == null) {
    throw new Error("Error getting user, user is null in get quiz submissions");
  }
  const { data, error } = await supabase
    .from("quiz_submissions")
    .select("*")
    .eq("user_id", `${user.data.user.id}`)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error("Error getting quiz submissions");
  }

  const resp = data.map((submission) => {
    return submission as QuizSubmission;
  });

  return resp;
}

export async function handleDeleteSubmission(uuid: string) {
  const supabase = await createClient();
  console.log("Deleting submission:", uuid);

  try {
    // delete the submission
    const { error: submissionError } = await supabase
      .from("submissions")
      .delete()
      .eq("submission_id", uuid);

    if (submissionError) {
      console.error("Error deleting submission:", submissionError);
      throw submissionError;
    }

    // delete any uploaded files
    const { data: user } = await supabase.auth.getUser();
    if (user.user) {
      const folderPath = `${user.user.id}/${uuid}`;
      const { error: storageError } = await supabase.storage
        .from("attachments")
        .remove([folderPath]);

      if (storageError) {
        console.error("Error deleting files:", storageError);
        // don't throw here as the main deletion was successful
      }
    }
  } catch (error) {
    console.error("Error in deletion process:", error);
    throw new Error("Error deleting submission and associated data");
  }

  redirect("/manage");
}

export async function handleDeleteQuizSubmission(uuid: string) {
  const supabase = await createClient();
  console.log("Deleting quiz submission:", uuid);

  try {
    // Delete associated quiz questions
    const { error: questionsError } = await supabase
      .from("quiz_questions")
      .delete()
      .eq("submission_id", uuid);

    if (questionsError) {
      console.error("Error deleting quiz questions:", questionsError);
      // Continue with deleting the submission even if questions deletion fails
    }

    // Delete the quiz submission
    const { error: submissionError } = await supabase
      .from("quiz_submissions")
      .delete()
      .eq("submission_id", uuid);

    if (submissionError) {
      console.error("Error deleting quiz submission:", submissionError);
      throw submissionError;
    }

    // Delete any uploaded files
    const { data: user } = await supabase.auth.getUser();
    if (user.user) {
      const folderPath = `${user.user.id}/${uuid}`;
      const { error: storageError } = await supabase.storage
        .from("attachments")
        .remove([folderPath]);

      if (storageError) {
        console.error("Error deleting files:", storageError);
        // don't throw here as the main deletion was successful
      }
    }
  } catch (error) {
    console.error("Error in quiz deletion process:", error);
    throw new Error("Error deleting quiz submission and associated data");
  }

  redirect("/manage");
}
