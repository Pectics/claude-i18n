import fs from 'node:fs';
import path from 'node:path';
import { hashJson, readJson, serializeJson } from './shared.mjs';

export const BASELINE_SCHEMA_VERSION = 1;

export function localeFileName(baseLocale, fileLabel) {
  return fileLabel === 'dynamic' ? `${baseLocale}.dynamic.json` : `${baseLocale}.json`;
}

export function localeFilePath(dirPath, baseLocale, fileLabel) {
  return path.join(dirPath, localeFileName(baseLocale, fileLabel));
}

export function readLocaleObject(filePath, label = filePath) {
  const data = readJson(filePath);
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(`${label}: expected a flat JSON object`);
  }

  for (const [key, value] of Object.entries(data)) {
    if (typeof value !== 'string') {
      throw new Error(`${label}: value for ${key} is not a string`);
    }
  }

  return data;
}

export function snapshotFor(data) {
  return {
    keyCount: Object.keys(data).length,
    sha256: hashJson(data),
  };
}

export function baselinePaths(baselineDir, baseLocale) {
  return {
    main: localeFilePath(baselineDir, baseLocale, 'main'),
    dynamic: localeFilePath(baselineDir, baseLocale, 'dynamic'),
    metadata: path.join(baselineDir, 'metadata.json'),
  };
}

export function createVerifiedMetadata({
  locale,
  baseLocale,
  mainData,
  dynamicData,
  previousMetadata = null,
  updatedAt = new Date().toISOString(),
}) {
  return {
    schemaVersion: BASELINE_SCHEMA_VERSION,
    locale,
    baseLocale,
    status: 'verified',
    initializedAt: previousMetadata?.initializedAt ?? updatedAt,
    updatedAt,
    files: {
      main: {
        path: localeFileName(baseLocale, 'main'),
        ...snapshotFor(mainData),
      },
      dynamic: {
        path: localeFileName(baseLocale, 'dynamic'),
        ...snapshotFor(dynamicData),
      },
    },
  };
}

export function createUnverifiedMetadata({
  locale,
  baseLocale,
  reason,
  verification,
  updatedAt = new Date().toISOString(),
}) {
  return {
    schemaVersion: BASELINE_SCHEMA_VERSION,
    locale,
    baseLocale,
    status: 'unverified',
    updatedAt,
    reason,
    verification,
  };
}

function assertMetadataSnapshot(metadata, fileLabel, data, metadataPath) {
  const expected = metadata.files?.[fileLabel];
  if (!expected || typeof expected !== 'object') {
    throw new Error(`${metadataPath}: missing ${fileLabel} baseline metadata`);
  }

  const actual = snapshotFor(data);
  if (expected.keyCount !== actual.keyCount || expected.sha256 !== actual.sha256) {
    throw new Error(`${metadataPath}: ${fileLabel} baseline hash or key count is stale`);
  }
}

export function readVerifiedBaseline({ baselineDir, locale, baseLocale }) {
  const paths = baselinePaths(baselineDir, baseLocale);
  if (!fs.existsSync(paths.metadata)) {
    throw new Error(`Missing baseline metadata for ${locale}: ${paths.metadata}`);
  }

  const metadata = readJson(paths.metadata);
  if (metadata.schemaVersion !== BASELINE_SCHEMA_VERSION) {
    throw new Error(`${paths.metadata}: unsupported schema version ${metadata.schemaVersion}`);
  }
  if (metadata.locale !== locale || metadata.baseLocale !== baseLocale) {
    throw new Error(`${paths.metadata}: locale or base locale does not match ${locale}/${baseLocale}`);
  }
  if (metadata.status !== 'verified') {
    throw new Error(`${paths.metadata}: baseline is ${metadata.status ?? 'unverified'}; full synchronization is required`);
  }
  if (
    metadata.files?.main?.path !== localeFileName(baseLocale, 'main') ||
    metadata.files?.dynamic?.path !== localeFileName(baseLocale, 'dynamic')
  ) {
    throw new Error(`${paths.metadata}: baseline file paths do not match ${baseLocale}`);
  }

  const mainData = readLocaleObject(paths.main, `${locale}:baseline:main`);
  const dynamicData = readLocaleObject(paths.dynamic, `${locale}:baseline:dynamic`);
  assertMetadataSnapshot(metadata, 'main', mainData, paths.metadata);
  assertMetadataSnapshot(metadata, 'dynamic', dynamicData, paths.metadata);

  return {
    paths,
    metadata,
    mainData,
    dynamicData,
    hashes: {
      main: hashJson(mainData),
      dynamic: hashJson(dynamicData),
    },
  };
}

export function baselineTransactionEntries({ baselineDir, baseLocale, mainData, dynamicData, metadata }) {
  const paths = baselinePaths(baselineDir, baseLocale);
  return [
    { filePath: paths.main, content: serializeJson(mainData) },
    { filePath: paths.dynamic, content: serializeJson(dynamicData) },
    { filePath: paths.metadata, content: serializeJson(metadata) },
  ];
}

export function compareKeyOrder(sourceData, targetData) {
  const sourceKeys = Object.keys(sourceData);
  const targetKeys = Object.keys(targetData);
  const sourceSet = new Set(sourceKeys);
  const targetSet = new Set(targetKeys);

  return {
    sourceKeys: sourceKeys.length,
    targetKeys: targetKeys.length,
    missing: sourceKeys.filter((key) => !targetSet.has(key)),
    extra: targetKeys.filter((key) => !sourceSet.has(key)),
    orderMatches: JSON.stringify(sourceKeys) === JSON.stringify(targetKeys),
  };
}
