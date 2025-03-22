import { redirect } from "next/navigation";
import ManageTile from "@/app/manage/manage-tile";
import { handleGetSubmissions, handleGetQuizSubmissions } from "./actions";
import { createClient } from "@/utils/supabase/server";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default async function Manage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return redirect("/sign-in");
  }

  const [regularSubmissions, quizSubmissions] = await Promise.all([
    handleGetSubmissions(),
    handleGetQuizSubmissions(),
  ]);

  return (
    <div className="flex-1 w-full max-w-[520px] flex flex-col gap-12">
      <div className="w-full flex flex-row text-center justify-around font-bold text-4xl">
        {"Manage Your Content"}
      </div>

      <Tabs defaultValue="regular" className="w-full">
        <TabsList className="w-full mb-6">
          <TabsTrigger value="regular" className="w-1/2">
            Regular Content
          </TabsTrigger>
          <TabsTrigger value="quizzes" className="w-1/2">
            Quizzes
          </TabsTrigger>
        </TabsList>

        <TabsContent value="regular">
          {regularSubmissions.length > 0 && (
            <div className="flex flex-col gap-12">
              {regularSubmissions.map((submission) => (
                <ManageTile
                  key={submission.submission_id}
                  uuid={submission.submission_id}
                  textField={submission.text_field || ""}
                  uploadedFiles={submission.uploaded_files || []}
                  cadence={submission.cadence}
                  repeat={submission.repeat}
                  created={new Date(submission.created_at)}
                  isQuiz={false}
                />
              ))}
            </div>
          )}
          {regularSubmissions.length === 0 && (
            <div className="flex flex-col gap-12 py-32">
              <div className="w-full flex flex-col justify-around text-center text-2xl">
                {"No regular content found 😔"}
                <br />
                <a href="/create">
                  <u>Create</u>&nbsp;one now!
                </a>
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="quizzes">
          {quizSubmissions.length > 0 && (
            <div className="flex flex-col gap-12">
              {quizSubmissions.map((submission) => (
                <ManageTile
                  key={submission.submission_id}
                  uuid={submission.submission_id}
                  textField={submission.text_field || ""}
                  uploadedFiles={submission.uploaded_files || []}
                  cadence={submission.cadence}
                  repeat={submission.repeat}
                  created={new Date(submission.created_at)}
                  isQuiz={true}
                />
              ))}
            </div>
          )}
          {quizSubmissions.length === 0 && (
            <div className="flex flex-col gap-12 py-32">
              <div className="w-full flex flex-col justify-around text-center text-2xl">
                {"No quizzes found 😔"}
                <br />
                <a href="/quiz">
                  <u>Create</u>&nbsp;one now!
                </a>
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
