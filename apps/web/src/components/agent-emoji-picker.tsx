import { Button, Input, Select } from "antd";
import enData from "emoji-picker-element-data/en/emojibase/data.json";
import zhData from "emoji-picker-element-data/zh/emojibase/data.json";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FluentEmoji } from "./fluent-emoji.js";

interface EmojiEntry {
  readonly emoji: string;
  readonly annotation: string;
  readonly shortcodes?: readonly string[];
  readonly tags?: readonly string[];
  readonly group: number;
  readonly skins?: readonly { emoji: string; tone: number }[];
}
const categories = [
  { group: 0, emoji: "😀" },
  { group: 1, emoji: "👋" },
  { group: 3, emoji: "🐱" },
  { group: 4, emoji: "🍎" },
  { group: 5, emoji: "🚗" },
  { group: 6, emoji: "⚽" },
  { group: 7, emoji: "💡" },
  { group: 8, emoji: "❤️" },
  { group: 9, emoji: "🏁" },
] as const;
const skinTones = [
  { value: 0 },
  { value: 1 },
  { value: 2 },
  { value: 3 },
  { value: 4 },
  { value: 5 },
] as const;
const EMOJI_PAGE_SIZE = 80;
const english = new Map(
  (enData as readonly EmojiEntry[]).map((entry) => [entry.emoji, entry]),
);

export default function AgentEmojiPicker({
  onSelect,
  disabled = false,
  selectedEmoji,
}: {
  readonly onSelect: (emoji: string) => void;
  readonly disabled?: boolean;
  readonly selectedEmoji?: string;
}): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(EMOJI_PAGE_SIZE);
  const selectedRef = useRef<HTMLButtonElement>(null);
  const locateRef = useRef(false);
  const initialEntry = (enData as readonly EmojiEntry[]).find(
    (entry) =>
      entry.emoji === selectedEmoji ||
      entry.skins?.some((skin) => skin.emoji === selectedEmoji),
  );
  const [group, setGroup] = useState(initialEntry?.group ?? 0);
  const [tone, setTone] = useState(
    initialEntry?.skins?.find((skin) => skin.emoji === selectedEmoji)?.tone ??
      0,
  );
  const entries = (
    i18n.language.startsWith("zh") ? zhData : enData
  ) as readonly EmojiEntry[];
  const visible = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return entries.filter((entry) => {
      if (!query) return entry.group === group;
      const fallback = english.get(entry.emoji);
      return [
        entry.emoji,
        entry.annotation,
        ...(entry.shortcodes ?? []),
        ...(entry.tags ?? []),
        fallback?.annotation,
        ...(fallback?.shortcodes ?? []),
      ]
        .join(" ")
        .toLocaleLowerCase()
        .includes(query);
    });
  }, [entries, group, search]);
  useEffect(() => {
    if (locateRef.current && selectedRef.current) {
      selectedRef.current.scrollIntoView({ block: "nearest" });
      locateRef.current = false;
    }
  }, [group, search, limit, tone]);
  function locate(): void {
    if (!initialEntry) return;
    locateRef.current = true;
    setSearch("");
    setGroup(initialEntry.group);
    setTone(
      initialEntry.skins?.find((skin) => skin.emoji === selectedEmoji)?.tone ??
        0,
    );
    setLimit(
      entries.filter((entry) => entry.group === initialEntry.group).length,
    );
  }
  function handleSearch(event: React.ChangeEvent<HTMLInputElement>) {
    setSearch(event.target.value);
    setLimit(EMOJI_PAGE_SIZE);
  }
  function handleTone(value: number) {
    setTone(value);
    setLimit(EMOJI_PAGE_SIZE);
  }
  function selectCategory(group: number) {
    setGroup(group);
    setLimit(EMOJI_PAGE_SIZE);
    setSearch("");
  }
  return (
    <div className="grid min-w-0 gap-3">
      <div className="sticky top-0 z-10 grid gap-2 bg-paper pb-2">
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-2">
          <Input
            className="min-w-0"
            allowClear
            aria-label={t("agent.editor.searchEmoji")}
            placeholder={t("agent.editor.searchEmoji")}
            value={search}
            disabled={disabled}
            onChange={handleSearch}
          />
          <Select
            aria-label={t("agent.editor.emojiSkinTone")}
            value={tone}
            disabled={disabled}
            popupMatchSelectWidth={false}
            onChange={handleTone}
            options={skinTones.map(({ value }) => ({
              value,
              label: t(`agent.editor.emojiTones.${value}`),
            }))}
          />
        </div>
        <div
          role="group"
          aria-label={t("agent.editor.emojiCategoriesLabel")}
          className="grid min-w-0 grid-cols-9 gap-1 border-b border-line pb-2"
        >
          {categories.map((category) => (
            <button
              key={category.group}
              type="button"
              disabled={disabled}
              title={t(`agent.editor.emojiCategories.${category.group}`)}
              aria-label={t(`agent.editor.emojiCategories.${category.group}`)}
              aria-pressed={!search && group === category.group}
              data-active={!search && group === category.group}
              className="grid h-9 min-w-0 cursor-pointer place-items-center rounded-lg border-0 bg-transparent text-xl hover:bg-mist data-[active=true]:bg-primary/10 focus-visible:outline-2 focus-visible:outline-primary"
              onClick={() => selectCategory(category.group)}
            >
              <FluentEmoji emoji={category.emoji} />
            </button>
          ))}
        </div>
        {selectedEmoji &&
        initialEntry &&
        !visible
          .slice(0, limit)
          .some(
            (entry) =>
              (entry.skins?.find((skin) => skin.tone === tone)?.emoji ??
                entry.emoji) === selectedEmoji,
          ) ? (
          <Button
            type="link"
            size="small"
            className="justify-self-start"
            onClick={locate}
          >
            {t("common.visualPicker.locate")}
          </Button>
        ) : null}
      </div>
      <div className="p-1">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(40px,1fr))] gap-1">
          {visible.slice(0, limit).map((entry) => {
            const emoji =
              entry.skins?.find((skin) => skin.tone === tone)?.emoji ??
              entry.emoji;
            return (
              <button
                key={entry.emoji}
                ref={selectedEmoji === emoji ? selectedRef : undefined}
                type="button"
                disabled={disabled}
                title={entry.annotation}
                aria-label={entry.annotation}
                aria-pressed={selectedEmoji === emoji}
                data-active={selectedEmoji === emoji}
                className="grid h-10 scroll-mt-36 cursor-pointer place-items-center rounded-lg border-0 bg-transparent text-[28px] hover:bg-mist data-[active=true]:bg-primary/10 focus-visible:outline-2 focus-visible:outline-primary"
                onClick={() => onSelect(emoji)}
              >
                <FluentEmoji emoji={emoji} />
              </button>
            );
          })}
        </div>
        {visible.length > limit ? (
          <div className="pt-3 text-center">
            <Button
              onClick={() => setLimit((current) => current + EMOJI_PAGE_SIZE)}
            >
              {t("common.visualPicker.loadMore")}
            </Button>
          </div>
        ) : null}
        {visible.length === 0 ? (
          <div role="status" className="py-12 text-center text-sm text-muted">
            {t("agent.editor.noMatches")}
          </div>
        ) : null}
      </div>
    </div>
  );
}
