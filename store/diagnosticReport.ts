import type { DiagnosticsView, HealthCheckView } from "omawarden-app/native";
import type { ThemePalette } from "../theme/palette";

/**
 * Scope declaration for the Diagnostic Report.
 *
 * The shared daemon's structured stderr logs are intentionally out of scope
 * (see ADR 0001: the app is an NSH frontend that does not spawn the daemon,
 * and daemon stderr is not plumbed into the app process). This string is
 * asserted verbatim by tests and is surfaced to the user, so keep it stable.
 */
export const DIAGNOSTIC_SCOPE =
  "This report contains the app's in-process diagnostic log ring only. " +
  "The shared daemon's structured stderr logs are not collected.";

export interface DiagnosticReportInput {
  diagnostics: DiagnosticsView;
  health: { checks: HealthCheckView[] };
  generatedAt: string;
}

// The Log Pipeline format: `[RFC3339] [LEVEL] [source] message`.
export const LOG_LINE = /^\[([^\]]+)\] \[([^\]]+)\] \[([^\]]+)\] (.*)$/;

export interface ParsedLogLine {
  timestamp: string;
  level: string;
  source: string;
  message: string;
}

/**
 * Generate a stable, filesystem-safe test ID suffix from a log line.
 * Uses timestamp, level, and source — stable across filter/sort.
 */
export function stableLogTestId(line: ParsedLogLine): string {
  // timestamp like "2026-01-01T10:00:00.000Z" -> "2026-01-01T10-00-00-000Z"
  const ts = line.timestamp.replace(/[:.]/g, "-");
  const src = line.source.replace(/[^a-zA-Z0-9_:.-]/g, "_");
  return `log-${ts}-${line.level}-${src}`;
}

/**
 * Parse a raw log line from the Log Pipeline ring.
 * Lines that predate the format are returned as unlabelled INFO lines.
 */
export function parseLogLine(raw: string): ParsedLogLine {
  const match = LOG_LINE.exec(raw);
  if (!match) {
    return { timestamp: "", level: "INFO", source: "app", message: raw };
  }
  return {
    timestamp: match[1],
    level: match[2],
    source: match[3],
    message: match[4],
  };
}

/**
 * Determine if a log line represents a problem (ERROR or WARN).
 */
export function isProblemLine(line: ParsedLogLine): boolean {
  return line.level === "ERROR" || line.level === "WARN";
}

/**
 * The semantic color for a level badge, never a hardcoded hex literal.
 */
export function logLevelColor(level: string, palette: ThemePalette): string {
  if (level === "ERROR") {
    return palette.danger;
  }
  if (level === "WARN") {
    return palette.warning;
  }
  return palette.info;
}

// Daemon log lines are never part of the app's in-process ring (see ADR 0001);
// this guard keeps a stray daemon channel out of the report even if it were
// ever injected upstream.
function isDaemonLogLine(raw: string): boolean {
  const match = LOG_LINE.exec(raw);
  if (!match) {
    return false;
  }
  return /daemon/i.test(match[3]);
}

function sanitizeLogs(logs: string[]): string[] {
  return logs.filter((line) => !isDaemonLogLine(line));
}

function formatHealthChecks(checks: HealthCheckView[]): string {
  if (checks.length === 0) {
    return "_No health checks reported._";
  }
  return checks.map((c) => `- ${c.name}: ${c.ok ? "OK" : "FAIL"}`).join("\n");
}

/**
 * Builds the Markdown Diagnostic Report from the app's in-process diagnostics
 * and the current health snapshot. The report is sanitized upstream (server
 * URL and log lines are already scrubbed by the engine); this builder never
 * reintroduces private paths or daemon log channels.
 */
export function buildDiagnosticReport(input: DiagnosticReportInput): string {
  const { diagnostics, health, generatedAt } = input;
  const logs = sanitizeLogs(diagnostics.logs);

  const lines: string[] = [];
  lines.push("### Omawarden Diagnostic Report");
  lines.push("");
  lines.push(`- **Generated At**: ${generatedAt}`);
  lines.push(`- **App Version**: ${diagnostics.appVersion}`);
  lines.push(`- **Engine Version**: ${diagnostics.engineVersion}`);
  lines.push(`- **Git Commit**: ${diagnostics.gitCommit}`);
  lines.push(`- **Build Date**: ${diagnostics.buildDate}`);
  lines.push(`- **Server URL**: ${diagnostics.serverUrlSanitized}`);
  lines.push(`- **Memory (RSS)**: ${diagnostics.memoryRssMb} MiB`);
  lines.push("");
  lines.push(DIAGNOSTIC_SCOPE);
  lines.push("");
  lines.push("#### Health Checks");
  lines.push("");
  lines.push(formatHealthChecks(health.checks));
  lines.push("");
  lines.push(`#### Recent Logs (${logs.length} entries):`);
  lines.push("");
  lines.push("```");
  lines.push(...logs);
  lines.push("```");

  return lines.join("\n");
}