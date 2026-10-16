import type { CSSProperties } from "react";

export const transparencySurfaceStyle = {
  backgroundColor: "var(--mist-deep)",
  backgroundImage:
    "linear-gradient(45deg, color-mix(in srgb, var(--line) 46%, transparent) 25%, transparent 25%), linear-gradient(-45deg, color-mix(in srgb, var(--line) 46%, transparent) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, color-mix(in srgb, var(--line) 46%, transparent) 75%), linear-gradient(-45deg, transparent 75%, color-mix(in srgb, var(--line) 46%, transparent) 75%)",
  backgroundPosition: "0 0, 0 10px, 10px -10px, -10px 0",
  backgroundSize: "20px 20px",
} satisfies CSSProperties;
