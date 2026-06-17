"use client";

import { useState } from "react";
import type { OrchestratorResponse, SkillInterruptPayload } from "../lib/orchestrator";
import {
  buildStudySheetPrompt,
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
      d="M4 12.2 19.5 4.8 15.9 20l-4.6-6.2-7.3-1.6Zm10.5 1.7 2.1-8.8-8.9 4.2 4.1.9 2.7 3.7Z"
      fill="currentColor"
    />
  </svg>
);

export default function Page() {
  const [topic, setTopic] = useState("");
  const [output, setOutput] = useState(
    "Enter a topic to generate the first study sheet draft."
  );
  const [flowState, setFlowState] = useState<
    "idle" | "generating" | "waiting" | "creatingPdf" | "complete"
  >("idle");
  const [downloadUrl, setDownloadUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [needsConfirmation, setNeedsConfirmation] = useState(false);
  const [pendingInterrupt, setPendingInterrupt] = useState<SkillInterruptPayload | null>(null);
  const [showDownloadLink, setShowDownloadLink] = useState(false);
  const [confirmMessage, setConfirmMessage] = useState(
    "A study sheet has been created. Do you want to make a printable PDF?"
  );

  const [threadId] = useState(() => createThreadId("study-sheet"));
  const [traceId] = useState(() => createThreadId("trace"));

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
    setOutput("Creating the study sheet...");

    try {
      const response: OrchestratorResponse = await runOrchestratorPrompt({
        threadId,
        input: buildStudySheetPrompt(trimmed),
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
      setOutput(response.studySheet || response.text || "The agent returned no study sheet text.");
      setConfirmMessage(
        response.message ||
          "A study sheet has been created. Do you want to make a printable PDF?"
      );
      setNeedsConfirmation(response.waitingForInput);
      setPendingInterrupt(response.waitingForInput ? response.interrupt : null);
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

  const handleConfirmYes = async () => {
    const interrupt = pendingInterrupt;

    if (!interrupt) {
      setFlowState("idle");
      setNeedsConfirmation(false);
      setOutput("PDF generation failed: the paused workflow did not return an interrupt payload to resume.");
      return;
    }

    console.log("[page] confirm yes", {
      traceId,
      threadId
    });

    setIsLoading(true);
    setFlowState("creatingPdf");
    setNeedsConfirmation(false);
    setPendingInterrupt(null);
    setConfirmMessage("Creating the printable PDF...");
    setOutput("Creating the printable PDF...");

    try {
      console.log("[page] confirmation accepted", { threadId, interruptNode: interrupt.node });
      const response: OrchestratorResponse = await runOrchestratorPrompt({
        threadId,
        input: "",
        traceId,
        resumeSkillInterrupt: {
          interrupt,
          resumeData: "yes"
        }
      });
      const nextDownloadUrl = response.downloadUrl || "";

      console.log("[page] post-confirmation response", {
        traceId,
        waitingForInput: response.waitingForInput,
        downloadUrl: response.downloadUrl || "(missing)",
        messagePreview: response.message.slice(0, 200),
        studySheetPreview: response.studySheet.slice(0, 200)
      });

      setDownloadUrl(nextDownloadUrl);
      setShowDownloadLink(Boolean(nextDownloadUrl));
      setFlowState(nextDownloadUrl ? "complete" : "creatingPdf");
      setOutput(
        response.downloadUrl
          ? response.message ||
          response.text ||
          "The printable PDF is ready. The agent would provide the download link here."
          : response.message ||
            response.text ||
            "The PDF export is still processing. The workflow has not produced a download link yet."
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.log("[page] confirm yes error", { traceId, message });
      setFlowState("idle");
      setPendingInterrupt(interrupt);
      setNeedsConfirmation(true);
      setOutput(`PDF generation failed: ${message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirmNo = () => {
    console.log("[page] confirm no", {
      traceId,
      threadId
    });

    setFlowState("idle");
    setNeedsConfirmation(false);
    setPendingInterrupt(null);
    setShowDownloadLink(false);
    setDownloadUrl("");
    setConfirmMessage("A study sheet has been created. Do you want to make a printable PDF?");
    setOutput("PDF export canceled.");
  };

  return (
    <main className="landing-shell">
      <section className="hero-page" aria-label="Study sheet builder">
        <div className="hero-stack">
          <PythonMark />

          <p className="hero-kicker">Study Sheet Builder</p>

          <h1>What topic do you want the agent to turn into a study sheet?</h1>

          <div className="prompt-shell">
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
              type="button"
              onClick={handleCreate}
              disabled={isLoading}
              aria-label="Send topic"
            >
              <SendIcon />
            </button>
          </div>

          <section className="output-shell" aria-label="Study sheet output">
            <div className="output-header">
              <span className="output-label">Output</span>
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
              <p className="output-title">Study sheet preview</p>
              <p className="output-copy">{output}</p>
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
