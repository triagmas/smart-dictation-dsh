# @smart-dictation/dsh-provider

Host-local GigaAM v3 E2E CTC provider for the DSH `speech-to-text` service.

- Keeps audio and transcripts on the machine; no cloud API is called.
- Downloads the ~225 MB INT8 acoustic model once into the DSH data directory.
- Verifies SHA-256 and replaces a corrupt cached model automatically.
- Exposes the durable glossary through the `glossary/read` and `glossary/replace` Typert remotes.

## Configuration

```yaml
dataRoot: /absolute/path/to/model-cache
glossaryRoot: /absolute/path/to/glossary
threads: 4
```

`dataRoot` and `glossaryRoot` must be absolute. The bundle supplies both through `dshHomePath`.

## Model

GigaAM v3 E2E CTC, SALUTE AI / T-Bank, MIT. ONNX conversion by
[istupakov/gigaam-v3-onnx](https://huggingface.co/istupakov/gigaam-v3-onnx).
The small front-end preprocessor (`assets/gigaam_v3.onnx`) ships in this package.

## License

MIT. Third-party notices are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
