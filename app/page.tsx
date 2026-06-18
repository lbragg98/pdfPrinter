"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import type {
  OrchestratorResponse,
  QuizResponse,
  SkillInterruptPayload
} from "../lib/orchestrator";
import {
  createThreadId,
  runOrchestratorPrompt
} from "../lib/orchestrator";

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
  const blocks = content.trim().split(/\n\s*\n/).filter(Boolean);

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
                <li key={itemIndex}>{renderInline(line.replace(/^([-*]|\d+\.)\s+/, ""))}</li>
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
          <a key={`${index}-link`} href={linkMatch[2]} target="_blank" rel="noreferrer">
            {linkMatch[1]}
          </a>
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

type GenerationMode = "study-sheet" | "quiz";

function hasInterrupt(response: OrchestratorResponse) {
  return Boolean(
    response.interrupt ||
      response.interruptRequested ||
      response.waitingForInput ||
      response.interruptNodeId
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
      if (!question || typeof question !== "object" || Array.isArray(question)) {
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

  return `make a quiz about ${topic}`;
}

function getQuizResponse(response: OrchestratorResponse, mode: GenerationMode) {
  if (mode === "study-sheet") {
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
            <div className={`quiz-feedback quiz-feedback-${feedback.toLowerCase()}`}>
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
  const [output, setOutput] = useState(
    "Enter a topic to generate the first study sheet draft."
  );
  const [quizResponse, setQuizResponse] = useState<QuizResponse | null>(null);
  const [flowState, setFlowState] = useState<
    "idle" | "generating" | "waiting" | "creatingPdf" | "complete"
  >("idle");
  const [downloadUrl, setDownloadUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [needsConfirmation, setNeedsConfirmation] = useState(false);
  const [pendingInterrupt, setPendingInterrupt] = useState<SkillInterruptPayload | null>(null);
  const [pendingInterruptNodeId, setPendingInterruptNodeId] = useState("");
  const [showDownloadLink, setShowDownloadLink] = useState(false);
  const [confirmMessage, setConfirmMessage] = useState(
    "A study sheet has been created. Do you want to make a printable PDF?"
  );

  const [threadId] = useState(() => createThreadId("study-sheet"));
  const [traceId] = useState(() => createThreadId("trace"));

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void handleCreate();
  };

  const handleCreate = async () => {
    const trimmed = topic.trim();

    if (!trimmed) {
      setOutput("Enter a topic before asking the agent to create a study sheet.");
      return;
    }

    console.log("[page] create start", {
      traceId,
      threadId,
      topic: trimmed
    });

    setIsLoading(true);
    setFlowState("generating");
    setShowDownloadLink(false);
    setDownloadUrl("");
    setNeedsConfirmation(false);
    setPendingInterrupt(null);
    setPendingInterruptNodeId("");
    setQuizResponse(null);
    setOutput(mode === "quiz" ? "Creating the quiz..." : "Creating the study sheet...");

    try {
      const response: OrchestratorResponse = await runOrchestratorPrompt({
        threadId,
        input: buildPrompt(trimmed, mode),
        traceId
      });
      console.log("[page] create response", {
        traceId,
        waitingForInput: response.waitingForInput,
        downloadUrl: response.downloadUrl || "(missing)",
        messagePreview: response.message.slice(0, 200),
        studySheetPreview: response.studySheet.slice(0, 200)
      });
      if (response.waitingForInput) {
        console.log("[page] interrupt shown", {
          traceId,
          threadId,
          promptPreview: response.message.slice(0, 200)
        });
      }
      setOutput(
        mode === "quiz"
          ? response.downloadUrl
            ? "Your Downloadable PDF is below"
            : response.studySheet || response.text || "The agent returned no study sheet text."
          : response.studySheet ||
              response.text ||
              response.message ||
              "The agent returned no study sheet text."
      );
      setConfirmMessage(
        response.waitingForInput
          ? "Skill export to pdf is waiting for human input at node Interrupt."
          : response.message ||
            "A study sheet has been created. Do you want to make a printable PDF?"
      );
      setNeedsConfirmation(response.waitingForInput);
      setPendingInterrupt(response.waitingForInput ? response.interrupt : null);
      setPendingInterruptNodeId(
        response.waitingForInput
          ? response.interruptNodeId || response.interrupt?.node || ""
          : ""
      );
      setQuizResponse(hasInterrupt(response) ? null : getQuizResponse(response, mode));
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
    confirmation: "yes" | "no"
  ) => {
    const nextDownloadUrl = response.downloadUrl || "";

    console.log("[page] post-confirmation response", {
      traceId,
      confirmation,
      waitingForInput: response.waitingForInput,
      downloadUrl: response.downloadUrl || "(missing)",
      messagePreview: response.message.slice(0, 200),
      studySheetPreview: response.studySheet.slice(0, 200)
    });

    setDownloadUrl(nextDownloadUrl);
    setShowDownloadLink(Boolean(nextDownloadUrl));
    if (hasInterrupt(response)) {
      setFlowState("waiting");
      setNeedsConfirmation(true);
      setPendingInterrupt(response.interrupt);
      setPendingInterruptNodeId(response.interruptNodeId || response.interrupt?.node || "");
      setQuizResponse(null);
      setConfirmMessage(
        response.message ||
          "Skill export to pdf is waiting for human input at node Interrupt."
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
            "The PDF export is still processing. The workflow has not produced a download link yet."
    );
  };

  const handleConfirmation = async (resumeData: "yes" | "no") => {
    const interrupt = pendingInterrupt;
    const interruptNodeId = pendingInterruptNodeId || interrupt?.node || "";

    if (!interrupt || !interruptNodeId) {
      setFlowState("idle");
      setNeedsConfirmation(false);
      setOutput(
        "PDF generation failed: the paused workflow did not return an active interrupt node to resume."
      );
      return;
    }

    console.log(`[page] confirm ${resumeData}`, {
      traceId,
      threadId
    });

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
        : "Sending no response to the orchestrator..."
    );

    try {
      if (resumeData === "yes") {
        console.log("[page] confirmation accepted", {
          threadId,
          interruptNode: interruptNodeId
        });
      }

      const response: OrchestratorResponse = await runOrchestratorPrompt({
        threadId,
        input: "",
        traceId,
        resumeSkillInterrupt: {
          interrupt: {
            ...interrupt,
            node: interruptNodeId,
            interrupt_node_id: interruptNodeId
          },
          resumeData
        }
      });

      applyConfirmationResponse(response, resumeData);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.log(`[page] confirm ${resumeData} error`, { traceId, message });
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

  return (
    <main className="landing-shell">
      <section className="hero-page" aria-label="Study sheet builder">
        <div className="hero-stack">
          <PythonMark />

          <p className="hero-kicker">Study Sheet Builder</p>

          <h1>What topic do you want the agent to turn into a study sheet?</h1>

          <div className="mode-switch" role="tablist" aria-label="Generation mode">
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
          </div>

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
              <span className="output-label">{mode === "quiz" ? "Quiz" : "Output"}</span>
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
                    <a className="download-link" href={downloadUrl} target="_blank" rel="noreferrer">
                      Download your PDF
                    </a>
                  ) : (
                    <span className="download-link download-link-disabled">Download link pending</span>
                  )}
                </div>
              ) : null}
              {mode === "quiz" && quizResponse ? <QuizPreview quiz={quizResponse} /> : null}
            </div>
          </section>
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
