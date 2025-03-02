/**
 * Stops an actively-running script (represented by a WorkerScript object)
 * and removes it from the global pool of active scripts.
 */
import { ScriptDeath } from "./ScriptDeath";
import { WorkerScript } from "./WorkerScript";
import { workerScripts } from "./WorkerScripts";

import { GetServer } from "../Server/AllServers";
import { AddRecentScript } from "./RecentScripts";
import { ITutorial } from "../InteractiveTutorial";
import { AlertEvents } from "../ui/React/AlertManager";
import { handleUnknownError } from "./NetscriptHelpers";
import { roundToTwo } from "../utils/helpers/roundToTwo";

export function killWorkerScript(ws: WorkerScript): boolean {
  if (ITutorial.isRunning) {
    AlertEvents.emit("Processes cannot be killed during the tutorial.");
    return false;
  }
  stopAndCleanUpWorkerScript(ws);

  return true;
}

export function killWorkerScriptByPid(pid: number): boolean {
  const ws = workerScripts.get(pid);
  if (ws instanceof WorkerScript) {
    stopAndCleanUpWorkerScript(ws);
    return true;
  }

  return false;
}

function stopAndCleanUpWorkerScript(ws: WorkerScript): void {
  // Only clean up once.
  // Important: Only this function can set stopFlag!
  if (ws.env.stopFlag) return;

  //Clean up any ongoing netscriptDelay
  if (ws.delay) clearTimeout(ws.delay);
  ws.delayReject?.(new ScriptDeath(ws));
  ws.env.runningFn = "";

  if (typeof ws.atExit === "function") {
    try {
      const atExit = ws.atExit;
      ws.atExit = undefined;
      atExit();
    } catch (e: unknown) {
      handleUnknownError(e, ws, "Error running atExit function.\n\n");
    }
  }
  ws.env.stopFlag = true;
  removeWorkerScript(ws);
}

/**
 * Helper function that removes the script being killed from the global pool.
 * Also handles other cleanup-time operations
 *
 * @param {WorkerScript} - Identifier for WorkerScript. Either the object itself, or
 *                                  its index in the global workerScripts array
 */
function removeWorkerScript(workerScript: WorkerScript): void {
  const ip = workerScript.hostname;

  // Get the server on which the script runs
  const server = GetServer(ip);
  if (server == null) {
    console.error(`Could not find server on which this script is running: ${ip}`);
    return;
  }

  // Delete the RunningScript object from that server
  const rs = workerScript.scriptRef;
  const byPid = server.runningScriptMap.get(rs.scriptKey);
  if (!byPid) {
    console.error(`Couldn't find runningScriptMap for key ${rs.scriptKey}`);
  } else {
    byPid.delete(workerScript.pid);
    if (byPid.size === 0) {
      server.runningScriptMap.delete(rs.scriptKey);
    }
  }

  // Update ram used. Reround to prevent accumulation of error.
  server.updateRamUsed(roundToTwo(server.ramUsed - rs.ramUsage * rs.threads));

  workerScripts.delete(workerScript.pid);
  AddRecentScript(workerScript);
}
