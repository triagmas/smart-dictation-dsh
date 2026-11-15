# @triagmas/dsh-smart-dictation

Installable DSH bundle for local Russian dictation with English technical terms.

From the GitHub Release:

```bash
dsh plugin --profile web add https://github.com/triagmas/smart-dictation-dsh/releases/download/v1.0.2/smart-dictation-dsh-bundle-1.0.2.tgz
```

The npm package (`@triagmas/dsh-smart-dictation`) still serves 1.0.1; after 1.0.2 is published, the
npm command is the same:

```bash
dsh plugin --profile web add @triagmas/dsh-smart-dictation
```

Restart DSH after installation. The first dictation downloads the GigaAM v3 model (~225 MB) to the
DSH data directory; later starts reuse it. No audio or transcript leaves the machine.

Use the microphone in the composer, then edit and send as usual. There is no auto-send. The
**Settings → Smart Dictation** section prepares the model and manages the glossary.

Do not enable the experimental official Voice Input bundle at the same time: both register the
`speech-to-text` service row and would compete for the microphone provider.

## Requirements

- DSH `>=0.2.2-rc.3 <0.3.0`
- Node.js 22.19+
- A working microphone and browser permission for the DSH Web origin
- ~400 MB free disk after `onnxruntime-node` and the model

## Privacy

Audio is captured only while recording, sent to the local Host over the authenticated DSH API, and
kept in memory until transcription. Transcripts are inserted into the draft; they are not logged.
The glossary is stored in the DSH data directory and cached in browser storage for offline reading.

## License

MIT. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
