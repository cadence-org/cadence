"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue } from "@/components/ui/select";
import FileTile from "@/components/filetile";
import { handleDeleteSubmission, handleDeleteQuizSubmission } from "./actions";

interface ManageTileProps {
  uuid: string;
  textField: string;
  uploadedFiles: string[];
  cadence: string;
  repeat: string;
  created: Date;
  isQuiz?: boolean;
}

const CADENCE_MAP: { [key: string]: string } = {
  "receive-daily": "Daily",
  "receive-12": "12 hours",
  "receive-6": "6 hours",
  "receive-1": "1 hour",
};

const REPEAT_MAP: { [key: string]: string } = {
  "repeat-forever": "Forever",
  "do-not-repeat": "Never",
};

function formatDate(date: Date): string {
  // Extract the components of the date
  let year = date.getFullYear().toString().slice(-2); // Get last two digits of the year
  let month = (date.getMonth() + 1).toString().padStart(2, "0"); // Months are 0-based
  let day = date.getDate().toString().padStart(2, "0");

  // Construct the time part
  let hours = date.getHours().toString().padStart(2, "0");
  let minutes = date.getMinutes().toString().padStart(2, "0");
  let ampm = hours >= "12" ? "PM" : "AM";
  hours = (parseInt(hours) % 12).toString().padStart(2, "0");
  let time = `${hours}:${minutes} ${ampm}`;

  // Combine the parts into the desired format
  return `${month}/${day}/${year} at ${time}`;
}

function truncateFileName(fileName: string): string {
  const maxLength = 40;
  // If filename is already shorter than max length, return as is
  if (fileName.length <= maxLength) {
    return fileName;
  }

  // Split filename into name and extension
  const lastDotIndex = fileName.lastIndexOf(".");
  const name = fileName.slice(0, lastDotIndex);
  const extension = fileName.slice(lastDotIndex);

  // Calculate how much of the name we can keep
  const availableLength = maxLength - extension.length - 3; // 3 for "..."
  const truncatedName = name.slice(0, availableLength);

  return `${truncatedName}...${extension}`;
}

export default function ManageTile({
  uuid,
  textField,
  uploadedFiles,
  cadence,
  repeat,
  created,
  isQuiz = false,
}: ManageTileProps) {
  return (
    <Card className="max-w-[520px]">
      <CardHeader>
        <CardTitle>{`${isQuiz ? "Quiz" : "Content"} created on ${formatDate(created)}`}</CardTitle>
      </CardHeader>
      <CardContent>
        <form>
          <div className="grid w-full items-center gap-4">
            <div className="flex flex-col space-y-1.5">
              <Label htmlFor="name">Content</Label>
              <Input id="name" placeholder={textField} readOnly />
              {uploadedFiles &&
                uploadedFiles.map((file) => (
                  <div key={file}>
                    <FileTile
                      filename={truncateFileName(file)}
                      filesize={undefined}
                      onDelete={undefined}
                    />
                  </div>
                ))}
            </div>
            <div className="flex flex-col space-y-1.5">
              <Label htmlFor="framework">Cadence</Label>
              <Select>
                <SelectTrigger id="framework">
                  <SelectValue placeholder={CADENCE_MAP[cadence]} />
                </SelectTrigger>
              </Select>
            </div>
            <div className="flex flex-col space-y-1.5">
              <Label htmlFor="framework">Repeat</Label>
              <Select>
                <SelectTrigger id="framework">
                  <SelectValue placeholder={REPEAT_MAP[repeat]} />
                </SelectTrigger>
              </Select>
            </div>
          </div>
        </form>
      </CardContent>
      <CardFooter className="flex justify-end">
        <Button
          variant="outline"
          className="border-red-500 text-red-500"
          onClick={() => {
            if (isQuiz) {
              handleDeleteQuizSubmission(uuid);
            } else {
              handleDeleteSubmission(uuid);
            }
          }}
        >
          Delete
        </Button>
      </CardFooter>
    </Card>
  );
}
