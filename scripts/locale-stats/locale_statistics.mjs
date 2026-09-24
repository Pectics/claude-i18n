import path from 'node:path';
import { readJson } from './shared.mjs';

const LOCALE_PATTERN = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

export class InvalidTargetError extends Error {}

export function readFlatObject(filePath) {
  const data = readJson(filePath);
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(`${filePath}: expected a flat JSON object`);
  }
  return data;
}

export function readLocales(rootDir) {
  const filePath = path.join(rootDir, 'locales.json');
  const data = readJson(filePath);
  if (!data || typeof data !== 'object' || !Array.isArray(data.locales) || data.locales.length === 0) {
    throw new Error(`${filePath}: expected a non-empty locales array`);
  }
  const seen = new Set();
  for (const locale of data.locales) {
    if (typeof locale !== 'string' || !LOCALE_PATTERN.test(locale) || seen.has(locale)) {
      throw new Error(`${filePath}: invalid or duplicate locale ${JSON.stringify(locale)}`);
    }
    seen.add(locale);
  }
  return data.locales;
}

export function readSource(upstreamDir, baseLocale = 'en-US') {
  const main = readFlatObject(path.join(upstreamDir, `${baseLocale}.json`));
  const dynamic = readFlatObject(path.join(upstreamDir, `${baseLocale}.dynamic.json`));
  const total = Object.keys(main).length + Object.keys(dynamic).length;
  if (total === 0) throw new Error(`${upstreamDir}: upstream locale ${baseLocale} has no keys`);
  return { main, dynamic, total };
}

export function coveredKeyCount(source, target) {
  const targetKeys = new Set(Object.keys(target));
  return Object.keys(source).filter((key) => targetKeys.has(key)).length;
}

export function readTarget(rootDir, locale) {
  const localeDir = path.join(rootDir, locale);
  try {
    return {
      main: readFlatObject(path.join(localeDir, `${locale}.json`)),
      dynamic: readFlatObject(path.join(localeDir, `${locale}.dynamic.json`)),
    };
  } catch (error) {
    throw new InvalidTargetError(`${locale}: ${error.message}`, { cause: error });
  }
}

export function countTarget(source, target) {
  const main = coveredKeyCount(source.main, target.main);
  const dynamic = coveredKeyCount(source.dynamic, target.dynamic);
  return { main, dynamic, total: main + dynamic };
}
