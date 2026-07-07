import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  compareMessageStructure,
  ensureDir,
  hasKana,
  hasObviousUntranslatedEnglish,
  readJson,
  readJsonl,
  readLocaleObject,
  shouldCheckObviousUntranslatedEnglish,
  shouldRejectJapaneseKana,
  writeJson,
} from './shared.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..', '..');
const DEFAULT_PENDING_DIR = path.join(ROOT_DIR, '.pending', 'create-full-locale');
const DEFAULT_OUTPUT_FIELD = 'translation';

function usage() {
  throw new Error('Usage: node apply_translation.mjs --locale <locale> [--pending-dir <path>]');
}

function parseArgs(argv) {
  const args = {
    locale: null,
    pendingDir: DEFAULT_PENDING_DIR,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === '--locale' && next) {
      args.locale = next;
      index += 1;
    } else if (token === '--pending-dir' && next) {
      args.pendingDir = path.resolve(next);
      index += 1;
    } else {
      usage();
    }
  }

  if (!args.locale) usage();
  if (!/^[a-z]{2,3}-[A-Z]{2}$/.test(args.locale)) {
    throw new Error(`Invalid target locale: ${args.locale}. Use canonical language-region tags like fr-FR.`);
  }
  return args;
}

function resolveRepoPath(filePath) {
  return path.isAbsolute(filePath) ? filePath : path.join(ROOT_DIR, filePath);
}

function toRepoRelative(filePath) {
  return path.relative(ROOT_DIR, filePath).split(path.sep).join('/');
}

function workDirFor(pendingDir, locale) {
  return path.join(pendingDir, locale);
}

function loadManifest(pendingDir, locale) {
  const manifestPath = path.join(workDirFor(pendingDir, locale), 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Missing full-locale manifest: ${manifestPath}`);
  }
  return readJson(manifestPath);
}

function outputFieldFor(manifest) {
  if (typeof manifest.outputField === 'string' && manifest.outputField.trim() !== '') {
    return manifest.outputField;
  }
  return DEFAULT_OUTPUT_FIELD;
}

function validateChunk(inputRows, outputRows, label, options) {
  if (inputRows.length !== outputRows.length) {
    throw new Error(`${label}: row count mismatch (${outputRows.length} vs ${inputRows.length})`);
  }

  for (let index = 0; index < inputRows.length; index += 1) {
    const inputRow = inputRows[index];
    const outputRow = outputRows[index];
    const rowLabel = `${label}#${index + 1} (${inputRow.key})`;

    if (inputRow.file !== outputRow.file || inputRow.index !== outputRow.index || inputRow.key !== outputRow.key) {
      throw new Error(`${rowLabel}: file/index/key mismatch`);
    }

    const translated = outputRow[options.outputField];
    if (typeof translated !== 'string' || translated.trim() === '') {
      throw new Error(`${rowLabel}: ${options.outputField} is empty or not a string`);
    }
    if (translated.includes('�')) {
      throw new Error(`${rowLabel}: contains replacement character`);
    }
    if (/\bTODO\b/i.test(translated)) {
      throw new Error(`${rowLabel}: contains TODO`);
    }
    if (shouldRejectJapaneseKana(options.targetLocale) && hasKana(translated)) {
      throw new Error(`${rowLabel}: contains Japanese kana`);
    }
    if (shouldCheckObviousUntranslatedEnglish(options.targetLocale) && hasObviousUntranslatedEnglish(translated)) {
      throw new Error(`${rowLabel}: looks like untranslated English`);
    }

    compareMessageStructure(inputRow.en, translated, rowLabel);
  }
}

function collectTranslations(chunkInfos, fileLabel, options) {
  const translations = new Map();

  for (const chunkInfo of chunkInfos) {
    const inputRows = readJsonl(chunkInfo.inputPath);
    if (!fs.existsSync(chunkInfo.outputPath)) {
      throw new Error(`Missing translated chunk: ${chunkInfo.outputPath}`);
    }
    const outputRows = readJsonl(chunkInfo.outputPath);
    validateChunk(inputRows, outputRows, path.basename(chunkInfo.outputPath), options);

    for (const row of outputRows) {
      if (translations.has(row.key)) {
        throw new Error(`${fileLabel}: duplicate translated key ${row.key}`);
      }
      translations.set(row.key, row[options.outputField]);
    }
  }

  return translations;
}

function rebuildLocaleFile(fileLabel, baseData, translations) {
  const result = {};
  const keys = Object.keys(baseData);

  keys.forEach((key) => {
    const translated = translations.get(key);
    if (typeof translated !== 'string' || translated.length === 0) {
      throw new Error(`${fileLabel}:${key}: missing translated value`);
    }
    result[key] = translated;
  });

  if (translations.size !== keys.length) {
    throw new Error(`${fileLabel}: translated key count mismatch (${translations.size} vs ${keys.length})`);
  }

  return result;
}

function readLocalesJson() {
  const localesPath = path.join(ROOT_DIR, 'locales.json');
  const data = readJson(localesPath);
  if (!data || typeof data !== 'object' || !Array.isArray(data.locales)) {
    throw new Error(`${localesPath}: expected an object with a locales array`);
  }
  return { localesPath, data };
}

function writeLocalesJson(localesPath, data) {
  const locales = data.locales.map((locale) => JSON.stringify(locale)).join(', ');
  const version = typeof data.version === 'string' ? data.version : '0000000';
  fs.writeFileSync(localesPath, `{\n  "version": ${JSON.stringify(version)},\n  "locales": [${locales}]\n}\n`, 'utf8');
}

function assertTargetCanBeWritten(locale, manifest) {
  const outputMainPath = resolveRepoPath(manifest.output.main);
  const outputDynamicPath = resolveRepoPath(manifest.output.dynamic);
  const targetDir = path.dirname(outputMainPath);

  if (fs.existsSync(targetDir) || fs.existsSync(outputMainPath) || fs.existsSync(outputDynamicPath)) {
    throw new Error(`Target locale already exists at ${targetDir}`);
  }

  const { data } = readLocalesJson();
  if (data.locales.includes(locale)) {
    throw new Error(`Target locale ${locale} is already listed in locales.json`);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifest = loadManifest(args.pendingDir, args.locale);
  if (manifest.locale !== args.locale) {
    throw new Error(`Manifest locale ${manifest.locale} does not match requested locale ${args.locale}`);
  }

  const outputField = outputFieldFor(manifest);
  assertTargetCanBeWritten(args.locale, manifest);

  const validationOptions = {
    outputField,
    targetLocale: manifest.locale ?? args.locale,
  };
  const mainTranslations = collectTranslations(manifest.chunks.main, 'main', validationOptions);
  const dynamicTranslations = collectTranslations(manifest.chunks.dynamic, 'dynamic', validationOptions);

  const baseMainData = readLocaleObject(resolveRepoPath(manifest.source.main.base), `${manifest.baseLocale}:main`);
  const baseDynamicData = readLocaleObject(resolveRepoPath(manifest.source.dynamic.base), `${manifest.baseLocale}:dynamic`);
  const nextMainData = rebuildLocaleFile('main', baseMainData, mainTranslations);
  const nextDynamicData = rebuildLocaleFile('dynamic', baseDynamicData, dynamicTranslations);

  const outputMainPath = resolveRepoPath(manifest.output.main);
  const outputDynamicPath = resolveRepoPath(manifest.output.dynamic);
  ensureDir(path.dirname(outputMainPath));
  writeJson(outputMainPath, nextMainData);
  writeJson(outputDynamicPath, nextDynamicData);

  const { localesPath, data: localesData } = readLocalesJson();
  if (!localesData.locales.includes(args.locale)) {
    localesData.locales.push(args.locale);
  }
  writeLocalesJson(localesPath, localesData);

  const workDir = workDirFor(args.pendingDir, args.locale);
  fs.rmSync(workDir, { recursive: true, force: true });

  console.log(
    JSON.stringify(
      {
        locale: args.locale,
        baseLocale: manifest.baseLocale,
        referenceLocale: manifest.referenceLocale,
        contextLocale: manifest.contextLocale,
        outputField,
        main: Object.keys(nextMainData).length,
        dynamic: Object.keys(nextDynamicData).length,
        registeredLocale: true,
        clearedWorkDir: toRepoRelative(workDir),
      },
      null,
      2,
    ),
  );
}

main();
