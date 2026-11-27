/**
 * Copies text to the clipboard. Uses the asynchronous Clipboard API when the browser allows it, and
 * otherwise falls back to a selected, hidden text field. Resolves to true only when the copy worked.
 */
export async function copyText(text) {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Permission denied or not a secure context: try the fallback below.
    }
  }
  return copyWithSelection(text);
}

function copyWithSelection(text) {
  if (typeof document === 'undefined' || typeof document.execCommand !== 'function') return false;
  const field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.opacity = '0';
  document.body.appendChild(field);
  field.select();
  try {
    return document.execCommand('copy') === true;
  } catch {
    return false;
  } finally {
    field.remove();
  }
}
