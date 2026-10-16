import { useState } from "react";
import assets from "./fluent-emoji-assets.generated.json";
const hexadecimalRadix = 16;
const minimumCodePointLength = 4;

export function fluentEmojiSource(emoji: string): string | undefined {
  const key = Array.from(emoji)
    .map((character) =>
      character
        .codePointAt(0)!
        .toString(hexadecimalRadix)
        .padStart(minimumCodePointLength, "0"),
    )
    .filter((part) => part !== "fe0f")
    .join("-");
  const filename = (assets as Readonly<Record<string, string>>)[key];
  return filename
    ? `${import.meta.env.BASE_URL}fluent-emoji/1.1.0/${filename}`
    : undefined;
}

/** Semantic Unicode stays in the value; only its visual presentation is replaced. */
export function FluentEmoji({
  emoji,
}: {
  readonly emoji: string;
}): React.JSX.Element {
  const source = fluentEmojiSource(emoji);
  return <EmojiImage key={source ?? emoji} emoji={emoji} source={source} />;
}

function EmojiImage({
  emoji,
  source,
}: {
  readonly emoji: string;
  readonly source: string | undefined;
}): React.JSX.Element {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  return (
    <span
      role="img"
      aria-label={emoji}
      className="relative inline-flex size-[1em] shrink-0 items-center justify-center align-middle leading-none"
    >
      <span aria-hidden="true" style={{ opacity: loaded && !failed ? 0 : 1 }}>
        {emoji}
      </span>
      {source && !failed ? (
        <img
          alt=""
          draggable={false}
          loading="lazy"
          className="absolute inset-0 size-full object-contain"
          style={{ opacity: loaded ? 1 : 0 }}
          src={source}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
        />
      ) : null}
    </span>
  );
}
