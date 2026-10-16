# Provider Model Configuration Research — 2026-09-08

## Scope and evidence boundary

This was a read-only study of local source snapshots for New API commit
`8f6961c675932f406260ff0c218bc2aa0603e9b2` and LobeHub commit
`5cb99eecff280c2563de99f8afd1bb7f536db45c`, together with the cited fal and
WaveSpeed documentation. The repositories were not started and no real model calls
were made. These pinned snapshots do not represent the latest upstream releases. The
study did not change Kanvas code, model configuration, or paid-generation state.

The main finding was that a simple model setup depends on maintained protocol
adapters and accurate model parameter catalogs. A model name does not determine its
wire protocol. Kanvas should provide explicit Provider, model, and operation presets,
allow administrators to review differences, and keep low-level model configuration
away from Agents.

## New API findings

New API channels include model lists, model mapping, parameter overrides, and related
channel settings. Its image path copies the request, applies model mapping, selects an
adapter, converts or passes through the request, applies configured overrides, and
sends the HTTP request. The pinned evidence is in the
[channel fields](https://github.com/QuantumNous/new-api/blob/8f6961c675932f406260ff0c218bc2aa0603e9b2/model/channel.go#L35-L51),
[adapter dispatch](https://github.com/QuantumNous/new-api/blob/8f6961c675932f406260ff0c218bc2aa0603e9b2/relay/relay_adaptor.go#L56-L75),
and [image request path](https://github.com/QuantumNous/new-api/blob/8f6961c675932f406260ff0c218bc2aa0603e9b2/relay/image_handler.go#L24-L55).
The upstream project also documents
[channel parameter overrides](https://docs.newapi.pro/en/docs/guide/console/channel-management).

This means code carries most of the complexity for a supported channel. Model mapping
can reconcile public and upstream model names, while parameter overrides can reconcile
field differences. Neither mechanism replaces protocol handling for uploads,
asynchronous tasks, polling, or response parsing.

The pinned source contained no native `fal.ai`, `fal-ai`, or `wavespeed` adapter in the
reviewed dispatch path. There was therefore no evidence that their native image APIs
could be enabled by configuration alone. A claimed compatibility endpoint would still
need its image-specific behavior verified. OpenAI-compatible chat does not imply
OpenAI-compatible image generation.

The Advanced Custom image path still delegates to its OpenAI-compatible image
conversion when no alternate converter is selected; it is not a general interpreter
for arbitrary model APIs. See the pinned
[Advanced Custom image conversion](https://github.com/QuantumNous/new-api/blob/8f6961c675932f406260ff0c218bc2aa0603e9b2/relay/channel/advancedcustom/adaptor.go#L173-L182).

Error handling reads the upstream body and attempts to parse a standard error shape.
For non-JSON responses with body exposure disabled, it logs a preview and can return
only the status code. Status-code mapping may also change the downstream response.
New API therefore was not evidence that the original upstream error always reaches a
caller. See the pinned
[relay error handler](https://github.com/QuantumNous/new-api/blob/8f6961c675932f406260ff0c218bc2aa0603e9b2/service/error.go#L87-L124).

## LobeHub findings

LobeHub's model bank defines concrete models per Provider. The pinned fal catalog
contains image-input limits and other model-specific parameters, while OpenAI image
models use maintained parameter presets. The parameter type system is itself a
platform contract rather than an executor for arbitrary Provider schemas:

- [fal model catalog](https://github.com/lobehub/lobehub/blob/5cb99eecff280c2563de99f8afd1bb7f536db45c/packages/model-bank/src/aiModels/fal.ts#L60-L85)
- [built-in image parameter presets](https://github.com/lobehub/lobehub/blob/5cb99eecff280c2563de99f8afd1bb7f536db45c/packages/model-bank/src/const/imageParameters.ts#L20-L44)
- [standard parameter types](https://github.com/lobehub/lobehub/blob/5cb99eecff280c2563de99f8afd1bb7f536db45c/packages/model-bank/src/standard-parameters/index.ts#L250-L284)

The fal runtime maps fields such as `imageUrls` and width/height into Provider-native
input. The OpenAI-compatible runtime converts image URLs to files and chooses edit or
generation behavior based on image input, with additional model-family branches. This
again shows that mature products rely on maintained data and code with explicit
applicability:

- [fal request conversion](https://github.com/lobehub/lobehub/blob/5cb99eecff280c2563de99f8afd1bb7f536db45c/packages/model-runtime/src/providers/fal/index.ts#L36-L74)
- [OpenAI-compatible image conversion](https://github.com/lobehub/lobehub/blob/5cb99eecff280c2563de99f8afd1bb7f536db45c/packages/model-runtime/src/core/openaiCompatibleFactory/createImage.ts#L35-L75)

The database synchronization path can accept non-empty remote parameter documents,
but that does not prove support for every third-party schema or a complete visual
configuration flow. See the pinned
[model parameter update](https://github.com/lobehub/lobehub/blob/5cb99eecff280c2563de99f8afd1bb7f536db45c/packages/database/src/models/aiModel.ts#L441-L469).

LobeHub exposes image-model listing, parameter lookup, and image generation tools. The
tool description directs the Agent to fetch a model's parameter schema before sending
model-specific parameters, and parameter lookup returns the schema and defaults. See
the pinned [tool manifest](https://github.com/lobehub/lobehub/blob/5cb99eecff280c2563de99f8afd1bb7f536db45c/packages/builtin-tool-image-generation/src/manifest.ts#L6-L45)
and [parameter lookup](https://github.com/lobehub/lobehub/blob/5cb99eecff280c2563de99f8afd1bb7f536db45c/packages/builtin-tool-image-generation/src/ExecutionRuntime/index.ts#L325-L354).
This supports a discover, inspect, then invoke sequence. Kanvas should apply that
sequence at the Capability layer rather than expose model selection to the Agent.

The reviewed tool returns task errors, but its message selection prefers a string body,
then `body.detail`, then `error.name`. This does not prove that every upstream JSON
`message` survives into Agent text. See the pinned
[task error formatting](https://github.com/lobehub/lobehub/blob/5cb99eecff280c2563de99f8afd1bb7f536db45c/packages/builtin-tool-image-generation/src/ExecutionRuntime/index.ts#L105-L122).

## Machine-readable Provider schemas

The [fal model API](https://fal.ai/docs/platform-apis/v1/models) can return endpoint
OpenAPI, and the [WaveSpeed model list](https://wavespeed.ai/docs/list-models) includes
an API path and request schema. These sources can deterministically populate a draft.
Kanvas still has to define business roles, upload handling, execution lifecycle, and
which schema constraints it has actually verified.

## Recommendations recorded at the time

Kanvas should own the one-time integration complexity:

1. Implement and test a Provider adapter for upload, submit, poll, result, and error
   behavior.
2. Maintain presets scoped to an exact Provider, model, and operation. Shared templates
   should use explicit references rather than name-pattern inference.
3. Import remote schemas into editable, versioned configuration drafts without silently
   dropping unknown constraints.
4. Preselect known adapters and parameter presets, exposing advanced configuration only
   for exceptional models.

The ordinary administrator path should remain two steps: configure and test a model,
then associate that tested model with a text-to-image or image-to-image Capability.
Implementation, deployment, and binding records can remain governed internals created
by those product operations. Pricing and execution budgets remain separate controls.

Agents should discover a Capability, inspect that Capability's bounded fields and
examples, and invoke the exact Capability revision. Provider descriptions are for
administrators; Capability descriptions are for Agents. A Capability must not expose a
union of parameters from several models and then silently route to an implementation
that accepts less.

For the two TokenHub models considered on 2026-09-08, the proposed mapping was:

- `gpt-image-2`: text-to-image, with no reference-image input.
- `gpt-image-2-edit`: image-to-image, with required source image and prompt. Exact image
  counts, formats, and limits still required authoritative evidence and real testing.

The intended acceptance work was to prove save/readback, identical effective
parameters in Capability detail and Agent inspection, correct text-versus-image routing,
two successful real outputs, and redacted upstream failure text reaching the Agent.
None of those product acceptance checks was performed during this research task.
