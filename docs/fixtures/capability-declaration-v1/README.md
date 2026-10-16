# Capability declaration v1 fixtures

These files are protocol-acceptance input, not scenario packs that current runtime can
import directly.

Each fixture pins:

- runner input;
- Workflow author policy;
- intended internal graph;
- capability parameter declarations and semantic ports;
- expected authoring UI;
- problems publication must catch.

| Fixture                | Coverage                                                    |
| ---------------------- | ----------------------------------------------------------- |
| `poster-simple.json`   | Rich Prompt, fixed built-in instructions, export boundary   |
| `poster-complete.json` | Optional reference, branch, enum default, result projection |
| `poster-complex.json`  | Capability chain, cutout bundle, structured composition     |

Verification requires:

1. Valid JSON.
2. Every `parameterKey` exists in the target capability declaration.
3. Every node reference uses `nodeId + outputKey`.
4. Rich Prompt stores segments rather than its editor trigger.
5. Output sources are reachable and semantically assignable.
6. The declaration can produce `expectedAuthoring` without UI-specific contract-key
   branches.
7. A capability marked `runtimeGap` blocks publication until implemented and never
   degrades silently.

`packages/contracts/test/workflow-poster-scenarios.test.ts` contains the corresponding
authoring-graph compiler checks. Application, Contracts, and Web tests separately
cover capability declarations, runtime `$string` and `$coalesce`, and same-bundle
foreground and mask binding.
