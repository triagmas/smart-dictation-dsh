# Smart Dictation

Local Russian dictation for the DSH composer. Speech recognition, punctuation, glossary correction
and learning all run on your machine. English developer terms stay in Latin script.

## Install

From npm:

```bash
dsh plugin --profile web add @triagmas/dsh-smart-dictation
```

Or from the GitHub Release:

```bash
dsh plugin --profile web add https://github.com/triagmas/smart-dictation-dsh/releases/download/v1.0.2/smart-dictation-dsh-bundle-1.0.2.tgz
```

Restart DSH and allow microphone access for the DSH Web origin.

## Use

1. Click the microphone in the composer. The same icon stops recording; it never grows into a toolbar.
2. The recognised text is inserted into the draft. Check and edit it before sending.
3. Open **Settings → Smart Dictation** to prepare the model, import/export the glossary, or disable learning.

The first dictation downloads the GigaAM v3 E2E CTC INT8 model (~225 MB). The model is cached under
the DSH data directory and verified on every start.

## Glossary

The glossary starts with common developer terms (Kubernetes, Docker, TypeScript, C++, C#, PR, CI,
Codex, package.json and others). Variants you dictate are corrected automatically. Delete a term you
do not want.

After you edit a term in the draft and send the message, DSH may offer to remember the correction.
Nothing is learned without pressing **Да**. Learning can be disabled in Settings.

## Privacy

Audio is held in browser memory only for the active recording and sent to the local DSH Host. No cloud
speech API is used. The glossary lives in the DSH data directory; `localStorage` is only a cache.

## Requirements and limits

- DSH `0.2.2-rc.3`–`0.2.x`, Node.js 22.19+, ~400 MB free disk.
- Russian speech with English technical terms; full English phrases are not supported yet.
- No auto-send, wake word, streaming subtitles, or speech synthesis.
- Do not enable the official experimental Voice Input bundle at the same time.
