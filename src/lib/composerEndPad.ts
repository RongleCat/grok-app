/** Height of the floating composer that occludes the chat stage. */
export function measureComposerEndPadPx(el: HTMLElement): number | null {
  const stage = el.closest(".main__stage");
  const stack = el.querySelector(".composer-stack") ?? el;
  const stackBox = stack.getBoundingClientRect();
  let h = Math.ceil(stackBox.height);
  if (stage) {
    const stageBox = stage.getBoundingClientRect();
    const occluded = Math.ceil(stageBox.bottom - stackBox.top);
    if (occluded > 0 && occluded <= stageBox.height) h = occluded;
  }
  return h <= 0 ? null : h;
}

/** Ignore 1px subpixel flicker so pad thrash does not bounce the transcript. */
export function nextComposerFloatPad(prev: number, next: number): number {
  return Math.abs(prev - next) <= 1 ? prev : next;
}
