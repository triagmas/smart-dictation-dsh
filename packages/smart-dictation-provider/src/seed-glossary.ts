import type { GlossaryDocument, GlossaryEntry } from '@smart-dictation/core'

const SEED_DATE = '2026-11-12T00:00:00.000Z'

interface SeedTerm {
  readonly canonical: string
  readonly variants: readonly string[]
}

/**
 * Small, high-confidence starter vocabulary for spoken developer terms.
 * It covers the words this project actually uses; users can edit or delete
 * every entry. Seeds are returned only while no glossary file exists.
 */
const SEED_TERMS: readonly SeedTerm[] = [
  { canonical: 'DSH', variants: ['дш', 'ди эс эйч'] },
  { canonical: 'DeepSeek', variants: ['дипсик', 'дип сик'] },
  {
    canonical: 'Smart Dictation',
    variants: ['смарт диктейшн', 'смарт диктейшен', 'смарт диктовка']
  },
  {
    canonical: 'Kubernetes',
    variants: ['кубернетес', 'кубернетис', 'кибернетис', 'кгубернетес', 'кубернетс']
  },
  { canonical: 'Docker', variants: ['докер', 'доккер'] },
  { canonical: 'WSL', variants: ['всл', 'вэ эс эл', 'в с л'] },
  { canonical: 'Linux', variants: ['линукс', 'линух'] },
  { canonical: 'Windows', variants: ['виндовс', 'винда'] },
  { canonical: 'Git', variants: ['гит'] },
  { canonical: 'GitHub', variants: ['гитхаб', 'гит хаб'] },
  { canonical: 'GitLab', variants: ['гитлаб', 'гит лаб'] },
  { canonical: 'npm', variants: ['нпм', 'эн пи эм'] },
  { canonical: 'pnpm', variants: ['пнпм', 'пи эн пи эм'] },
  { canonical: 'Node.js', variants: ['нода', 'ноджейэс', 'нод жс'] },
  { canonical: 'TypeScript', variants: ['тайпскрипт', 'тайп скрипт'] },
  { canonical: 'JavaScript', variants: ['джаваскрипт', 'джава скрипт'] },
  { canonical: 'Python', variants: ['питон', 'пайтон'] },
  { canonical: 'React', variants: ['реакт'] },
  { canonical: 'Electron', variants: ['электрон'] },
  { canonical: 'Cordis', variants: ['кордис'] },
  { canonical: 'Hermes', variants: ['гермес'] },
  { canonical: 'Superpowers', variants: ['суперпауэрс', 'супер поверс'] },
  { canonical: 'API', variants: ['апи', 'эй пи ай'] },
  { canonical: 'MCP', variants: ['мсп', 'эм си пи'] },
  { canonical: 'JSON', variants: ['джейсон', 'жсон'] },
  { canonical: 'YAML', variants: ['ямл', 'ямп'] },
  { canonical: 'SQL', variants: ['скуль', 'эс кью эл'] },
  { canonical: 'CLI', variants: ['кли', 'си эл ай'] },
  { canonical: 'LLM', variants: ['эл эл эм', 'эль эль эм'] },
  { canonical: 'GPU', variants: ['гпу', 'джи пи ю'] },
  { canonical: 'CPU', variants: ['цпу', 'си пи ю'] },
  { canonical: 'UI', variants: ['юай', 'ю ай'] },
  { canonical: 'UX', variants: ['юикс', 'ю икс'] },
  { canonical: 'IDE', variants: ['иде', 'ай ди и'] },
  { canonical: 'ASR', variants: ['аср', 'эй эс ар'] },
  { canonical: 'ONNX', variants: ['оннкс', 'он икс'] },
  { canonical: 'ONNX Runtime', variants: ['оннкс рантайм', 'он икс рантайм'] },
  { canonical: 'GigaAM', variants: ['гигаам', 'гига ам', 'гига а эм'] },
  { canonical: 'GigaChat', variants: ['гигачат', 'гига чат'] },
  { canonical: 'OpenAI', variants: ['опен аи', 'опенай', 'опен эй ай'] },
  { canonical: 'VS Code', variants: ['вс код', 'вскод', 'ви эс код'] },
  { canonical: 'WER', variants: ['вэр', 'уэр'] },
  { canonical: 'C++', variants: ['си плюс плюс', 'ц плюс плюс', 'c++'] },
  { canonical: 'C#', variants: ['си шарп', 'ц шарп', 'c#'] },
  { canonical: 'Java', variants: ['джава', 'джаве', 'джаву', 'джавы', 'ява', 'java'] },
  { canonical: 'Kotlin', variants: ['котлин', 'котлине', 'котлина', 'kotlin'] },
  { canonical: 'Swift', variants: ['свифт', 'свифте', 'свифта', 'swift'] },
  { canonical: 'Go', variants: ['голанг', 'go'] },
  { canonical: 'Rust', variants: ['раст', 'расте', 'раста', 'rust'] },
  { canonical: 'PHP', variants: ['пхп', 'пи аш пи', 'php'] },
  { canonical: 'Ruby', variants: ['ruby', 'руби он рельс'] },
  { canonical: 'Dart', variants: ['дарт', 'дарте', 'дарта', 'dart'] },
  { canonical: 'Haskell', variants: ['хаскель', 'хаскелле', 'хаскелл', 'haskell'] },
  { canonical: 'Lua', variants: ['луа', 'lua'] },
  { canonical: 'MATLAB', variants: ['матлаб', 'матлабе', 'matlab'] },
  { canonical: 'Bash', variants: ['баш', 'баше', 'bash'] },
  { canonical: 'PowerShell', variants: ['пауэршелл', 'пауэршелле', 'повершелл', 'повершелле', 'powershell'] },
  { canonical: 'HTML', variants: ['аш ти эм эл', 'хтмл', 'html'] },
  { canonical: 'CSS', variants: ['си эс эс', 'цсс', 'css'] },
  { canonical: 'Vue', variants: ['вью', 'вью джей эс', 'vue'] },
  { canonical: 'Angular', variants: ['ангуляр', 'ангуляре', 'angular'] },
  { canonical: 'Svelte', variants: ['свелт', 'свелте', 'svelte'] },
  { canonical: 'Next.js', variants: ['некст', 'нексте', 'некст джей эс', 'next.js'] },
  { canonical: 'Nuxt', variants: ['накст', 'nuxt'] },
  { canonical: 'Django', variants: ['джанго', 'django'] },
  { canonical: 'Flask', variants: ['фласк', 'фласке', 'flask'] },
  { canonical: 'FastAPI', variants: ['фаст апи', 'fastapi'] },
  { canonical: 'Spring', variants: ['спринг', 'спринге'] },
  { canonical: '.NET', variants: ['дот нет', 'дот нете', '.net'] },
  { canonical: 'Unity', variants: ['юнити'] },
  { canonical: 'Unreal Engine', variants: ['анрил', 'анрил энджин', 'unreal engine'] },
  { canonical: 'Godot', variants: ['годо', 'godot'] },
  { canonical: 'Assembly', variants: ['ассемблер', 'ассемблере', 'assembly'] },
  { canonical: 'Solidity', variants: ['солидити', 'solidity'] },
  { canonical: 'Fortran', variants: ['фортран', 'фортране', 'fortran'] },
  { canonical: 'COBOL', variants: ['кобол', 'коболе', 'cobol'] },
  { canonical: 'Delphi', variants: ['делфи', 'delphi'] },
  { canonical: 'JSX', variants: ['джей эс икс', 'jsx'] },
  { canonical: 'TSX', variants: ['ти эс икс', 'tsx'] },
  { canonical: 'JSONL', variants: ['джейсон л', 'jsonl'] },
  { canonical: 'GraphQL', variants: ['граф кью эл', 'графкуэль', 'graphql'] },
  { canonical: 'gRPC', variants: ['джи ар пи си', 'grpc'] },
  { canonical: 'REST', variants: ['рест'] },
  { canonical: 'WebSocket', variants: ['вебсокет', 'web socket', 'websocket'] },
  { canonical: 'OAuth', variants: ['оавт', 'oauth'] },
  { canonical: 'JWT', variants: ['джей дабл ю ти', 'jwt'] },
  { canonical: 'SSH', variants: ['эс эс эйч', 'ssh'] },
  { canonical: 'HTTP', variants: ['аш ти ти пи', 'http'] },
  { canonical: 'HTTPS', variants: ['аш ти ти пи эс', 'https'] },
  { canonical: 'URL', variants: ['урл', 'ю ар эл', 'url'] },
  { canonical: 'SDK', variants: ['эс ди кей', 'sdk'] },
  { canonical: 'GUI', variants: ['гуи', 'gui'] },
  { canonical: 'TUI', variants: ['туи', 'tui'] },
  { canonical: 'RPC', variants: ['эр пи си', 'rpc'] },
  { canonical: 'IPC', variants: ['ай пи си', 'ipc'] },
  { canonical: 'CI', variants: ['си ай'] },
  { canonical: 'CD', variants: ['си ди'] },
  { canonical: 'PR', variants: ['пи ар'] },
  { canonical: 'TDD', variants: ['тдд', 'tdd'] },
  { canonical: 'E2E', variants: ['и ту и', 'e2e'] },
  { canonical: 'Codex', variants: ['кодекс', 'codex'] },
  { canonical: 'Claude', variants: ['клод', 'claude'] },
  { canonical: 'ChatGPT', variants: ['чатгпт', 'чат джи пи ти', 'chatgpt'] },
  { canonical: 'VoiceForge', variants: ['войсфордж', 'voiceforge'] },
  { canonical: 'VoxCPM', variants: ['вокс си пи эм', 'voxcpm'] },
  { canonical: 'CosyVoice3', variants: ['кози войс', 'cosyvoice'] },
  { canonical: 'CodeGraph', variants: ['кодграф', 'codegraph'] },
  { canonical: 'GenUI', variants: ['ген юай', 'genui'] },
  { canonical: 'OpenCLI', variants: ['опен кли', 'opencli'] },
  { canonical: 'WebUI', variants: ['веб юай', 'webui'] },
  { canonical: 'RuntimeManager', variants: ['рантайм менеджер', 'runtime manager'] },
  { canonical: 'AppData', variants: ['аппдата', 'appdata'] },
  { canonical: 'package.json', variants: ['пакет джейсон', 'package json', 'package.json'] },
  { canonical: 'app.asar', variants: ['апп асар', 'app.asar'] },
  { canonical: 'wsl.exe', variants: ['всл экзе', 'wsl.exe'] },
  { canonical: 'LinkedIn', variants: ['линкедин', 'linkedin'] },
  { canonical: 'YouTube', variants: ['ютуб', 'youtube'] },
  { canonical: 'RSS', variants: ['рсс', 'rss'] },
  { canonical: 'NSIS', variants: ['нсис', 'nsis'] },
  { canonical: 'POSIX', variants: ['позикс', 'posix'] },
  { canonical: 'SIGTERM', variants: ['сигтерм', 'sigterm'] },
  { canonical: 'UTC', variants: ['ю ти си', 'utc'] },
  { canonical: 'LINT', variants: ['линт', 'lint'] },
  { canonical: 'PID', variants: ['пид', 'pid'] },
  { canonical: 'CWD', variants: ['си дабл ю ди', 'cwd'] },
  { canonical: 'ENV', variants: ['энв', 'env'] },
  { canonical: 'VM', variants: ['ви эм', 'vm'] }
]

function idFor(canonical: string): string {
  return canonical
    .toLocaleLowerCase('ru-RU')
    .replace(/\+/gu, '-plus-')
    .replace(/#/gu, '-sharp-')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/gu, '') || 'term'
}

/** A fresh revision-0 document with the starter entries. */
export function seedGlossaryDocument(): GlossaryDocument {
  return {
    version: 1,
    revision: 0,
    origin: 'seed',
    entries: SEED_TERMS.map((term): GlossaryEntry => ({
      id: idFor(term.canonical),
      canonical: term.canonical,
      variants: [...term.variants],
      source: 'import',
      confidence: 1,
      seen: 0,
      createdAt: SEED_DATE,
      updatedAt: SEED_DATE
    }))
  }
}
