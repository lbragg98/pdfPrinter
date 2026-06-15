"use client";

import { useMemo, useState } from "react";
import {
  buildDownloadPrompt,
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

export default function Page() {
  const [topic, setTopic] = useState("");
  const [output, setOutput] = useState(
    "Enter a topic to generate the first study sheet draft."
  );
  const [downloadUrl, setDownloadUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [needsConfirmation, setNeedsConfirmation] = useState(false);
  const [showDownloadLink, setShowDownloadLink] = useState(false);
  const [confirmMessage, setConfirmMessage] = useState(
    "A study sheet has been created. Do you want to make a printable PDF?"
  );

  const [threadId] = useState(() => createThreadId("study-sheet"));

  const topicLabel = useMemo(() => topic.trim() || "Python basics", [topic]);

  const handleCreate = async () => {
    const trimmed = topic.trim();

    if (!trimmed) {
      setOutput("Enter a topic before asking the agent to create a study sheet.");
      return;
    }

    setIsLoading(true);
    setShowDownloadLink(false);
    setDownloadUrl("");
    setNeedsConfirmation(false);
    setOutput("Creating the study sheet...");

    try {
      const responseText = await runOrchestratorPrompt({
        threadId,
        input: buildStudySheetPrompt(trimmed)
      });

      setOutput(responseText || "The agent returned no study sheet text.");
      setNeedsConfirmation(true);
      setConfirmMessage("A study sheet has been created. Do you want to make a printable PDF?");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setOutput(`Study sheet generation failed: ${message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirmYes = async () => {
    setIsLoading(true);
    setConfirmMessage("Creating the printable PDF...");

    try {
      const responseText = await runOrchestratorPrompt({
        threadId,
        input: buildDownloadPrompt(topicLabel, output)
      });

      const trimmed = responseText.trim();
      const linkMatch = trimmed.match(/https?:\/\/\S+/i);
      const nextDownloadUrl = linkMatch?.[0] ?? "";

      setDownloadUrl(nextDownloadUrl);
      setShowDownloadLink(true);
      setNeedsConfirmation(false);
      setOutput(
        trimmed ||
          "The printable PDF is ready. The agent would provide the download link here."
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setOutput(`PDF generation failed: ${message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirmNo = () => {
    setNeedsConfirmation(false);
    setShowDownloadLink(false);
    setDownloadUrl("");
    setConfirmMessage("A study sheet has been created. Do you want to make a printable PDF?");
    setOutput("The flow stopped after the confirmation interrupt.");
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
            <button className="prompt-submit" type="button" onClick={handleCreate} disabled={isLoading}>
              <span className="paper-plane" />
            </button>
          </div>

          <section className="output-shell" aria-label="Study sheet output">
            <div className="output-header">
              <span className="output-label">Output</span>
              <span className="output-status">
                {isLoading ? "Working..." : needsConfirmation ? "Awaiting confirmation" : "Ready"}
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
          <section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
            <p className="confirm-eyebrow">Interrupt</p>
            <h2 id="confirm-title">Confirm PDF creation</h2>
            <div className="confirm-box">
              <p className="confirm-message">{confirmMessage}</p>
              <div className="confirm-actions">
                <button className="confirm-yes" type="button" onClick={handleConfirmYes} disabled={isLoading}>
                  Yes
                </button>
                <button className="confirm-no" type="button" onClick={handleConfirmNo} disabled={isLoading}>
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
