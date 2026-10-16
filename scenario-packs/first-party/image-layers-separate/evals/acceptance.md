# Image layers separate Workflow acceptance

This is a composition Workflow, not a compute Capability. It pins existing
`image.subject.detect`, `image.background.remove` and `image.text.extract`
Contract revisions and preserves each node's Route, quality and recovery
semantics.

The first version returns a trusted transparent foreground and subject Mask,
ordered subject candidates, OCR blocks/regions and separate quality signals.
It does not claim semantic reconstruction of hidden background or arbitrary
editable object layers.

Minimum release gates:

- no new model, Provider request or hidden fallback is introduced by the
  Workflow;
- every Artifact and region retains its originating node evidence;
- low OCR confidence remains a successful quality fact;
- partial Workflow failure remains recoverable from completed immutable node
  outputs;
- Eval reports subject Mask/foreground quality and OCR quality separately.
