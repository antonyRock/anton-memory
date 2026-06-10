function copyTextToClipboardFallback(text: string) {
  if (typeof document === "undefined") return false;

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "0";
  textarea.style.width = "2em";
  textarea.style.height = "2em";
  textarea.style.padding = "0";
  textarea.style.border = "none";
  textarea.style.outline = "none";
  textarea.style.boxShadow = "none";
  textarea.style.background = "transparent";
  textarea.style.fontSize = "16px";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";

  document.body.appendChild(textarea);

  const selection = document.getSelection();
  const savedRanges: Range[] = [];
  if (selection) {
    for (let index = 0; index < selection.rangeCount; index += 1) {
      savedRanges.push(selection.getRangeAt(index));
    }
  }

  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, text.length);

  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  }

  document.body.removeChild(textarea);

  if (selection) {
    selection.removeAllRanges();
    for (const range of savedRanges) {
      selection.addRange(range);
    }
  }

  return copied;
}

export function copyTextToClipboard(text: string) {
  if (!text) return false;

  if (
    typeof navigator !== "undefined" &&
    typeof window !== "undefined" &&
    window.isSecureContext &&
    navigator.clipboard?.writeText
  ) {
    void navigator.clipboard.writeText(text).catch(() => {
      copyTextToClipboardFallback(text);
    });
    return true;
  }

  return copyTextToClipboardFallback(text);
}

export async function shareOrCopyText(text: string, title = "Ссылка") {
  if (copyTextToClipboard(text)) return "copied" as const;

  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      await navigator.share({ title, url: text });
      return "shared" as const;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return "cancelled" as const;
      }
    }
  }

  return "failed" as const;
}
