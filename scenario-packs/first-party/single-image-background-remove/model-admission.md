# IS-Net General model admission

The production candidate implementation family is IS-Net General:

- admitted license: MIT
- model input: RGB float32 NCHW at 1024 × 1024, normalized as `(channel - 128) / 256`
- Worker variant: `isnet-general`, SHA-256
  `cc2c9f5c1751b9737cb81e708ff0c5e9542c2205daed22418a4fd2ab5d4c481a`
- Browser variant: `isnet-general-fp16`, SHA-256
  `2eb4b5dda7ec41c617e59706e5aafa1f978c9a5f983d2518d9f0ae4d6eb04f20`
- pinned source commit: `imgly/isnet-general-onnx@440dea9095f704826361ef382869aa26773f7c2a`
- Worker runtime: ONNX Runtime Node + Sharp
- Browser runtime: ONNX Runtime Web WASM + Canvas 2D
- pinned execution libraries: ONNX Runtime Node/Web `1.27.0`, Sharp `0.35.3`
- pinned Browser release paths: `/models/isnet-general-fp16.onnx`, `/onnxruntime/`
- Browser Runtime Release digest:
  `sha256:a21ce7cbfa57faca82f7402726626f2cffb3b521eb05cac766338c4601d34228`
- ONNX Runtime JSEP loader SHA-256:
  `3ee381d20a80f51a788a1c4a5872f6f1d047538dd4342f4af00062de5f9ea4c6`
- ONNX Runtime JSEP WASM SHA-256:
  `78feeeb3d08f6bcee94d938ed322f69073bb8076b5f9d34697a574ffba8deb48`

Activation is fail-closed. A deployment must pin the exact model variant,
absolute/mapped source location, SHA-256 digest and `MIT` license record.
The repository intentionally does not vendor or download model weights.
Both production ImplementationRevision canonical configurations include this
exact admission record; changing the variant, bytes, source commit or license
therefore requires a new immutable revision and digest.

Current immutable implementation digests:

- Browser:
  `sha256:b6311c4fd0aab668ec707812dd0cdec65504c3787f5b86c23695f256c431ca45`
- Worker:
  `sha256:a7f9573a94de41247d12e8452eeba86f58c3eac11820f3367c87c4ad866e87d0`

The initial admission establishes a replaceable implementation boundary. It
does not establish the production quality threshold by itself; that threshold
is owned by the acceptance corpus and versioned Eval report.
