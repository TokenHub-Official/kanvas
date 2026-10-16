import {
  CheckOutlined,
  CloseOutlined,
  EditOutlined,
  QuestionCircleOutlined,
  SendOutlined,
} from "@ant-design/icons";
import type {
  AgentInteractionView,
  ResolveAgentInteractionBody,
} from "@kanvas/contracts/api";
import { Button } from "antd";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useTranslation } from "react-i18next";

interface QuestionDraft {
  readonly activeQuestionKey?: string;
  readonly selections: Readonly<Record<string, readonly string[]>>;
  readonly custom: Readonly<Record<string, string>>;
  readonly supplement: string;
}

type AgentQuestion = AgentInteractionView["questions"][number];

const emptyDraft: QuestionDraft = {
  selections: {},
  custom: {},
  supplement: "",
};
const maximumSelectedOptions = 4;
const maximumAnswerCharacters = 1_000;
const maximumStableKeyCharacters = 64;

function nextOptionSelection(
  selected: readonly string[],
  optionKey: string,
  multiSelect: boolean,
  checked: boolean,
): readonly string[] {
  if (!multiSelect) return [optionKey];
  return checked
    ? selected.filter((key) => key !== optionKey)
    : [...selected, optionKey];
}

function questionAnswered(
  draft: QuestionDraft,
  question: AgentQuestion,
): boolean {
  return (
    (draft.selections[question.key]?.length ?? 0) > 0 ||
    Boolean(draft.custom[question.key]?.trim())
  );
}

function storageKey(interactionId: string): string {
  return `kanvas:agent-question:${interactionId}`;
}

function storedDraft(interactionId: string): QuestionDraft {
  try {
    const raw = sessionStorage.getItem(storageKey(interactionId));
    if (!raw) return emptyDraft;
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return emptyDraft;
    }
    const candidate = value as Record<string, unknown>;
    const rawSelections =
      candidate.selections &&
      typeof candidate.selections === "object" &&
      !Array.isArray(candidate.selections)
        ? (candidate.selections as Record<string, unknown>)
        : {};
    const selections = Object.fromEntries(
      Object.entries(rawSelections).flatMap(([key, selected]) =>
        Array.isArray(selected) &&
        selected.length <= maximumSelectedOptions &&
        selected.every((optionKey) => typeof optionKey === "string")
          ? [[key, selected]]
          : [],
      ),
    );
    const rawCustom =
      candidate.custom &&
      typeof candidate.custom === "object" &&
      !Array.isArray(candidate.custom)
        ? (candidate.custom as Record<string, unknown>)
        : {};
    const custom = Object.fromEntries(
      Object.entries(rawCustom).flatMap(([key, answer]) =>
        typeof answer === "string" && answer.length <= maximumAnswerCharacters
          ? [[key, answer]]
          : [],
      ),
    );
    const activeQuestionKey =
      typeof candidate.activeQuestionKey === "string" &&
      candidate.activeQuestionKey.length <= maximumStableKeyCharacters
        ? candidate.activeQuestionKey
        : undefined;
    return {
      ...(activeQuestionKey ? { activeQuestionKey } : {}),
      selections,
      custom,
      supplement:
        typeof candidate.supplement === "string" &&
        candidate.supplement.length <= maximumAnswerCharacters
          ? candidate.supplement
          : "",
    };
  } catch {
    return emptyDraft;
  }
}

function clearStoredDraft(interactionId: string): void {
  try {
    sessionStorage.removeItem(storageKey(interactionId));
  } catch {
    // Draft persistence is a convenience and never blocks answering.
  }
}

function resolvedAnswer(
  interaction: AgentInteractionView,
  question: AgentQuestion,
  locale: string,
): string | undefined {
  const response = interaction.response;
  if (response?.outcome !== "submitted") return undefined;
  const answer = response.answers.find(
    (candidate) => candidate.questionKey === question.key,
  );
  if (!answer) return undefined;
  const labels = answer.optionKeys.flatMap((key) => {
    const option = question.options.find((candidate) => candidate.key === key);
    return option ? [option.label] : [];
  });
  if (answer.customText) labels.push(answer.customText);
  try {
    return new Intl.ListFormat(locale, {
      style: "short",
      type: "conjunction",
    }).format(labels);
  } catch {
    return labels.join(", ");
  }
}

export function AgentQuestionCard({
  interaction,
  resolving = false,
  onResolve,
}: {
  readonly interaction: AgentInteractionView;
  readonly resolving?: boolean;
  readonly onResolve: (
    interactionId: string,
    body: ResolveAgentInteractionBody,
  ) => Promise<void>;
}): React.JSX.Element {
  const { i18n, t } = useTranslation();
  const controlGroupId = useId();
  const rootRef = useRef<HTMLElement | null>(null);
  const customInputRef = useRef<HTMLInputElement | null>(null);
  const [draft, setDraft] = useState<QuestionDraft>(() =>
    storedDraft(interaction.id),
  );
  const [activeQuestionIndex, setActiveQuestionIndex] = useState(() => {
    const storedIndex = interaction.questions.findIndex(
      (question) => question.key === draft.activeQuestionKey,
    );
    return storedIndex >= 0 ? storedIndex : 0;
  });
  const [supplementOpen, setSupplementOpen] = useState(() =>
    Boolean(draft.supplement.trim()),
  );
  const [highlightedRows, setHighlightedRows] = useState<
    Readonly<Record<string, number>>
  >({});
  const [submitError, setSubmitError] = useState(false);
  const pending = interaction.lifecycleStatus === "pending";
  const activeQuestion =
    interaction.questions[activeQuestionIndex] ?? interaction.questions[0]!;
  const selected = draft.selections[activeQuestion.key] ?? [];
  const customValue = draft.custom[activeQuestion.key] ?? "";
  const selectedOptionIndex = activeQuestion.multiSelect
    ? -1
    : activeQuestion.options.findIndex((option) =>
        selected.includes(option.key),
      );
  const highlightedIndex =
    highlightedRows[activeQuestion.key] ??
    (selectedOptionIndex >= 0 ? selectedOptionIndex : 0);

  useEffect(() => {
    if (!pending) {
      clearStoredDraft(interaction.id);
      return;
    }
    try {
      sessionStorage.setItem(storageKey(interaction.id), JSON.stringify(draft));
    } catch {
      // Draft persistence is a convenience and never blocks answering.
    }
  }, [draft, interaction.id, pending]);

  const complete = useMemo(
    () =>
      interaction.questions.every((question) =>
        questionAnswered(draft, question),
      ),
    [draft, interaction.questions],
  );

  const activateQuestion = (index: number): void => {
    const question = interaction.questions[index];
    if (!question) return;
    setSupplementOpen(false);
    setActiveQuestionIndex(index);
    setDraft((current) => ({
      ...current,
      activeQuestionKey: question.key,
    }));
  };

  const selectOption = (
    question: AgentQuestion,
    optionKey: string,
    checked: boolean,
  ): void => {
    const next = nextOptionSelection(
      draft.selections[question.key] ?? [],
      optionKey,
      question.multiSelect ?? false,
      checked,
    );
    const nextDraft: QuestionDraft = {
      ...draft,
      selections: { ...draft.selections, [question.key]: next },
      ...(!question.multiSelect
        ? { custom: { ...draft.custom, [question.key]: "" } }
        : {}),
    };
    let nextIndex = activeQuestionIndex;
    if (!question.multiSelect && interaction.questions.length > 1) {
      const unansweredIndex = interaction.questions.findIndex(
        (candidate, index) =>
          index > activeQuestionIndex &&
          !questionAnswered(nextDraft, candidate),
      );
      if (unansweredIndex >= 0) nextIndex = unansweredIndex;
    }
    const nextQuestion = interaction.questions[nextIndex];
    setDraft({
      ...nextDraft,
      ...(nextQuestion ? { activeQuestionKey: nextQuestion.key } : {}),
    });
    setActiveQuestionIndex(nextIndex);
  };

  const resolve = async (body: ResolveAgentInteractionBody): Promise<void> => {
    setSubmitError(false);
    try {
      await onResolve(interaction.id, body);
      clearStoredDraft(interaction.id);
    } catch {
      setSubmitError(true);
    }
  };

  const submitAnswers = (): void => {
    if (!complete || resolving) return;
    void resolve({
      expectedVersion: interaction.version,
      outcome: "submitted",
      answers: interaction.questions.map((question) => ({
        questionKey: question.key,
        optionKeys: [...(draft.selections[question.key] ?? [])],
        ...(draft.custom[question.key]?.trim()
          ? { customText: draft.custom[question.key]!.trim() }
          : {}),
      })),
      ...(draft.supplement.trim()
        ? { supplement: draft.supplement.trim() }
        : {}),
    });
  };

  const skipQuestions = (): void => {
    if (resolving) return;
    void resolve({
      expectedVersion: interaction.version,
      outcome: "skipped",
    });
  };
  const endTask = (): void => {
    if (resolving) return;
    void resolve({
      expectedVersion: interaction.version,
      outcome: "cancelled",
    });
  };

  function submitSupplementOnEnter(
    event: ReactKeyboardEvent<HTMLTextAreaElement>,
  ): void {
    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      event.nativeEvent.isComposing ||
      !complete
    ) {
      return;
    }
    event.preventDefault();
    submitAnswers();
  }

  function changeCustomAnswer(event: ChangeEvent<HTMLInputElement>): void {
    const value = event.target.value;
    setDraft((current) => ({
      ...current,
      custom: {
        ...current.custom,
        [activeQuestion.key]: value,
      },
      ...(!activeQuestion.multiSelect && value.trim()
        ? {
            selections: {
              ...current.selections,
              [activeQuestion.key]: [],
            },
          }
        : {}),
    }));
  }

  function submitCustomAnswerOnEnter(
    event: ReactKeyboardEvent<HTMLInputElement>,
  ): void {
    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      event.nativeEvent.isComposing ||
      !complete
    ) {
      return;
    }
    event.preventDefault();
    submitAnswers();
  }

  useEffect(() => {
    if (!pending) return;
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      ) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target) {
        const selectionInput =
          target instanceof HTMLInputElement &&
          (target.type === "radio" || target.type === "checkbox") &&
          rootRef.current?.contains(target);
        if (selectionInput && event.key !== "Enter" && event.key !== "Escape") {
          return;
        }
        const typing =
          (target.tagName === "INPUT" && !selectionInput) ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable;
        if (typing) {
          const typingInCard = rootRef.current?.contains(target) ?? false;
          if (!typingInCard || event.key !== "Escape" || event.isComposing) {
            return;
          }
        }
        if (
          target.closest('[role="dialog"],[role="alertdialog"],[role="menu"]')
        ) {
          return;
        }
        if (
          event.key !== "Escape" &&
          target.closest("a,button,select,summary,[role='button'],[role='tab']")
        ) {
          return;
        }
      }
      if (
        event.repeat &&
        event.key !== "ArrowUp" &&
        event.key !== "ArrowDown"
      ) {
        return;
      }
      if (event.key === "Escape") {
        if (resolving) return;
        event.preventDefault();
        skipQuestions();
        return;
      }
      if (supplementOpen || resolving) return;

      if (/^[1-9]$/u.test(event.key)) {
        const index = Number(event.key) - 1;
        if (index < activeQuestion.options.length) {
          const option = activeQuestion.options[index]!;
          event.preventDefault();
          setHighlightedRows((current) => ({
            ...current,
            [activeQuestion.key]: index,
          }));
          selectOption(
            activeQuestion,
            option.key,
            selected.includes(option.key),
          );
        } else if (index === activeQuestion.options.length) {
          event.preventDefault();
          setHighlightedRows((current) => ({
            ...current,
            [activeQuestion.key]: index,
          }));
          customInputRef.current?.focus();
        }
        return;
      }

      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        const rowCount = activeQuestion.options.length + 1;
        const step = event.key === "ArrowUp" ? -1 : 1;
        const nextIndex = (highlightedIndex + step + rowCount) % rowCount;
        setHighlightedRows((current) => ({
          ...current,
          [activeQuestion.key]: nextIndex,
        }));
        if (nextIndex === activeQuestion.options.length) {
          customInputRef.current?.focus();
        }
        return;
      }

      if (
        event.key === " " &&
        highlightedIndex < activeQuestion.options.length
      ) {
        const option = activeQuestion.options[highlightedIndex]!;
        event.preventDefault();
        selectOption(activeQuestion, option.key, selected.includes(option.key));
        return;
      }

      if (event.key === "Enter") {
        if (complete) {
          event.preventDefault();
          submitAnswers();
        } else if (
          !activeQuestion.multiSelect &&
          highlightedIndex < activeQuestion.options.length
        ) {
          const option = activeQuestion.options[highlightedIndex]!;
          event.preventDefault();
          selectOption(activeQuestion, option.key, false);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  if (!pending) {
    const multiple = interaction.questions.length > 1;
    return (
      <section
        aria-label={t("agent.question.title")}
        className="my-4 max-w-3xl"
        data-agent-question="resolved"
      >
        <header className="flex min-w-0 items-center gap-2 text-xs text-ink-muted">
          <span className="grid size-7 shrink-0 place-items-center rounded-[8px] bg-mist text-primary">
            <QuestionCircleOutlined aria-hidden="true" />
          </span>
          <span className="font-medium">
            {t(`agent.question.state.${interaction.lifecycleStatus}`)}
          </span>
          {!multiple && interaction.questions[0]?.header ? (
            <span className="truncate rounded-[6px] bg-mist px-2 py-0.5">
              {interaction.questions[0].header}
            </span>
          ) : null}
        </header>

        {interaction.response?.outcome === "submitted" ? (
          <div className="mt-3 grid gap-4 pl-9">
            {interaction.questions.map((question, index) => (
              <div
                className={`flex min-w-0 items-start gap-2 ${
                  multiple ? "sm:gap-3" : ""
                }`}
                key={question.key}
              >
                {multiple ? (
                  <span className="mt-0.5 w-7 shrink-0 rounded-[5px] bg-mist py-0.5 text-center font-mono text-[11px] text-ink-muted [font-variant-numeric:tabular-nums]">
                    {`Q${String(index + 1)}`}
                  </span>
                ) : null}
                <dl className="m-0 min-w-0">
                  <dt className="break-words text-sm leading-5 text-ink">
                    {question.question}
                    {multiple && question.header ? (
                      <span className="ml-2 rounded-[5px] bg-mist px-1.5 py-0.5 text-[11px] text-ink-muted">
                        {question.header}
                      </span>
                    ) : null}
                  </dt>
                  <dd className="m-0 mt-1 break-words text-sm leading-5 text-ink-muted">
                    {resolvedAnswer(interaction, question, i18n.language)}
                  </dd>
                </dl>
              </div>
            ))}
            {interaction.response.supplement ? (
              <div className="flex min-w-0 items-start gap-2 text-sm text-ink-muted">
                <EditOutlined aria-hidden="true" className="mt-1 shrink-0" />
                <p className="m-0 break-words leading-5">
                  {interaction.response.supplement}
                </p>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>
    );
  }

  const activeTabId = supplementOpen
    ? `${controlGroupId}-supplement-tab`
    : `${controlGroupId}-question-tab-${String(activeQuestionIndex)}`;
  const panelId = `${controlGroupId}-panel`;

  return (
    <section
      aria-label={t("agent.question.title")}
      className="my-4 w-full max-w-3xl overflow-hidden rounded-[16px] border border-line/80 bg-mist/35"
      data-agent-question="pending"
      ref={rootRef}
    >
      <div
        aria-label={t("agent.question.questionNavigation")}
        className="flex min-h-11 items-end gap-1 overflow-x-auto px-3 pt-1"
        role="tablist"
      >
        {interaction.questions.map((question, index) => {
          const answered = questionAnswered(draft, question);
          const active = !supplementOpen && index === activeQuestionIndex;
          return (
            <button
              aria-controls={panelId}
              aria-selected={active}
              className={`relative inline-flex min-h-10 shrink-0 items-center gap-1.5 border-0 border-b-2 bg-transparent px-2.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary ${
                active
                  ? "border-ink text-ink"
                  : "border-transparent text-ink-muted hover:text-ink"
              }`}
              disabled={resolving}
              id={`${controlGroupId}-question-tab-${String(index)}`}
              key={question.key}
              role="tab"
              type="button"
              onClick={() => activateQuestion(index)}
            >
              {`Q${String(index + 1)}`}
              {answered ? (
                <CheckOutlined aria-hidden="true" className="text-[10px]" />
              ) : null}
            </button>
          );
        })}
        <button
          aria-controls={panelId}
          aria-selected={supplementOpen}
          className={`relative inline-flex min-h-10 shrink-0 items-center gap-1.5 border-0 border-b-2 bg-transparent px-2.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary ${
            supplementOpen
              ? "border-ink text-ink"
              : "border-transparent text-ink-muted hover:text-ink"
          }`}
          disabled={resolving}
          id={`${controlGroupId}-supplement-tab`}
          role="tab"
          type="button"
          onClick={() => setSupplementOpen(true)}
        >
          <EditOutlined aria-hidden="true" className="text-xs" />
          {t("agent.question.supplement")}
          {draft.supplement.trim() ? (
            <CheckOutlined aria-hidden="true" className="text-[10px]" />
          ) : null}
        </button>
      </div>

      <div
        aria-labelledby={activeTabId}
        className="px-4 pb-4 pt-4 sm:px-5 sm:pb-5"
        id={panelId}
        role="tabpanel"
      >
        {supplementOpen ? (
          <textarea
            aria-label={t("agent.question.supplement")}
            autoComplete="off"
            className="min-h-28 w-full resize-y rounded-[10px] border-0 bg-mist/85 px-3 py-2.5 text-sm leading-5 text-ink outline-none placeholder:text-placeholder focus-visible:ring-2 focus-visible:ring-primary/35"
            disabled={resolving}
            maxLength={maximumAnswerCharacters}
            name={`${controlGroupId}:supplement`}
            placeholder={t("agent.question.supplementPlaceholder")}
            value={draft.supplement}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                supplement: event.target.value,
              }))
            }
            onKeyDown={submitSupplementOnEnter}
          />
        ) : (
          <fieldset className="m-0 min-w-0 border-0 p-0">
            <legend className="sr-only">{activeQuestion.header}</legend>
            <div className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
              <span>{activeQuestion.header}</span>
              {activeQuestion.multiSelect ? (
                <span className="text-xs">
                  {t("agent.question.multiSelect")}
                </span>
              ) : null}
            </div>
            <p className="mb-0 mt-2 break-words text-[15px] font-semibold leading-6 text-ink text-pretty">
              {activeQuestion.question}
            </p>

            <div className="mt-3 grid gap-1">
              {activeQuestion.options.map((option, index) => {
                const checked = selected.includes(option.key);
                const highlighted =
                  highlightedRows[activeQuestion.key] === index;
                const descriptionId = `${controlGroupId}-${activeQuestion.key}-${option.key}-description`;
                return (
                  <label
                    className={`flex min-h-14 cursor-pointer items-center gap-3 rounded-[10px] px-3 py-2.5 focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-primary ${
                      checked ? "bg-mist-deep" : "hover:bg-mist/80"
                    } ${
                      highlighted ? "ring-1 ring-inset ring-line-strong/70" : ""
                    } ${resolving ? "cursor-default opacity-60" : ""}`}
                    key={option.key}
                  >
                    <input
                      aria-describedby={
                        option.description ? descriptionId : undefined
                      }
                      checked={checked}
                      className="sr-only"
                      disabled={resolving}
                      name={`${controlGroupId}:${activeQuestion.key}`}
                      type={activeQuestion.multiSelect ? "checkbox" : "radio"}
                      onChange={() =>
                        selectOption(activeQuestion, option.key, checked)
                      }
                    />
                    <span className="grid size-[22px] shrink-0 place-items-center rounded-[6px] bg-mist-deep font-mono text-xs font-semibold text-ink-muted [font-variant-numeric:tabular-nums]">
                      {index + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
                        <span className="break-words">{option.label}</span>
                        {option.recommended ? (
                          <span className="shrink-0 rounded-full bg-paper/75 px-2 py-0.5 text-[11px] font-normal text-ink-muted">
                            {t("agent.question.recommended")}
                          </span>
                        ) : null}
                      </span>
                      {option.description ? (
                        <span
                          className="mt-0.5 block break-words text-xs leading-[1.45] text-ink-muted"
                          id={descriptionId}
                        >
                          {option.description}
                        </span>
                      ) : null}
                    </span>
                    {checked ? (
                      <CheckOutlined
                        aria-hidden="true"
                        className="shrink-0 text-sm text-primary"
                      />
                    ) : null}
                  </label>
                );
              })}

              <div
                className={`mt-0.5 flex min-h-12 items-center gap-3 rounded-[10px] px-3 ${
                  highlightedRows[activeQuestion.key] ===
                  activeQuestion.options.length
                    ? "ring-1 ring-inset ring-line-strong/70"
                    : ""
                }`}
              >
                <span className="grid size-[22px] shrink-0 place-items-center rounded-[6px] bg-mist-deep font-mono text-xs font-semibold text-ink-muted [font-variant-numeric:tabular-nums]">
                  {activeQuestion.options.length + 1}
                </span>
                <input
                  aria-label={t("agent.question.customAnswer", {
                    question: activeQuestion.header,
                  })}
                  autoComplete="off"
                  className="min-h-9 min-w-0 flex-1 rounded-[8px] border-0 bg-mist/85 px-3 text-sm text-ink outline-none placeholder:text-placeholder focus-visible:ring-2 focus-visible:ring-primary/35"
                  disabled={resolving}
                  maxLength={maximumAnswerCharacters}
                  name={`${controlGroupId}:${activeQuestion.key}:custom`}
                  placeholder={t("agent.question.customPlaceholder")}
                  ref={customInputRef}
                  value={customValue}
                  onChange={changeCustomAnswer}
                  onFocus={() =>
                    setHighlightedRows((current) => ({
                      ...current,
                      [activeQuestion.key]: activeQuestion.options.length,
                    }))
                  }
                  onKeyDown={submitCustomAnswerOnEnter}
                />
              </div>
            </div>
          </fieldset>
        )}

        {submitError ? (
          <p
            aria-live="polite"
            className="mb-0 mt-3 text-sm text-danger"
            role="alert"
          >
            {t("agent.question.submitError")}
          </p>
        ) : null}
      </div>

      <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line/70 bg-mist/40 px-4 py-3">
        <Button
          type="text"
          size="small"
          disabled={resolving}
          onClick={endTask}
          className="mr-auto"
        >
          {t("agent.question.endTask")}
        </Button>
        <Button
          aria-keyshortcuts="Escape"
          size="small"
          disabled={resolving}
          icon={<CloseOutlined aria-hidden="true" />}
          onClick={skipQuestions}
        >
          {t("agent.question.skipAndContinue")}
          <kbd className="ml-1 rounded bg-paper/65 px-1 font-mono text-xs font-normal leading-5 text-muted">
            Esc
          </kbd>
        </Button>
        <Button
          aria-keyshortcuts="Enter"
          size="small"
          disabled={!complete}
          icon={<SendOutlined aria-hidden="true" />}
          loading={resolving}
          type="primary"
          onClick={submitAnswers}
        >
          {t("agent.question.continue")}
          <kbd className="ml-1 rounded bg-white/20 px-1 font-mono text-xs font-normal leading-5 text-white/80">
            Enter
          </kbd>
        </Button>
      </footer>
    </section>
  );
}
