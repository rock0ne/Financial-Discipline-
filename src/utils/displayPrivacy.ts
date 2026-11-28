/** Remove account-number-like digit runs from paths shown or retained by imports. */
export function redactImportDisplayText(value: string): string {
  return value
    .replace(/\b\d{2}[- ]\d{2}[- ]\d{2}\b/g, '[number redacted]')
    .replace(/\b\d{4}[- ]\d{4}\b/g, '[number redacted]')
    .replace(/\d{6,}/g, '[number redacted]');
}
