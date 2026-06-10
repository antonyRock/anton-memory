export function triggerHapticPulse() {
  if (typeof navigator === "undefined" || !("vibrate" in navigator)) return false;

  try {
    navigator.vibrate([12, 36, 12]);
    return true;
  } catch {
    return false;
  }
}
