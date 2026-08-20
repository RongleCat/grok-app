export function promptStatusClass(severity: string): {
  status: string;
  textarea: string;
  count: string;
} {
  const warn = severity === "warn";
  const info = severity === "info";
  return {
    status:
      "session-prompt-status" +
      (warn
        ? " session-prompt-status--warn"
        : info
          ? " session-prompt-status--info"
          : ""),
    textarea: warn ? " session-prompt-textarea--warn" : "",
    count: warn ? " session-prompt-count--warn" : "",
  };
}
