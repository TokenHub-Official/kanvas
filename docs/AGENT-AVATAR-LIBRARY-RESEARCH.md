# Agent Semantic Avatar Library Research — 2026-09-05

## Scope and evidence boundary

This note records research performed on 2026-09-05 against official repositories,
documentation, and a local LobeHub checkout. No dependency was installed and no product
code was changed during the research phase. Judgments about small-size legibility and
visual fit were design hypotheses until the later implementation checks recorded below.

## Recommendation recorded at the time

The preferred source was a curated, locally hosted subset of
[Microsoft Fluent Emoji](https://github.com/microsoft/fluentui-emoji): concrete objects
such as books, palettes, microscopes, plants, and animals can distinguish Agent roles
without implying a vendor identity. The proposal was to select only objects tied to
real Agent purposes, add business-language search aliases, and compare Flat or Color
assets at dense-list sizes before considering 3D artwork.

LobeHub offered two distinct references. [Lobe Icons](https://github.com/lobehub/lobe-icons)
primarily represented AI vendors and models, while
[LobeHub Fluent Emoji](https://github.com/lobehub/fluent-emoji) was closer to a semantic
avatar source. The useful interaction reference was editing an Agent's identity from
its avatar control; adopting the entire Lobe UI or image-generation studio was not part
of the recommendation.

## Candidate comparison

| Candidate                                                             | Verified facts                                                                                                                                                                                                               | Assessment for Kanvas                                                                                                                     |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| [Lobe Icons](https://github.com/lobehub/lobe-icons)                   | MIT-licensed AI and LLM brand marks, distributed as React components and static assets                                                                                                                                       | Suitable for a specific model or Provider identity, but a vendor mark can misrepresent a general writing, research, or operations Agent.  |
| [LobeHub Fluent Emoji](https://github.com/lobehub/fluent-emoji)       | ESM wrapper around Microsoft artwork; its [component](https://github.com/lobehub/fluent-emoji/blob/master/src/FluentEmoji/index.tsx) used 3D artwork, an external CDN, lazy loading, and a system-emoji fallback at the time | Relevant interaction and asset reference. Installing the component would not itself satisfy local-hosting requirements.                   |
| [Microsoft Fluent Emoji](https://github.com/microsoft/fluentui-emoji) | Original MIT-licensed asset repository; the [Artist palette](https://github.com/microsoft/fluentui-emoji/tree/main/assets/Artist%20palette) includes 3D, Color, Flat, and High Contrast variants                             | Preferred source for a curated local subset. Flat and Color were the initial dense-list candidates; 3D required size and weight testing.  |
| [Phosphor](https://phosphoricons.com/)                                | MIT-licensed semantic icon set with regular, fill, and duotone weights; React supports per-icon imports                                                                                                                      | A restrained fallback. Duotone plus limited background color can aid recognition, although monochrome outlines may resemble action icons. |
| [OpenMoji](https://openmoji.org/)                                     | Color and black SVG/PNG artwork under CC BY-SA 4.0, with attribution and share-alike requirements documented in its [FAQ](https://www.openmoji.org/faq)                                                                      | A viable flat illustrative option, with a heavier licensing obligation and an unverified fit with the existing interface.                 |

The format sample confirmed that Microsoft's Artist palette Flat asset is SVG and its
3D asset is PNG. LobeHub's distributed SVG/WebP formats should not be confused with the
original Microsoft source formats, and the review did not assume every object had every
style. No candidate was ranked by unverified total icon count.

The local LobeHub snapshot used an `EmojiPicker` wrapper from `@lobehub/ui` and placed
that picker in the Agent profile artwork entry together with an image-studio entry. This
supported the avatar-as-identity-editor interaction, not the surrounding generation
features.

## Proposed product boundary

The proposed first release was a consistent semantic avatar subset with searchable
business aliases, while retaining uploaded avatars and real Brand logos. Names and
short purposes remained the primary identifiers. Assets would be hosted locally with
upstream license notices and loaded on demand. A full emoji search dependency, remote
CDN, or new global icon system was outside that proposal.

The related Agent resource picker was also assessed as better suited to a compact,
search-first single-column list than its then-current two-column cards. Suggested row
heights and icon sizes were design starting points only. The store and API were capped
at 100 Skills, so frontend rendering changes alone could not make a 101st result
reachable; server search or pagination would be required at that scale. No picker
redesign or hundred-item browser performance test was completed in this research task.

## Implementation record from 2026-09-05

The implementation that followed used 40 Phosphor 2.1.10 duotone semantic icons and
preserved existing icon keys without a storage migration. It added localized semantic
name search, a 40-pixel preview, and 36-pixel icon buttons.

Emoji selection used
[emoji-picker-element](https://github.com/nolanlawson/emoji-picker-element) 1.29.1 and
`emoji-picker-element-data` 1.8.0. Vite served the localized data from the application,
and the picker loaded in a separate chunk. It used native system emoji rather than
Fluent image assets. `patches/emoji-picker-element@1.29.1.patch` changed the UI and
index minimum search length from two characters to one; the regression suite covered
single-character search and the patch required revalidation on dependency upgrade.

At that time, Web and Server type checks, focused lint, seven Web tests, three contract
tests, contract generation, Database compilation, and a Web production build passed.
An existing Chrome session was used to verify localized icon search, save-and-refresh
readback, single-character emoji search, and emoji save/readback. Image upload,
ordinary-member permissions, the resource-list redesign, and a full repository test
run were not verified.

Generated contract output also contained pre-existing Skill-file API work from the
shared worktree. The Agent-only generated output used for that delivery came from an
isolated source snapshot; unfinished Skill-file changes remained outside that delivery.
