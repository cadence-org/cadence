import { redirect } from "next/navigation";
import ManageTile from "@/app/manage/manage-tile";
import { handleGetSubmissions } from "./actions";
import { createClient } from "@/utils/supabase/server";

export default async function Manage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return redirect("/sign-in");
  }

  const submissions = await handleGetSubmissions();

  return (
    <div className="flex-1 w-full max-w-[520px] flex flex-col gap-12">
      <div className="w-full flex flex-row text-center justify-around font-bold text-4xl">
        {"Manage Your Cadences"}
      </div>
      <div className="w-full flex flex-row justify-around">
        {submissions.length > 0 && (
          <div className="flex flex-col gap-12">
            {submissions.map((submission) => (
              <ManageTile
                key={submission.submission_id}
                uuid={submission.submission_id}
                textField={submission.text_field || ""}
                uploadedFiles={submission.uploaded_files || []}
                cadence={submission.cadence}
                repeat={submission.repeat}
                created={new Date(submission.created_at)}
              />
            ))}
          </div>
        )}
        {submissions.length === 0 && (
          <div className="flex flex-col gap-12 py-32">
            <div className="w-full flex flex-col justify-around text-center text-2xl">
              {"No cadences found 😔"}
              <br />
              <a href="/create">
                <u>Create</u>&nbsp;one now!
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
