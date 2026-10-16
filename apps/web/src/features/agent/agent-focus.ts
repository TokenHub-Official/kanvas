export interface AgentComposerFocusTarget {
  readonly disabled: boolean;
  readonly value: string;
  focus(options?: FocusOptions): void;
  setSelectionRange(start: number, end: number): void;
}

export function agentComposerShouldAutoFocusOnEntry(options: {
  readonly finePointer: boolean;
  readonly ready: boolean;
  readonly overlayOpen: boolean;
}): boolean {
  return options.finePointer && options.ready && !options.overlayOpen;
}

export function focusAgentComposer(
  target: AgentComposerFocusTarget | null | undefined,
  options: { readonly moveCaretToEnd?: boolean } = {},
): boolean {
  if (!target || target.disabled) return false;
  target.focus({ preventScroll: true });
  if (options.moveCaretToEnd) {
    const end = target.value.length;
    target.setSelectionRange(end, end);
  }
  return true;
}
