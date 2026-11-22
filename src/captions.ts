const el = () => document.getElementById('caption') as HTMLElement;
let token = 0;

/** Large, soft captions. Returns nothing; later calls replace earlier ones. */
export function showCaption(text: string): number {
  const e = el();
  e.textContent = text;
  e.classList.add('on');
  return ++token;
}

/** Subtle on-screen nudge (e.g. "raise both hands"). */
export function showHint(text: string): void {
  const e = document.getElementById('hint') as HTMLElement;
  e.textContent = text;
  e.classList.add('on');
}
export function hideHint(): void {
  document.getElementById('hint')?.classList.remove('on');
}

export function hideCaption(after = 0, forToken?: number): void {
  setTimeout(() => {
    if (forToken !== undefined && forToken !== token) return;
    el().classList.remove('on');
  }, after);
}
