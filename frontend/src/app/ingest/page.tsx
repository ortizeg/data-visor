"use client";

import Link from "next/link";

import { useIngestStore } from "@/stores/ingest-store";
import PathInput from "@/components/ingest/path-input";
import ScanResults from "@/components/ingest/scan-results";
import ImportProgress from "@/components/ingest/import-progress";

const STEPS = [
  { key: "input", label: "Select Folder" },
  { key: "confirm", label: "Review Structure" },
  { key: "importing", label: "Import" },
] as const;

function StepIndicator({ current }: { current: string }) {
  const stepIndex = STEPS.findIndex(
    (s) => s.key === current || (current === "done" && s.key === "importing"),
  );

  return (
    <div className="mt-4 flex items-center gap-2">
      {STEPS.map((s, i) => {
        const isComplete = i < stepIndex || current === "done";
        const isActive = i === stepIndex && current !== "done";

        return (
          <div key={s.key} className="flex items-center gap-2">
            {i > 0 && (
              <div
                className={`h-px w-8 ${
                  isComplete
                    ? "bg-blue-600"
                    : "bg-zinc-300 dark:bg-zinc-700"
                }`}
              />
            )}
            <div className="flex items-center gap-2">
              <div
                className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${
                  isComplete
                    ? "bg-blue-600 text-white"
                    : isActive
                      ? "border-2 border-blue-600 text-blue-600"
                      : "border-2 border-zinc-300 text-zinc-400 dark:border-zinc-700 dark:text-zinc-500"
                }`}
              >
                {isComplete ? (
                  <svg
                    className="h-3.5 w-3.5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={3}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                ) : (
                  i + 1
                )}
              </div>
              <span
                className={`text-sm ${
                  isComplete || isActive
                    ? "font-medium text-zinc-900 dark:text-zinc-100"
                    : "text-zinc-400 dark:text-zinc-500"
                }`}
              >
                {s.label}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function IngestPage() {
  const { step } = useIngestStore();

  return (
    <div className="min-h-screen bg-zinc-50 p-8 dark:bg-zinc-950">
      <Link
        href="/"
        className="mb-4 inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
      >
        <svg
          className="h-4 w-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M15 19l-7-7 7-7"
          />
        </svg>
        Back to Home
      </Link>

      <header className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          Import Dataset
        </h1>
        <StepIndicator current={step} />
      </header>

      <main className="mx-auto max-w-2xl">
        {step === "input" && <PathInput />}
        {step === "confirm" && <ScanResults />}
        {(step === "importing" || step === "done") && <ImportProgress />}
      </main>
    </div>
  );
}
