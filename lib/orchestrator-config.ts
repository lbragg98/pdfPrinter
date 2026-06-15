export const ORCHESTRATOR_RUN_API_KEY = process.env.ORCHESTRATOR_RUN_API_KEY ?? "";
export const ORCHESTRATOR_PROJECT_ID = process.env.ORCHESTRATOR_PROJECT_ID ?? "";
export const ORCHESTRATOR_BASE_URL =
  process.env.ORCHESTRATOR_BASE_URL ?? "https://agent-authoring-flatiron-school.vercel.app";
export const ORCHESTRATOR_RUN_PATH = process.env.ORCHESTRATOR_RUN_PATH ?? "";

export function getOrchestratorRunUrl() {
  return new URL(ORCHESTRATOR_RUN_PATH, ORCHESTRATOR_BASE_URL).toString();
}
