import fs from 'fs';
import path from 'path';

export function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function ensureFreshWorkDir(dirPath, label = 'work directory') {
  if (fs.existsSync(dirPath)) {
    const entries = fs.readdirSync(dirPath);
    if (entries.length > 0) {
      throw new Error(
        `${label} already exists and is not empty: ${dirPath}. Refusing to delete existing translation work. Apply the translations first, or move/remove the directory explicitly after preserving the output files.`,
      );
    }
  }

  ensureDir(dirPath);
}

export function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

export function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

export function readJsonl(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  if (!text.trim()) return [];
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, lineIndex) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`Failed to parse JSONL line ${lineIndex + 1} in ${filePath}: ${error.message}`);
      }
    });
}

export function writeJsonl(filePath, rows) {
  ensureDir(path.dirname(filePath));
  const lines = rows.map((row) => JSON.stringify(row));
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf8');
}

export function normalizeWhitespace(text) {
  return text.replace(/\s+/g, ' ').trim();
}

export function hasKana(text) {
  return /[\u3040-\u309f\u30a0-\u30ff\u31f0-\u31ff]/.test(text);
}

const NON_LATIN_UNTRANSLATED_ENGLISH_CHECK_LANGUAGES = new Set([
  'ar',
  'bg',
  'bn',
  'el',
  'fa',
  'he',
  'hi',
  'ja',
  'ko',
  'ru',
  'ta',
  'te',
  'th',
  'uk',
  'ur',
  'zh',
]);

export function primaryLanguageForLocale(locale) {
  if (typeof locale !== 'string') return null;
  const [language] = locale.split('-');
  return language ? language.toLowerCase() : null;
}

export function shouldRejectJapaneseKana(locale) {
  return primaryLanguageForLocale(locale) !== 'ja';
}

export function shouldCheckObviousUntranslatedEnglish(locale) {
  const language = primaryLanguageForLocale(locale);
  if (!language || language === 'en') return false;

  return NON_LATIN_UNTRANSLATED_ENGLISH_CHECK_LANGUAGES.has(language);
}

export function hasObviousUntranslatedEnglish(text) {
  const hasCjk = /[\u4e00-\u9fff]/.test(text);
  if (hasCjk) return false;

  if (/[`{}()<>\[\]\/\\:=@#%*]/.test(text)) {
    return false;
  }

  if (/^(openid|profile|email|offline_access)(\s+(openid|profile|email|offline_access))*$/.test(text)) {
    return false;
  }

  if (/^©\s*\d{4}\s+[A-Z0-9 ]+$/.test(text)) {
    return false;
  }

  if (/^(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}(?:\/[^\s]*)?$/.test(text)) {
    return false;
  }

  if (text === 'Alex Johnson') {
    return false;
  }

  if (text === 'Research Labs Premium') {
    return false;
  }

  if (/^(?:[A-Za-z0-9]+|[⌘⌥⌃⇧]+)(?:\s*\+\s*(?:[A-Za-z0-9]+|[⌘⌥⌃⇧]+))+$/u.test(text)) {
    return false;
  }

  const wordMatches = text.match(/[A-Za-z][A-Za-z'’-]*/g) || [];
  const words = wordMatches.filter((word) => word.length >= 2);
  const whitelistedBrandPattern =
    /\bClaude\b|\bAnthropic\b|\bClaude Code\b|\bClaude Code Desktop\b|\bClaude for Chrome\b|\bCowork\b|\bDispatch\b|\bCanvas\b|\bArtifact\b|\bMCP\b|\bAPI\b|\bOAuth\b|\bSAML\b|\bSCIM\b|\bSSO\b|\bAWS\b|\bAmazon\b|\bAmazon Bedrock\b|\bGoogle\b|\bGitHub\b|\bSlack\b|\bMicrosoft 365\b|\bMicrosoft Office\b|\bMicrosoft Foundry\b|\bVS Code\b|\bCursor\b|\bWindsurf\b|\bOpus\b|\bSonnet\b|\bHaiku\b/;

  const titleCaseLike = words.length > 0 && words.every((word) => /^[A-Z][a-z]+(?:['’-][A-Z][a-z]+)?$/.test(word) || /^[A-Z0-9]+$/.test(word));

  if (words.length >= 2 && words.length <= 5 && titleCaseLike) {
    if (whitelistedBrandPattern.test(text)) {
      return false;
    }
    return true;
  }

  if (words.length >= 3 && text.length >= 24) {
    if (whitelistedBrandPattern.test(text) && words.length <= 5) {
      return false;
    }
    return true;
  }

  return false;
}

export function extractBacktickSegments(text) {
  return text.match(/`[^`]*`/g) || [];
}

export function extractUrls(text) {
  return (text.match(/https?:\/\/[^\s<>()]+/g) || []).map((url) =>
    url.replace(/[.,!?;:)\]}>"'`。，！？；：）】｝〉》」』]+$/gu, ''),
  );
}

export function extractEmails(text) {
  return text.match(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g) || [];
}

export function extractHtmlTags(text) {
  return text.match(/<\/?[A-Za-z][^>]*?>/g) || [];
}

function readBalancedBlock(text, openIndex) {
  let depth = 0;
  for (let index = openIndex; index < text.length; index += 1) {
    const char = text[index];
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return {
          content: text.slice(openIndex + 1, index),
          endIndex: index,
        };
      }
    }
  }

  throw new Error('Unbalanced braces');
}

function splitTopLevelCommas(text) {
  const parts = [];
  let depth = 0;
  let start = 0;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
    } else if (char === ',' && depth === 0) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }

  parts.push(text.slice(start));
  return parts;
}

function parseBranches(text) {
  const branches = [];
  let index = 0;

  while (index < text.length) {
    while (index < text.length && /\s/.test(text[index])) index += 1;
    if (index >= text.length) break;

    const keyStart = index;
    while (index < text.length && !/\s|\{/.test(text[index])) index += 1;
    const key = text.slice(keyStart, index);
    while (index < text.length && /\s/.test(text[index])) index += 1;
    if (text[index] !== '{') {
      throw new Error(`Expected branch body for ICU branch "${key}"`);
    }
    const { content, endIndex } = readBalancedBlock(text, index);
    branches.push({ key, body: content });
    index = endIndex + 1;
  }

  return branches;
}

function parseBraceNode(rawContent) {
  const content = rawContent.trim();

  if (/^[A-Za-z0-9_.-]+$/.test(content)) {
    return { type: 'placeholder', name: content };
  }

  const parts = splitTopLevelCommas(content);
  if (parts.length >= 2) {
    const name = parts[0].trim();
    const format = parts[1].trim();
    const rest = parts.slice(2).join(',').trim();

    if (/^[A-Za-z0-9_.-]+$/.test(name) && /^[A-Za-z][A-Za-z0-9_-]*$/.test(format)) {
      if (/^(plural|select|selectordinal)$/.test(format)) {
        return {
          type: 'icu',
          name,
          format,
          branches: parseBranches(rest).map((branch) => ({
            key: branch.key,
            nodes: parseMessageStructure(branch.body),
          })),
        };
      }

      return {
        type: 'format',
        name,
        format,
        rest: normalizeWhitespace(rest),
      };
    }
  }

  return { type: 'raw', text: normalizeWhitespace(content) };
}

export function parseMessageStructure(text) {
  const nodes = [];
  let index = 0;

  while (index < text.length) {
    const openIndex = text.indexOf('{', index);
    if (openIndex === -1) break;
    const { content, endIndex } = readBalancedBlock(text, openIndex);
    nodes.push(parseBraceNode(content));
    index = endIndex + 1;
  }

  return nodes;
}

function signatureForNode(node) {
  if (node.type === 'placeholder') {
    return `PH:${node.name}`;
  }
  if (node.type === 'format') {
    return `FMT:${node.name}|${node.format}|${node.rest}`;
  }
  if (node.type === 'icu') {
    const branchSignatures = node.branches
      .map((branch) => `${branch.key}[${signatureList(branch.nodes).join(',')}]`)
      .sort();
    return `ICU:${node.name}|${node.format}|${branchSignatures.join(';')}`;
  }
  return `RAW:${node.text}`;
}

function signatureList(nodes) {
  return nodes.map(signatureForNode).sort();
}

export function compareMessageStructure(sourceText, targetText, contextLabel) {
  const sourceBackticks = extractBacktickSegments(sourceText);
  const targetBackticks = extractBacktickSegments(targetText);
  if (sourceBackticks.length !== targetBackticks.length || sourceBackticks.some((token, index) => token !== targetBackticks[index])) {
    throw new Error(`${contextLabel}: backtick segments changed`);
  }

  const sourceUrls = extractUrls(sourceText);
  const targetUrls = extractUrls(targetText);
  if (sourceUrls.length !== targetUrls.length || sourceUrls.some((token, index) => token !== targetUrls[index])) {
    throw new Error(`${contextLabel}: URLs changed`);
  }

  const sourceEmails = extractEmails(sourceText);
  const targetEmails = extractEmails(targetText);
  if (sourceEmails.length !== targetEmails.length || sourceEmails.some((token, index) => token !== targetEmails[index])) {
    throw new Error(`${contextLabel}: email addresses changed`);
  }

  const sourceTags = extractHtmlTags(sourceText);
  const targetTags = extractHtmlTags(targetText);
  if (sourceTags.length !== targetTags.length || sourceTags.some((token, index) => token !== targetTags[index])) {
    throw new Error(`${contextLabel}: HTML tags changed`);
  }

  const sourceNodes = parseMessageStructure(sourceText);
  const targetNodes = parseMessageStructure(targetText);
  const sourceSignatures = signatureList(sourceNodes);
  const targetSignatures = signatureList(targetNodes);

  if (
    sourceSignatures.length !== targetSignatures.length ||
    sourceSignatures.some((signature, index) => signature !== targetSignatures[index])
  ) {
    throw new Error(`${contextLabel}: brace structure changed`);
  }
}
