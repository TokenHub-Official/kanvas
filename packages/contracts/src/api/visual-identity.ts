import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

const AgentAvatarBackgroundSchema = Type.String({
  pattern: "^#[0-9A-Fa-f]{6}$",
});

export const VisualIdentitySymbolSchema = Type.Union([
  Type.Object(
    {
      kind: Type.Literal("emoji"),
      value: Type.String({ minLength: 1, maxLength: 32 }),
      backgroundColor: AgentAvatarBackgroundSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("icon"),
      value: Type.Union([
        Type.Literal("robot"),
        Type.Literal("sparkles"),
        Type.Literal("palette"),
        Type.Literal("picture"),
        Type.Literal("bulb"),
        Type.Literal("pen"),
        Type.Literal("camera"),
        Type.Literal("team"),
        Type.Literal("brain"),
        Type.Literal("book"),
        Type.Literal("research"),
        Type.Literal("code"),
        Type.Literal("chart"),
        Type.Literal("compass"),
        Type.Literal("globe"),
        Type.Literal("rocket"),
        Type.Literal("target"),
        Type.Literal("puzzle"),
        Type.Literal("music"),
        Type.Literal("film"),
        Type.Literal("megaphone"),
        Type.Literal("briefcase"),
        Type.Literal("graduation"),
        Type.Literal("shield"),
        Type.Literal("heart"),
        Type.Literal("leaf"),
        Type.Literal("tree"),
        Type.Literal("sun"),
        Type.Literal("planet"),
        Type.Literal("cat"),
        Type.Literal("dog"),
        Type.Literal("butterfly"),
        Type.Literal("coffee"),
        Type.Literal("diamond"),
        Type.Literal("game"),
        Type.Literal("building"),
        Type.Literal("flask"),
        Type.Literal("calculator"),
        Type.Literal("translate"),
        Type.Literal("magic"),
      ]),
      backgroundColor: AgentAvatarBackgroundSchema,
      foregroundColor: Type.Optional(AgentAvatarBackgroundSchema),
    },
    { additionalProperties: false },
  ),
]);

export type VisualIdentitySymbol = Static<typeof VisualIdentitySymbolSchema>;
export function isVisualIdentitySymbol(
  value: unknown,
): value is VisualIdentitySymbol {
  return Value.Check(VisualIdentitySymbolSchema, value);
}
