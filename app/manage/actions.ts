"use server";

import { createClient } from "@/utils/supabase/server";
import { redirect } from "next/navigation";
import { Submission } from "@/utils/types";

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
