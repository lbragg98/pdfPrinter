"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import type {
  OrchestratorResponse,
  QuizResponse,
  SkillInterruptPayload,
} from "../lib/orchestrator";
import { createThreadId, runOrchestratorPrompt } from "../lib/orchestrator";

const SHOWCASE_APP_ID = "SampleApp";
const APP_SCOPE_ID = `${SHOWCASE_APP_ID}/*`;
const IMPORT_CATALOG_STORAGE_KEY = "pdf-printer-import-catalog";
const SUPPORTED_FILE_EXTENSIONS = new Set([
  "csv",
  "doc",
  "docx",
  "json",
  "md",
  "pdf",
  "ppt",
  "pptx",
  "rtf",
  "text",
  "txt",
  "xls",
  "xlsx",
]);

type GenerationMode = "study-sheet" | "quiz" | "import";

type ScopedImportedFile = {
  localId: string;
  fileName: string;
  categoryPath: string;
  scopeId: string;
  importId: string;
  uploadedAt: string;
  processingStatus: string;
  fileType: string;
  fileSize: number;
};

type ScopedAnswer = {
  scopeId: string;
  scopeLabel: string;
  question: string;
  answer: string;
  sourceNames: string[];
};

type ScopeOption = {
  label: string;
  value: string;
};

const PythonMark = () => (
  <img
    src="/python-logo.png"
    alt=""
    aria-hidden="true"
    className="python-mark python-logo-image"
  />
);

const SendIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className="send-icon">
    <path
      fill="currentColor"
      fillRule="evenodd"
      d="M2.5 12 21 3.5l-4.7 17L11.7 13 2.5 12Zm6.3 1.1 8.2 5.6-3.2-8.7-5 3.1Z"
      clipRule="evenodd"
    />
  </svg>
);

function MarkdownText({ content }: { content: string }) {
  const blocks = content
    .trim()
    .split(/\n\s*\n/)
    .filter(Boolean);

  return (
    <>
      {blocks.map((block, index) => {
        const lines = block.split(/\r?\n/).filter(Boolean);
        const bulletLines = lines.every((line) => /^[-*]\s+/.test(line));
        const numberedLines = lines.every((line) => /^\d+\.\s+/.test(line));

        if (bulletLines || numberedLines) {
          const Tag = numberedLines ? "ol" : "ul";
          return (
            <Tag key={index} className="markdown-list">
              {lines.map((line, itemIndex) => (
                <li key={itemIndex}>
                  {renderInline(line.replace(/^([-*]|\d+\.)\s+/, ""))}
                </li>
              ))}
            </Tag>
          );
        }

        return <p key={index}>{renderInline(lines.join(" "))}</p>;
      })}
    </>
  );
}

function renderInline(text: string): ReactNode {
  const parts: ReactNode[] = [];
  const pattern = /(\[[^\]]+\]\([^\)]+\)|\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let lastIndex = 0;

  for (const match of text.matchAll(pattern)) {
    const [token] = match;
    const index = match.index ?? 0;

    if (index > lastIndex) {
      parts.push(text.slice(lastIndex, index));
    }

    if (token.startsWith("[")) {
      const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (linkMatch) {
        parts.push(
          <a
            key={`${index}-link`}
            href={linkMatch[2]}
            target="_blank"
            rel="noreferrer"
          >
            {linkMatch[1]}
          </a>,
        );
      }
    } else if (token.startsWith("**")) {
      parts.push(<strong key={`${index}-strong`}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("*")) {
      parts.push(<em key={`${index}-em`}>{token.slice(1, -1)}</em>);
    } else if (token.startsWith("`")) {
      parts.push(<code key={`${index}-code`}>{token.slice(1, -1)}</code>);
    }

    lastIndex = index + token.length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length ? <>{parts}</> : text;
}

function hasInterrupt(response: OrchestratorResponse) {
  return Boolean(
    response.interrupt ||
      response.interruptRequested ||
      response.waitingForInput ||
      response.interruptNodeId,
  );
}

function isQuizResponse(value: unknown): value is QuizResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    Array.isArray(record.AnswerKey) &&
    Array.isArray(record.Questions) &&
    record.Questions.every((question) => {
      if (
        !question ||
        typeof question !== "object" ||
        Array.isArray(question)
      ) {
        return false;
      }

      const questionRecord = question as Record<string, unknown>;
      return (
        Array.isArray(questionRecord.Answers) &&
        typeof questionRecord.CorrectAnswer === "string" &&
        typeof questionRecord.QuestionTitle === "string"
      );
    })
  );
}

function buildPrompt(topic: string, mode: GenerationMode) {
  if (mode === "study-sheet") {
    return `python Study sheet about ${topic}`;
  }

  if (mode === "import") {
    return `import a file for ${topic}`;
  }

  return `make a quiz about ${topic}`;
}

function buildScopedRetrievalPrompt({
  question,
  scopeId,
  scopeLabel,
  files,
}: {
  question: string;
  scopeId: string;
  scopeLabel: string;
  files: ScopedImportedFile[];
}) {
  const sourceNames = files.map((file) => file.fileName).join(", ");

  return [
    "You are answering a question using only the retrieved file context.",
    "If the answer is not present in the selected files, say that the selected files do not contain enough information to answer.",
    "Do not rely on prior questions or answers.",
    `Selected retrieval scope: ${scopeId}`,
    `Selected scope label: ${scopeLabel}`,
    `Files expected in scope: ${sourceNames || "None"}`,
    `User question: ${question.trim()}`,
  ].join("\n");
}

function normalizeCategoryPath(value: string) {
  return value
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/{2,}/g, "/")
    .replace(/^\/+|\/+$/g, "");
}

function isValidCategoryPath(categoryPath: string) {
  if (!categoryPath) {
    return false;
  }

  if (/[<>:"|?*\u0000-\u001f]/.test(categoryPath)) {
    return false;
  }

  return categoryPath
    .split("/")
    .every((segment) => Boolean(segment) && segment !== "." && segment !== "..");
}

function getFileExtension(fileName: string) {
  const match = fileName.toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] ?? "";
}

function isSupportedFile(fileName: string) {
  const extension = getFileExtension(fileName);
  return Boolean(extension) && SUPPORTED_FILE_EXTENSIONS.has(extension);
}

function buildFileScopeId(categoryPath: string, fileName: string) {
  return `${SHOWCASE_APP_ID}/${categoryPath}/${fileName}`;
}

function buildCategoryScopeId(categoryPath: string) {
  return `${SHOWCASE_APP_ID}/${categoryPath}/*`;
}

function parseScopeId(scopeId: string) {
  if (!scopeId.startsWith(`${SHOWCASE_APP_ID}/`)) {
    return null;
  }

  const relativePath = scopeId.slice(`${SHOWCASE_APP_ID}/`.length);

  if (!relativePath) {
    return null;
  }

  if (relativePath === "*") {
    return { type: "app" as const, categoryPath: "", fileName: "" };
  }

  if (relativePath.endsWith("/*")) {
    return {
      type: "category" as const,
      categoryPath: relativePath.slice(0, -2),
      fileName: "",
    };
  }

  const parts = relativePath.split("/");
  if (parts.length < 2) {
    return null;
  }

  return {
    type: "file" as const,
    categoryPath: parts.slice(0, -1).join("/"),
    fileName: parts.at(-1) ?? "",
  };
}

function getScopeLabel(scopeId: string) {
  if (scopeId === APP_SCOPE_ID) {
    return `All files in ${SHOWCASE_APP_ID}`;
  }

  const parsed = parseScopeId(scopeId);
  if (!parsed) {
    return scopeId;
  }

  if (parsed.type === "category") {
    return parsed.categoryPath;
  }

  if (parsed.type === "file") {
    return `${parsed.categoryPath} / ${parsed.fileName}`;
  }

  return `All files in ${SHOWCASE_APP_ID}`;
}

function getFilesForScope(scopeId: string, catalog: ScopedImportedFile[]) {
  if (scopeId === APP_SCOPE_ID) {
    return [...catalog];
  }

  const parsed = parseScopeId(scopeId);
  if (!parsed) {
    return [];
  }

  if (parsed.type === "category") {
    const categoryPrefix = `${SHOWCASE_APP_ID}/${parsed.categoryPath}/`;
    return catalog.filter((file) => file.scopeId.startsWith(categoryPrefix));
  }

  if (parsed.type === "file") {
    return catalog.filter((file) => file.scopeId === scopeId);
  }

  return [];
}

function buildScopeOptions(catalog: ScopedImportedFile[]): ScopeOption[] {
  if (!catalog.length) {
    return [];
  }

  const categoryOptions = Array.from(
    new Set(catalog.map((file) => file.categoryPath)),
  )
    .sort((left, right) => left.localeCompare(right))
    .map((categoryPath) => ({
      label: categoryPath,
      value: buildCategoryScopeId(categoryPath),
    }));

  const fileOptions = [...catalog]
    .sort(
      (left, right) =>
        left.categoryPath.localeCompare(right.categoryPath) ||
        left.fileName.localeCompare(right.fileName),
    )
    .map((file) => ({
      label: `${file.categoryPath} / ${file.fileName}`,
      value: file.scopeId,
    }));

  return [
    {
      label: `All files in ${SHOWCASE_APP_ID}`,
      value: APP_SCOPE_ID,
    },
    ...categoryOptions,
    ...fileOptions,
  ];
}

function normalizeScopedImportedFile(value: unknown): ScopedImportedFile | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const fileName = extractFirstString([record.fileName, record.name]);
  const explicitScopeId = extractFirstString([record.scopeId, record.scope_id]);
  const explicitCategoryPath = extractFirstString([
    record.categoryPath,
    record.category_path,
  ]);
  const parsedScope = explicitScopeId ? parseScopeId(explicitScopeId) : null;
  const categoryPath =
    explicitCategoryPath ||
    (parsedScope?.type === "file" ? parsedScope.categoryPath : "") ||
    (fileName ? "Imported" : "");
  const scopeId =
    explicitScopeId ||
    (fileName && categoryPath ? buildFileScopeId(categoryPath, fileName) : "");

  if (!fileName || !scopeId || !categoryPath) {
    return null;
  }

  return {
    localId: extractFirstString([record.localId, record.id]) || createThreadId("import-ref"),
    fileName,
    categoryPath,
    scopeId,
    importId: extractFirstString([record.importId, record.import_id]),
    uploadedAt:
      extractFirstString([record.uploadedAt, record.uploaded_at]) ||
      new Date(0).toISOString(),
    processingStatus: extractFirstString([
      record.processingStatus,
      record.processing_status,
      record.status,
    ]),
    fileType: extractFirstString([record.fileType, record.file_type]),
    fileSize: typeof record.fileSize === "number" ? record.fileSize : 0,
  };
}

function buildImportedFileRecord({
  file,
  categoryPath,
  scopeId,
  importId,
  processingStatus,
}: {
  file: File;
  categoryPath: string;
  scopeId: string;
  importId: string;
  processingStatus: string;
}): ScopedImportedFile {
  return {
    localId: createThreadId("import-ref"),
    fileName: file.name,
    categoryPath,
    scopeId,
    importId,
    uploadedAt: new Date().toISOString(),
    processingStatus,
    fileType: file.type,
    fileSize: file.size,
  };
}

function buildImportDefaultMessage(catalogLength: number) {
  if (!catalogLength) {
    return `Upload one or more files into ${SHOWCASE_APP_ID}.`;
  }

  return "Ask a one-off question using the selected scope.";
}

function formatImportTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown upload time";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatJson(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function extractImportId(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "";
  }

  const record = value as Record<string, unknown>;
  const direct = extractFirstString([
    record.id,
    record.import_id,
    record.importId,
    record.upload_id,
    record.uploadId,
  ]);
  if (direct) {
    return direct;
  }

  return extractFirstString([
    extractImportId(record.data),
    extractImportId(record.result),
    extractImportId(record.file),
    extractImportId(record.payload),
    extractImportId(record.body),
  ]);
}

function extractProcessingStatus(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "";
  }

  const record = value as Record<string, unknown>;
  const direct = extractFirstString([
    record.processing_status,
    record.processingStatus,
    record.status,
    record.state,
  ]);
  if (direct) {
    return direct;
  }

  return (
    extractProcessingStatus(record.data) ||
    extractProcessingStatus(record.result) ||
    extractProcessingStatus(record.file) ||
    extractProcessingStatus(record.payload) ||
    extractProcessingStatus(record.body)
  );
}

function extractFirstString(values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return "";
}

function getQuizResponse(response: OrchestratorResponse, mode: GenerationMode) {
  if (mode === "study-sheet" || mode === "import") {
    return null;
  }

  if (isQuizResponse(response.structuredResponse)) {
    return response.structuredResponse;
  }

  return hasInterrupt(response) ? null : response.quizResponse;
}

function QuizPreview({ quiz }: { quiz: QuizResponse }) {
  const letters = ["A", "B", "C", "D"] as const;
  const [questionIndex, setQuestionIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  const [score, setScore] = useState(0);
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    setQuestionIndex(0);
    setSelectedAnswer(null);
    setFeedback("");
    setScore(0);
    setFinished(false);
  }, [quiz]);

  const question = quiz.Questions[questionIndex];
  const correctIndex = letters.indexOf(question?.CorrectAnswer ?? "A");
  const correctAnswerText = question?.Answers[correctIndex] ?? "";
  const answered = selectedAnswer !== null;

  if (!question) {
    return null;
  }

  if (finished) {
    return (
      <section className="quiz-shell" aria-label="Quiz output">
        <div className="quiz-header">
          <h2 className="quiz-label">Quizzes</h2>
          <span className="quiz-status">Finished</span>
        </div>
        <div className="quiz-card">
          <p className="quiz-score">
            You got {score} out of {quiz.Questions.length} correct.
          </p>
          <button
            className="quiz-restart"
            type="button"
            onClick={() => {
              setQuestionIndex(0);
              setSelectedAnswer(null);
              setFeedback("");
              setScore(0);
              setFinished(false);
            }}
          >
            Restart Quiz
          </button>
        </div>
      </section>
    );
  }

  const handleAnswer = (answer: string) => {
    if (answered) {
      return;
    }

    setSelectedAnswer(answer);
    const isCorrect = answer === question.CorrectAnswer;
    setFeedback(isCorrect ? "Correct" : "Incorrect");

    if (isCorrect) {
      setScore((current) => current + 1);
    }
  };

  const handleNext = () => {
    if (questionIndex === quiz.Questions.length - 1) {
      setFinished(true);
      return;
    }

    setQuestionIndex((current) => current + 1);
    setSelectedAnswer(null);
    setFeedback("");
  };

  return (
    <section className="quiz-shell" aria-label="Quiz output">
      <div className="quiz-header">
        <h2 className="quiz-label">Quizzes</h2>
        <span className="quiz-status">
          Question {questionIndex + 1} of {quiz.Questions.length}
        </span>
      </div>
      <div className="quiz-card">
        <div className="quiz-question-panel">
          <p className="quiz-question-title">{question.QuestionTitle}</p>
          <div className="quiz-answer-grid">
            {letters.map((letter, index) => {
              const answer = question.Answers[index] ?? "";
              return (
                <button
                  key={letter}
                  className="quiz-answer-button"
                  type="button"
                  onClick={() => handleAnswer(letter)}
                  disabled={answered}
                >
                  <span className="quiz-answer-letter">{letter}</span>
                  <span>{answer}</span>
                </button>
              );
            })}
          </div>
          {feedback ? (
            <div
              className={`quiz-feedback quiz-feedback-${feedback.toLowerCase()}`}
            >
              <p>{feedback}</p>
              {feedback === "Incorrect" ? (
                <p>
                  Correct answer: {question.CorrectAnswer}. {correctAnswerText}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="quiz-footer">
          {answered ? (
            <button className="quiz-next" type="button" onClick={handleNext}>
              Next
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}

export default function Page() {
  const [topic, setTopic] = useState("");
  const [mode, setMode] = useState<GenerationMode>("quiz");
  const [selectedUploadFiles, setSelectedUploadFiles] = useState<File[]>([]);
  const [uploadInputKey, setUploadInputKey] = useState(0);
  const [uploadCategory, setUploadCategory] = useState("Category1");
  const [importQuestion, setImportQuestion] = useState("");
  const [selectedScopeId, setSelectedScopeId] = useState(APP_SCOPE_ID);
  const [importCatalog, setImportCatalog] = useState<ScopedImportedFile[]>([]);
  const [scopedAnswer, setScopedAnswer] = useState<ScopedAnswer | null>(null);
  const [importOutput, setImportOutput] = useState(buildImportDefaultMessage(0));
  const [hasLoadedImportCatalog, setHasLoadedImportCatalog] = useState(false);
  const [output, setOutput] = useState(
    "Enter a topic to generate the first study sheet draft.",
  );
  const [quizResponse, setQuizResponse] = useState<QuizResponse | null>(null);
  const [flowState, setFlowState] = useState<
    | "idle"
    | "generating"
    | "waiting"
    | "creatingPdf"
    | "complete"
    | "importing"
    | "queryingImport"
  >("idle");
  const [downloadUrl, setDownloadUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [needsConfirmation, setNeedsConfirmation] = useState(false);
  const [pendingInterrupt, setPendingInterrupt] =
    useState<SkillInterruptPayload | null>(null);
  const [pendingInterruptNodeId, setPendingInterruptNodeId] = useState("");
  const [showDownloadLink, setShowDownloadLink] = useState(false);
  const [confirmMessage, setConfirmMessage] = useState(
    "A study sheet has been created. Do you want to make a printable PDF?",
  );

  const [threadId] = useState(() => createThreadId("study-sheet"));
  const [traceId] = useState(() => createThreadId("trace"));

  const scopeOptions = buildScopeOptions(importCatalog);
  const categoryCount = new Set(importCatalog.map((file) => file.categoryPath))
    .size;
  const categoryPaths = Array.from(
    new Set(importCatalog.map((file) => file.categoryPath)),
  ).sort((left, right) => left.localeCompare(right));
  const selectedScopeLabel = selectedScopeId
    ? getScopeLabel(selectedScopeId)
    : "";
  const selectedScopeFiles = selectedScopeId
    ? getFilesForScope(selectedScopeId, importCatalog)
    : [];
  const normalizedUploadCategory = normalizeCategoryPath(uploadCategory);

  useEffect(() => {
    const rawCatalog = window.localStorage.getItem(IMPORT_CATALOG_STORAGE_KEY);

    if (!rawCatalog) {
      setImportOutput(buildImportDefaultMessage(0));
      setHasLoadedImportCatalog(true);
      return;
    }

    try {
      const parsed = JSON.parse(rawCatalog) as unknown;
      const nextCatalog = Array.isArray(parsed)
        ? parsed
            .map((entry) => normalizeScopedImportedFile(entry))
            .filter((entry): entry is ScopedImportedFile => Boolean(entry))
        : [];

      setImportCatalog(nextCatalog);
      setImportOutput(buildImportDefaultMessage(nextCatalog.length));
    } catch {
      setImportCatalog([]);
      setImportOutput(buildImportDefaultMessage(0));
    } finally {
      setHasLoadedImportCatalog(true);
    }
  }, []);

  useEffect(() => {
    if (!hasLoadedImportCatalog) {
      return;
    }

    window.localStorage.setItem(
      IMPORT_CATALOG_STORAGE_KEY,
      JSON.stringify(importCatalog),
    );
  }, [hasLoadedImportCatalog, importCatalog]);

  useEffect(() => {
    if (!importCatalog.length) {
      if (selectedScopeId !== APP_SCOPE_ID) {
        setSelectedScopeId(APP_SCOPE_ID);
      }
      return;
    }

    const scopeIds = new Set(scopeOptions.map((option) => option.value));

    if (!selectedScopeId || !scopeIds.has(selectedScopeId)) {
      setSelectedScopeId(APP_SCOPE_ID);
    }
  }, [importCatalog, scopeOptions, selectedScopeId]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void handleCreate();
  };

  const handleScopedUpload = async () => {
    const categoryPath = normalizeCategoryPath(uploadCategory);

    if (!selectedUploadFiles.length) {
      setImportOutput("Choose at least one file before uploading.");
      return;
    }

    if (!categoryPath) {
      setImportOutput("Enter a category before uploading files.");
      return;
    }

    if (!isValidCategoryPath(categoryPath)) {
      setImportOutput(
        "Category names can use letters, numbers, spaces, hyphens, underscores, and nested / separators only.",
      );
      return;
    }

    const duplicateUploads = new Set<string>();
    const plannedScopeIds = new Set<string>();

    for (const file of selectedUploadFiles) {
      if (!isSupportedFile(file.name)) {
        setImportOutput(
          `Unsupported file type for ${file.name}. Allowed extensions: ${Array.from(SUPPORTED_FILE_EXTENSIONS).sort().join(", ")}.`,
        );
        return;
      }

      const scopeId = buildFileScopeId(categoryPath, file.name);
      if (
        importCatalog.some((record) => record.scopeId === scopeId) ||
        plannedScopeIds.has(scopeId)
      ) {
        duplicateUploads.add(file.name);
      }

      plannedScopeIds.add(scopeId);
    }

    if (duplicateUploads.size) {
      setImportOutput(
        `Duplicate filenames are not allowed in the same category. Conflicts: ${Array.from(duplicateUploads).join(", ")}.`,
      );
      return;
    }

    setIsLoading(true);
    setFlowState("importing");
    setImportOutput(
      `Uploading ${selectedUploadFiles.length} file${selectedUploadFiles.length === 1 ? "" : "s"} into ${SHOWCASE_APP_ID}/${categoryPath}...`,
    );

    const successfulUploads: ScopedImportedFile[] = [];
    const eventResponses: Array<{
      fileName: string;
      importId: string;
      events: unknown;
    }> = [];
    const failures: string[] = [];

    for (const file of selectedUploadFiles) {
      const scopeId = buildFileScopeId(categoryPath, file.name);
      const formData = new FormData();
      formData.append("file", file, file.name);
      formData.append("scopeId", scopeId);

      try {
        const response = await fetch("/api/imports", {
          method: "POST",
          body: formData,
        });

        const responseText = await response.text();
        let body: Record<string, unknown> = {};

        if (responseText) {
          try {
            body = JSON.parse(responseText) as Record<string, unknown>;
          } catch {
            body = { message: responseText };
          }
        }

        if (!response.ok) {
          throw new Error(
            typeof body.error === "string"
              ? body.error
              : typeof body.message === "string"
                ? body.message
                : `Import request failed with status ${response.status}.`,
          );
        }

        const importId = extractImportId(body);
        const importedRecord = buildImportedFileRecord({
          file,
          categoryPath,
          scopeId,
          importId,
          processingStatus: extractProcessingStatus(body) || "pending",
        });

        successfulUploads.push(importedRecord);

        if (importId) {
          const eventsResponse = await fetch(
            `/api/imports/${importId}/events?scopeId=${encodeURIComponent(scopeId)}`,
            {
              method: "GET",
              cache: "no-store",
            },
          );
          const eventsText = await eventsResponse.text();
          let eventsBody: unknown = {};

          if (eventsText) {
            try {
              eventsBody = JSON.parse(eventsText) as unknown;
            } catch {
              eventsBody = { raw: eventsText };
            }
          }

          if (!eventsResponse.ok) {
            throw new Error(
              typeof eventsBody === "object" &&
                eventsBody &&
                "error" in (eventsBody as Record<string, unknown>) &&
                typeof (eventsBody as Record<string, unknown>).error === "string"
                ? String((eventsBody as Record<string, unknown>).error)
                : `Events request failed with status ${eventsResponse.status}.`,
            );
          }

          eventResponses.push({
            fileName: file.name,
            importId,
            events: eventsBody,
          });
        }
      } catch (error) {
        failures.push(
          `${file.name}: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
      }
    }

    if (successfulUploads.length) {
      setImportCatalog((current) => {
        const nextByScope = new Map(current.map((record) => [record.scopeId, record]));

        for (const record of successfulUploads) {
          nextByScope.set(record.scopeId, record);
        }

        return Array.from(nextByScope.values()).sort(
          (left, right) =>
            right.uploadedAt.localeCompare(left.uploadedAt) ||
            left.scopeId.localeCompare(right.scopeId),
        );
      });
      setSelectedScopeId(buildCategoryScopeId(categoryPath));
      setSelectedUploadFiles([]);
      setUploadInputKey((current) => current + 1);
    }

    setFlowState("complete");
    setIsLoading(false);

    if (successfulUploads.length && failures.length) {
      setImportOutput(
        `${formatJson(eventResponses.length === 1 ? eventResponses[0]?.events ?? {} : eventResponses)}\n\nFailures: ${failures.join(" ")}`,
      );
      return;
    }

    if (successfulUploads.length) {
      setImportOutput(
        formatJson(
          eventResponses.length === 1 ? eventResponses[0]?.events ?? {} : eventResponses,
        ),
      );
      return;
    }

    setImportOutput(`Upload failed. ${failures.join(" ")}`);
  };

  const handleImportLookup = async () => {
    const trimmedQuestion = importQuestion.trim();

    if (!importCatalog.length) {
      setImportOutput("Please upload at least one file before asking a question.");
      return;
    }

    if (!selectedScopeId) {
      setImportOutput("Please select a file or category to use as context.");
      return;
    }

    if (!trimmedQuestion) {
      setImportOutput("Enter a question before asking using the selected scope.");
      return;
    }

    if (!selectedScopeFiles.length) {
      setImportOutput("No files were found for the selected scope.");
      return;
    }

    setIsLoading(true);
    setFlowState("queryingImport");
    setScopedAnswer(null);
    setImportOutput(`Asking a one-off question using ${selectedScopeId}...`);

    try {
      const lookupResponse = await runOrchestratorPrompt({
        threadId: createThreadId("scoped-qa"),
        traceId: createThreadId("trace"),
        scopeId: selectedScopeId,
        input: buildScopedRetrievalPrompt({
          question: trimmedQuestion,
          scopeId: selectedScopeId,
          scopeLabel: selectedScopeLabel,
          files: selectedScopeFiles,
        }),
      });

      const answer =
        lookupResponse.message ||
        lookupResponse.text ||
        lookupResponse.studySheet ||
        "The orchestrator returned no response.";

      setScopedAnswer({
        scopeId: selectedScopeId,
        scopeLabel: selectedScopeLabel,
        question: trimmedQuestion,
        answer,
        sourceNames: selectedScopeFiles.map((file) => file.fileName),
      });
      setImportOutput("Answer generated from the selected scope.");
      setFlowState("complete");
    } catch (error) {
      setImportOutput(
        `Scoped retrieval failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
      setFlowState("complete");
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreate = async () => {
    const trimmed = topic.trim();

    if (!trimmed) {
      setOutput(
        "Enter a topic before asking the agent to create a study sheet.",
      );
      return;
    }

    setIsLoading(true);
    setFlowState("generating");
    setShowDownloadLink(false);
    setDownloadUrl("");
    setNeedsConfirmation(false);
    setPendingInterrupt(null);
    setPendingInterruptNodeId("");
    setQuizResponse(null);
    setOutput(
      mode === "quiz" ? "Creating the quiz..." : "Creating the study sheet...",
    );

    try {
      const response: OrchestratorResponse = await runOrchestratorPrompt({
        threadId,
        input: buildPrompt(trimmed, mode),
        traceId,
      });

      setOutput(
        mode === "quiz"
          ? response.downloadUrl
            ? "Your Downloadable PDF is below"
            : response.studySheet ||
              response.text ||
              "The agent returned no study sheet text."
          : response.studySheet ||
              response.text ||
              response.message ||
              "The agent returned no study sheet text.",
      );
      setConfirmMessage(
        response.waitingForInput
          ? "Skill export to pdf is waiting for human input at node Interrupt."
          : response.message ||
              "A study sheet has been created. Do you want to make a printable PDF?",
      );
      setNeedsConfirmation(response.waitingForInput);
      setPendingInterrupt(response.waitingForInput ? response.interrupt : null);
      setPendingInterruptNodeId(
        response.waitingForInput
          ? response.interruptNodeId || response.interrupt?.node || ""
          : "",
      );
      setQuizResponse(
        hasInterrupt(response) ? null : getQuizResponse(response, mode),
      );
      setFlowState(response.waitingForInput ? "waiting" : "idle");

      if (!response.waitingForInput && response.downloadUrl) {
        setDownloadUrl(response.downloadUrl);
        setShowDownloadLink(true);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setFlowState("idle");
      setOutput(`Study sheet generation failed: ${message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const applyConfirmationResponse = (
    response: OrchestratorResponse,
    confirmation: "yes" | "no",
  ) => {
    const nextDownloadUrl = response.downloadUrl || "";

    setDownloadUrl(nextDownloadUrl);
    setShowDownloadLink(Boolean(nextDownloadUrl));
    if (hasInterrupt(response)) {
      setFlowState("waiting");
      setNeedsConfirmation(true);
      setPendingInterrupt(response.interrupt);
      setPendingInterruptNodeId(
        response.interruptNodeId || response.interrupt?.node || "",
      );
      setQuizResponse(null);
      setConfirmMessage(
        response.message ||
          "Skill export to pdf is waiting for human input at node Interrupt.",
      );
      setOutput(response.message || "Creating the printable PDF...");
      return;
    }

    setQuizResponse(getQuizResponse(response, mode));
    setFlowState(nextDownloadUrl ? "complete" : "creatingPdf");
    setOutput(
      confirmation === "no"
        ? response.studySheet ||
            response.text ||
            response.message ||
            "The PDF export is still processing. The workflow has not produced a download link yet."
        : mode === "quiz"
          ? response.downloadUrl
            ? "Your Downloadable PDF is below"
            : response.message ||
              response.text ||
              "The PDF export is still processing. The workflow has not produced a download link yet."
          : response.studySheet ||
            response.text ||
            response.message ||
            "The PDF export is still processing. The workflow has not produced a download link yet.",
    );
  };

  const handleConfirmation = async (resumeData: "yes" | "no") => {
    const interrupt = pendingInterrupt;
    const interruptNodeId = pendingInterruptNodeId || interrupt?.node || "";

    if (!interrupt || !interruptNodeId) {
      setFlowState("idle");
      setNeedsConfirmation(false);
      setOutput(
        "PDF generation failed: the paused workflow did not return an active interrupt node to resume.",
      );
      return;
    }

    setIsLoading(true);
    setFlowState("creatingPdf");
    setNeedsConfirmation(false);
    setPendingInterrupt(null);
    setPendingInterruptNodeId("");
    setQuizResponse(null);
    setConfirmMessage("Creating the printable PDF...");
    setOutput(
      resumeData === "yes"
        ? "Creating the printable PDF..."
        : "Sending no response to the orchestrator...",
    );

    try {
      const response: OrchestratorResponse = await runOrchestratorPrompt({
        threadId,
        input: "",
        traceId,
        resumeSkillInterrupt: {
          interrupt: {
            ...interrupt,
            node: interruptNodeId,
            interrupt_node_id: interruptNodeId,
          },
          resumeData,
        },
      });

      applyConfirmationResponse(response, resumeData);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setFlowState("idle");
      setPendingInterrupt(interrupt);
      setPendingInterruptNodeId(interruptNodeId);
      setNeedsConfirmation(true);
      setOutput(`PDF generation failed: ${message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirmYes = () => {
    void handleConfirmation("yes");
  };

  const handleConfirmNo = () => {
    void handleConfirmation("no");
  };

  const handleClearUploadedFiles = () => {
    setImportCatalog([]);
    setSelectedScopeId(APP_SCOPE_ID);
    setSelectedUploadFiles([]);
    setUploadInputKey((current) => current + 1);
    setImportQuestion("");
    setScopedAnswer(null);
    setFlowState("idle");
    setImportOutput(buildImportDefaultMessage(0));
    window.localStorage.removeItem(IMPORT_CATALOG_STORAGE_KEY);
  };

  return (
    <main className="landing-shell">
      <section
        className={`hero-page ${mode === "import" ? "hero-page-import" : ""}`}
        aria-label="Study sheet builder"
      >
        <div
          className={`hero-stack ${mode === "import" ? "hero-stack-import" : ""}`}
        >
          <PythonMark />

          <p className="hero-kicker">Study Sheet Builder</p>

          <h1>
            {mode === "import"
              ? "One question. One scope."
              : "What topic do you want the agent to turn into a study sheet?"}
          </h1>

          {mode === "import" ? (
            <p className="import-hero-copy">Choose a scope and ask once.</p>
          ) : null}

          <div
            className="mode-switch"
            role="tablist"
            aria-label="Generation mode"
          >
            <button
              className={`mode-switch-option ${mode === "study-sheet" ? "is-active" : ""}`}
              type="button"
              role="tab"
              aria-selected={mode === "study-sheet"}
              onClick={() => setMode("study-sheet")}
            >
              Study Sheet
            </button>
            <button
              className={`mode-switch-option ${mode === "quiz" ? "is-active" : ""}`}
              type="button"
              role="tab"
              aria-selected={mode === "quiz"}
              onClick={() => setMode("quiz")}
            >
              Quiz
            </button>
            <button
              className={`mode-switch-option ${mode === "import" ? "is-active" : ""}`}
              type="button"
              role="tab"
              aria-selected={mode === "import"}
              onClick={() => setMode("import")}
            >
              Import
            </button>
          </div>

          {mode === "import" ? (
            <section
              className="output-shell output-shell-import"
              aria-label="Scoped retrieval output"
            >
              <div className="output-header">
                <span className="output-label">Scoped Retrieval</span>
                <span className="output-status">
                  {flowState === "importing"
                    ? "Uploading..."
                    : flowState === "queryingImport"
                      ? "Answering..."
                      : "Ready"}
                </span>
              </div>
              <div className="output-card scoped-workbench">
                <div className="scope-studio">
                  <div className="scope-studio-grid">
                    <div className="scope-upload-column">
                      <section className="scoped-panel scoped-panel-accent scope-upload-panel">
                        <div className="scoped-panel-header">
                          <div>
                            <h2>Add files</h2>
                          </div>
                        </div>
                        <div className="upload-composer">
                          <div className="upload-controls">
                            <label className="scoped-field">
                              <span>Category or directory</span>
                              <input
                                className="scoped-input"
                                value={uploadCategory}
                                onChange={(event) =>
                                  setUploadCategory(event.target.value)
                                }
                                placeholder="Category1 or Category1/SubcategoryA"
                                aria-label="Upload category"
                              />
                            </label>
                          </div>
                          <div className="upload-preview-stack upload-preview-clean">
                            <label className="scoped-field">
                              <span>Files</span>
                              <input
                                key={uploadInputKey}
                                className="prompt-file-input"
                                type="file"
                                multiple
                                aria-label="Upload files"
                                onChange={(event) =>
                                  setSelectedUploadFiles(
                                  Array.from(event.target.files ?? []),
                                )
                              }
                            />
                            </label>
                          </div>
                        </div>
                        <div className="upload-actions">
                          <button
                            className="download-link scoped-action scoped-primary-action"
                            type="button"
                            onClick={() => void handleScopedUpload()}
                            disabled={isLoading}
                          >
                            Upload selected files
                          </button>
                          <div className="upload-scope-preview">
                            <span className="scope-preview-label">
                              Scope-ID preview
                            </span>
                            <span className="upload-scope-preview-text">
                              {selectedUploadFiles.length
                                ? normalizedUploadCategory &&
                                  isValidCategoryPath(normalizedUploadCategory)
                                  ? buildFileScopeId(
                                      normalizedUploadCategory,
                                      selectedUploadFiles[0].name,
                                    )
                                  : `${SHOWCASE_APP_ID}/[category]/${selectedUploadFiles[0].name}`
                                : normalizedUploadCategory
                                  ? `${SHOWCASE_APP_ID}/${normalizedUploadCategory}/file.ext`
                                  : `${SHOWCASE_APP_ID}/Category1/file.ext`}
                            </span>
                          {selectedUploadFiles.length > 1 ? (
                            <span className="scope-preview-empty">
                              +{selectedUploadFiles.length - 1} more file
                              {selectedUploadFiles.length - 1 === 1 ? "" : "s"}
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <div className="import-debug-card">
                        <p className="scope-preview-label">Upload response</p>
                        <pre className="import-debug-output">{importOutput}</pre>
                      </div>
                    </section>

                      <section className="scoped-panel scope-library-panel">
                        <div className="scoped-panel-header">
                          <div>
                            <h2>View uploaded files</h2>
                          </div>
                          <button
                            className="catalog-chip catalog-chip-utility"
                            type="button"
                            onClick={handleClearUploadedFiles}
                            disabled={!importCatalog.length}
                          >
                            Clear uploaded files
                          </button>
                        </div>
                        {importCatalog.length ? (
                          <div className="library-groups">
                            {categoryPaths.map((categoryPath) => {
                              const categoryScopeId =
                                buildCategoryScopeId(categoryPath);
                              const categoryFiles = importCatalog.filter(
                                (record) => record.categoryPath === categoryPath,
                              );

                              return (
                                <section
                                  key={categoryPath}
                                  className="library-group"
                                >
                                  <div className="library-group-header">
                                    <button
                                      className={`library-group-title ${selectedScopeId === categoryScopeId ? "is-selected" : ""}`}
                                      type="button"
                                      onClick={() =>
                                        setSelectedScopeId(categoryScopeId)
                                      }
                                    >
                                      {categoryPath}
                                    </button>
                                    <span className="catalog-card-meta">
                                      {categoryFiles.length} file
                                      {categoryFiles.length === 1 ? "" : "s"}
                                    </span>
                                  </div>
                                  <div className="library-file-list">
                                    {categoryFiles.map((record) => (
                                      <button
                                        key={record.localId}
                                        className={`catalog-card ${selectedScopeId === record.scopeId ? "is-selected" : ""}`}
                                        type="button"
                                        onClick={() =>
                                          setSelectedScopeId(record.scopeId)
                                        }
                                      >
                                        <span className="catalog-card-title">
                                          {record.fileName}
                                        </span>
                                        <span className="catalog-card-meta">
                                          {record.scopeId}
                                        </span>
                                        <span className="catalog-card-meta">
                                          {formatImportTimestamp(
                                            record.uploadedAt,
                                          )}
                                        </span>
                                      </button>
                                    ))}
                                  </div>
                                </section>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="scope-preview-card">
                            <p className="scope-preview-label">Uploads</p>
                            <p className="scope-preview-empty">
                              No files uploaded to {SHOWCASE_APP_ID} yet.
                            </p>
                          </div>
                        )}
                      </section>
                    </div>

                    <section className="scoped-panel scope-query-panel">
                      <div className="scoped-panel-header">
                        <div>
                          <h2>Choose scope and run one question</h2>
                        </div>
                      </div>
                      <div className="scope-selector-block">
                        <label className="scoped-field">
                          <span>Retrieval scope</span>
                          <select
                            className="scoped-select"
                            value={selectedScopeId}
                            onChange={(event) =>
                              setSelectedScopeId(event.target.value)
                            }
                            aria-label="Retrieval scope"
                          >
                            {scopeOptions.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <div className="scope-focus-card">
                        <div>
                          <div>
                            <p className="scope-preview-label">
                              Current context
                            </p>
                            <p className="scope-focus-title">
                              {selectedScopeLabel ||
                                `All files in ${SHOWCASE_APP_ID}`}
                            </p>
                            <p className="scope-preview-empty">
                              {selectedScopeId || APP_SCOPE_ID}
                            </p>
                          </div>
                        </div>
                      </div>
                      <div className="panel-divider" />
                      <div className="scoped-form-grid">
                        <div className="panel-subhead">
                          <h3>Question</h3>
                        </div>
                        <label className="scoped-field">
                          <textarea
                            className="scoped-textarea scoped-textarea-large"
                            value={importQuestion}
                            onChange={(event) =>
                              setImportQuestion(event.target.value)
                            }
                            placeholder="What does the elephants document say about habitat?"
                            aria-label="Question about selected scope"
                          />
                        </label>
                        <button
                          className="download-link scoped-action scoped-primary-action scoped-primary-action-full"
                          type="button"
                          onClick={() => void handleImportLookup()}
                          disabled={isLoading}
                        >
                          Ask using selected scope
                        </button>
                        <div className="panel-subhead">
                          <h3>Answer</h3>
                        </div>
                        {scopedAnswer ? (
                          <div className="answer-card answer-card-active">
                            <div className="answer-meta-stack">
                              <p className="answer-meta">
                                <strong>Question:</strong>{" "}
                                {scopedAnswer.question}
                              </p>
                              <p className="answer-meta">
                                <strong>Scope:</strong> {scopedAnswer.scopeId}
                              </p>
                              <p className="answer-meta">
                                <strong>Source files:</strong>{" "}
                                {scopedAnswer.sourceNames.join(", ")}
                              </p>
                            </div>
                            <div className="answer-copy markdown-output">
                              <MarkdownText content={scopedAnswer.answer} />
                            </div>
                          </div>
                        ) : (
                          <div className="answer-card answer-card-empty">
                            <p className="catalog-empty">
                              Ask a question and the grounded answer will appear
                              here.
                            </p>
                          </div>
                        )}
                      </div>
                    </section>
                  </div>
                </div>
              </div>
            </section>
          ) : (
            <>
              <form className="prompt-shell" onSubmit={handleSubmit}>
                <div className="prompt-icon" aria-hidden="true">
                  ◔
                </div>
                <input
                  className="prompt-input"
                  value={topic}
                  onChange={(event) => setTopic(event.target.value)}
                  placeholder="Enter a topic like Python lists, loops, or functions..."
                  aria-label="Topic"
                />
                <button
                  className="prompt-submit"
                  type="submit"
                  disabled={isLoading}
                  aria-label="Send topic"
                >
                  <SendIcon />
                </button>
              </form>

              <section
                className="output-shell"
                aria-label={mode === "quiz" ? "Quiz output" : "Study sheet output"}
              >
                <div className="output-header">
                  <span className="output-label">
                    {mode === "quiz" ? "Quiz" : "Output"}
                  </span>
                  <span className="output-status">
                    {flowState === "generating"
                      ? "Generating study sheet..."
                      : flowState === "waiting"
                        ? "Waiting for confirmation..."
                        : flowState === "creatingPdf"
                          ? "Creating PDF..."
                          : flowState === "complete"
                            ? "Complete"
                            : "Ready"}
                  </span>
                </div>
                <div className="output-card">
                  {mode !== "quiz" ? (
                    <>
                      <p className="output-title">Study sheet preview</p>
                      <div className="output-copy markdown-output">
                        <MarkdownText content={output} />
                      </div>
                    </>
                  ) : null}
                  {showDownloadLink ? (
                    <div className="download-row">
                      <span className="download-label">Printable PDF link</span>
                      {downloadUrl ? (
                        <a
                          className="download-link"
                          href={downloadUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Download your PDF
                        </a>
                      ) : (
                        <span className="download-link download-link-disabled">
                          Download link pending
                        </span>
                      )}
                    </div>
                  ) : null}
                  {mode === "quiz" && quizResponse ? (
                    <QuizPreview quiz={quizResponse} />
                  ) : null}
                </div>
              </section>
            </>
          )}
        </div>
      </section>

      {needsConfirmation ? (
        <div className="confirm-overlay" role="presentation">
          <section
            className="confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
          >
            <p className="confirm-eyebrow">Interrupt</p>
            <h2 id="confirm-title">Confirm PDF creation</h2>
            <div className="confirm-box">
              <p className="confirm-message">{confirmMessage}</p>
              <div className="confirm-actions">
                <button
                  className="confirm-yes"
                  type="button"
                  onClick={handleConfirmYes}
                  disabled={isLoading}
                >
                  Yes
                </button>
                <button
                  className="confirm-no"
                  type="button"
                  onClick={handleConfirmNo}
                  disabled={isLoading}
                >
                  No
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
