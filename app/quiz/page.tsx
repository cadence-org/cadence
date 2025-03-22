import { Suspense } from "react";
import UploadForm from "../create/upload-form";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";

export const maxDuration = 300;

export default async function QuizPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("id", user?.id);

  if (!data || data.length === 0 || error) {
    console.error(`Error getting user data for user id ${user?.id}: `, error);
    throw new Error("Error getting user data");
  }

  const userName = user.user_metadata.first_name;

  return (
    <div className="flex-1 w-full max-w-[520px] flex flex-col gap-12">
      <div className="w-full flex flex-row text-center justify-around font-bold text-4xl">
        {"Test Your Knowledge"}
      </div>
      <div className="w-full flex flex-row justify-around">
        <p className="text-center">
          Upload content and we'll create personalized quiz questions to test
          your understanding. Our system uses{" "}
          <span className="font-semibold">active recall</span> and
          <span className="font-semibold"> spaced repetition</span> - proven
          educational techniques that dramatically improve long-term retention.
        </p>
      </div>
      <div className="w-full flex flex-row justify-around">
        <p className="text-center text-emerald-400 font-semibold">
          Research shows testing yourself is 2x more effective than re-reading
          for long-term memory!
        </p>
      </div>
      <div className="w-full flex flex-row justify-around">
        <ul className="list-disc pl-6">
          <li className="mb-2">
            Receive targeted questions about your content
          </li>
          <li className="mb-2">
            Get answers at your next interval to reinforce learning
          </li>
          <li className="mb-2">
            Build knowledge that sticks through repeated testing
          </li>
        </ul>
      </div>

      <Suspense fallback={<div>Loading...</div>}>
        <UploadForm
          initialUserName={userName}
          isSubscribed={data[0].is_subscribed}
          isQuiz={true}
        />
      </Suspense>
    </div>
  );
}
