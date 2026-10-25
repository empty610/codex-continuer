export const OUTPUT_LIMIT = 16000;
export const SUMMARY_LIMIT = 2000;

export function outputTail(text) {
  let start = Math.max(0, text.length - OUTPUT_LIMIT);
  // Avoid retaining only the low half of a supplementary Unicode character.
  if (start && /[\uDC00-\uDFFF]/.test(text[start]) && /[\uD800-\uDBFF]/.test(text[start - 1])) start++;
  return text.slice(start);
}

export function retainOutput(task, text, append = false) {
  const full = append ? (task.output || '') + text : text;
  task.output = outputTail(full);
  task.outputTruncated = (append && task.outputTruncated === true) || full.length > OUTPUT_LIMIT;
}

export function outcomeSummary(text) {
  let end = Math.min(text.length, SUMMARY_LIMIT);
  if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1]) && /[\uDC00-\uDFFF]/.test(text[end])) end--;
  return text.slice(0, end);
}
