// ==UserScript==
// @name         Claude i18n Safari Userscripts Experimental
// @namespace    https://github.com/Pectics/claude-i18n
// @version      0.1.0
// @description  Experimental macOS Safari Userscripts bridge for Claude i18n.
// @match        https://claude.ai/*
// @run-at       document-start
// @inject-into  page
// @weight       999
// ==/UserScript==

(function installClaudeI18nSafariUserscript() {
  "use strict";

  const PAGE_SOURCE = "claude-i18n-page";
  const EXTENSION_SOURCE = "claude-i18n-extension";
  const EXTENSION_REQUEST_TYPE = "extension-request";
  const EXTENSION_RESPONSE_TYPE = "extension-response";
  const REMOTE_I18N_BASE_URL = "https://claude-i18n.vercel.app";
  const STORAGE_PREFIX = "claude-i18n:safari-userscript:";
  const VERSION_CACHE_KEY_PREFIX = `${STORAGE_PREFIX}version:`;
  const RESOURCE_STORAGE_KEY_PREFIX = `${STORAGE_PREFIX}resource:`;
  const RESOURCE_INDEX_KEY_PREFIX = `${STORAGE_PREFIX}resource-index:`;
  const RESOURCE_CACHE_NAME = "claude-i18n-safari-userscript-v1";
  const RESOURCE_CACHE_URL_PREFIX = "https://claude.ai/__claude_i18n_safari_cache__";
  const VERSION_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
  const REMOTE_REQUEST_TIMEOUT_MS = 15 * 1000;
  const RESOURCE_HASH_INDEX = {
    base: 0,
    dynamic: 1,
  };
  const MESSAGE_HANDLERS = {
    "fetch-locales-manifest": fetchLocalesManifest,
    "get-i18n-resource": getI18nResource,
  };
  const nativeFetch = window.fetch.bind(window);
  const logger = createLogger("safari-userscript");

  installBridge();
  installPageHook();

  function installBridge() {
    window.addEventListener("message", async (event) => {
      if (!isPageMessage(event)) {
        return;
      }

      const request = parseExtensionRequest(event.data);
      if (!request) {
        return;
      }

      try {
        const payload = await handleMessage({
          type: request.action,
          payload: request.payload,
        });
        postExtensionResponse(request.requestId, payload);
      } catch (error) {
        logger.error("bridge.request.failed", {
          action: request.action,
          message: stringifyError(error),
        });
        postExtensionResponse(request.requestId, {
          ok: false,
          error: stringifyError(error),
        });
      }
    });
  }

  function installPageHook() {
    try {
      installClaudeI18nHook();
      logger.info("hook.injected", {
        mode: "page-direct",
      });
    } catch (error) {
      logger.error("hook.inject.failed", {
        message: stringifyError(error),
      });
    }
  }

  function isPageMessage(event) {
    return event.source === window;
  }

  function parseExtensionRequest(data) {
    const message = parseExtensionMessage(data);
    if (!message || message.source !== PAGE_SOURCE || message.type !== EXTENSION_REQUEST_TYPE) {
      return null;
    }

    return {
      requestId: message.requestId,
      action: message.action,
      payload: message.payload,
    };
  }

  function parseExtensionMessage(data) {
    if (typeof data === "string") {
      try {
        return JSON.parse(data);
      } catch {
        return null;
      }
    }

    return data;
  }

  function postExtensionResponse(requestId, payload) {
    window.postMessage(
      JSON.stringify({
        source: EXTENSION_SOURCE,
        type: EXTENSION_RESPONSE_TYPE,
        requestId,
        payloadJson: serializeExtensionPayload(payload),
      }),
      window.location.origin,
    );
  }

  function serializeExtensionPayload(payload) {
    try {
      return JSON.stringify(payload);
    } catch (error) {
      logger.error("bridge.response.serialize.failed", {
        message: stringifyError(error),
      });
      return JSON.stringify({
        ok: false,
        error: `Failed to serialize response: ${stringifyError(error)}`,
      });
    }
  }

  async function handleMessage(message) {
    if (!message || typeof message !== "object") {
      logger.warn("message.invalid");
      return {
        ok: false,
        error: "Invalid message payload",
      };
    }

    const handler = MESSAGE_HANDLERS[message.type];
    if (!handler) {
      logger.warn("message.unknown", {
        type: String(message.type),
      });
      return {
        ok: false,
        error: `Unknown message type: ${String(message.type)}`,
      };
    }

    return handler(message.payload);
  }

  async function fetchLocalesManifest() {
    const { response, data } = await fetchJsonNoStore(`${REMOTE_I18N_BASE_URL}/locales.json`);

    if (!response.ok) {
      throw new Error(`Failed to fetch locales manifest: ${response.status}`);
    }

    if (!data || !Array.isArray(data.locales)) {
      throw new Error("Remote locales manifest is invalid");
    }

    logger.info("locales.manifest.fetched", {
      version: typeof data.version === "string" ? data.version : "unknown",
      localeCount: data.locales.filter(isString).length,
    });

    return {
      ok: true,
      version: typeof data.version === "string" ? data.version : "",
      locales: data.locales.filter(isString),
    };
  }

  async function getI18nResource(payload) {
    const request = normalizeI18nResourceRequest(payload);
    if (!request) {
      return {
        ok: false,
        error: "Invalid i18n resource request",
      };
    }

    const { locale, kind } = request;
    const versionInfo = await getVersionInfo(locale);
    const resourceHash = versionInfo.hash?.[RESOURCE_HASH_INDEX[kind]];
    if (typeof resourceHash !== "string" || resourceHash.length === 0) {
      return {
        ok: false,
        error: `Missing ${kind} hash for locale ${locale}`,
      };
    }

    const cacheKey = buildResourceCacheKey(locale, kind, resourceHash);
    const storageKey = buildResourceStorageKey(locale, kind, resourceHash);
    const cached = await readResourceCache(cacheKey, storageKey);
    if (cached) {
      logger.info("i18n.resource.cache-hit", {
        locale,
        kind,
      });
      return {
        ...cached,
        meta: {
          source: "cache",
        },
      };
    }

    const remoteUrl = buildRemoteI18nUrl(locale, kind);
    const { response: remoteResponse, body } = await fetchTextNoStore(remoteUrl);
    if (!remoteResponse.ok) {
      return {
        ok: false,
        error: `Failed to fetch ${remoteUrl}: ${remoteResponse.status}`,
        status: remoteResponse.status,
      };
    }

    const payloadToReturn = {
      ok: true,
      status: remoteResponse.status,
      statusText: remoteResponse.statusText,
      headers: withJsonContentType(remoteResponse.headers),
      body,
      meta: {
        source: "remote",
      },
    };

    void writeResourceCache(locale, kind, resourceHash, payloadToReturn);
    logger.info("i18n.resource.remote-fetched", {
      locale,
      kind,
      status: remoteResponse.status,
    });

    return payloadToReturn;
  }

  async function getVersionInfo(locale) {
    const storageKey = buildVersionStorageKey(locale);
    const cached = await getStoredValue(storageKey, null);
    const now = Date.now();

    if (isFreshVersionCache(cached, now)) {
      return cached;
    }

    try {
      const { response, data } = await fetchJsonNoStore(
        `${REMOTE_I18N_BASE_URL}/version/${encodeURIComponent(locale)}.json`,
      );
      if (!response.ok) {
        throw new Error(`Failed to fetch version for ${locale}: ${response.status}`);
      }

      const next = normalizeVersionInfo(locale, data, now);
      try {
        await setStoredValue(storageKey, next);
      } catch (error) {
        logger.warn("version.cache-write.failed", {
          locale,
          message: stringifyError(error),
        });
      }
      logger.info("version.updated", {
        locale,
        builtAt: next.builtAt || "unknown",
      });

      return next;
    } catch (error) {
      if (cached && Array.isArray(cached.hash)) {
        logger.warn("version.fetch.failed-using-cache", {
          locale,
          message: stringifyError(error),
        });
        return cached;
      }

      throw error;
    }
  }

  async function readResourceCache(cacheKey, storageKey) {
    const cacheStoragePayload = await readCacheStorageResource(cacheKey);
    if (cacheStoragePayload) {
      return cacheStoragePayload;
    }

    const cached = await getStoredValue(storageKey, null);
    if (!cached || typeof cached.body !== "string") {
      return null;
    }

    return {
      ok: true,
      status: typeof cached.status === "number" ? cached.status : 200,
      statusText: typeof cached.statusText === "string" ? cached.statusText : "OK",
      headers: withJsonContentType(cached.headers),
      body: cached.body,
    };
  }

  async function writeResourceCache(locale, kind, hash, payload) {
    const cacheKey = buildResourceCacheKey(locale, kind, hash);
    const storageKey = buildResourceStorageKey(locale, kind, hash);
    const indexKey = buildResourceIndexKey(locale, kind);
    const previous = await getStoredValue(indexKey, null);
    let cacheStorageWritten = false;

    try {
      cacheStorageWritten = await writeCacheStorageResource(cacheKey, payload);
    } catch (error) {
      logger.warn("i18n.resource.cache-storage-write.failed", {
        locale,
        kind,
        message: stringifyError(error),
      });
    }

    if (cacheStorageWritten) {
      await deleteStoredValue(storageKey);
    } else {
      try {
        await setStoredValue(storageKey, {
          status: payload.status,
          statusText: payload.statusText,
          headers: payload.headers,
          body: payload.body,
          checkedAt: Date.now(),
        });
      } catch (error) {
        logger.warn("i18n.resource.local-storage-write.failed", {
          locale,
          kind,
          message: stringifyError(error),
        });
      }
    }

    await deletePreviousResourceCache(previous, cacheKey, storageKey);

    try {
      await setStoredValue(indexKey, {
        hash,
        cacheKey,
        storageKey,
        checkedAt: Date.now(),
      });
    } catch (error) {
      logger.warn("i18n.resource.index-write.failed", {
        locale,
        kind,
        message: stringifyError(error),
      });
    }
  }

  async function readCacheStorageResource(cacheKey) {
    if (!canUseCacheStorage()) {
      return null;
    }

    try {
      const cache = await window.caches.open(RESOURCE_CACHE_NAME);
      const response = await cache.match(cacheKey);
      if (!response) {
        return null;
      }

      return {
        ok: true,
        status: response.status,
        statusText: response.statusText,
        headers: withJsonContentType(headersToObject(response.headers)),
        body: await response.text(),
      };
    } catch (error) {
      logger.warn("i18n.resource.cache-storage-read.failed", {
        message: stringifyError(error),
      });
      return null;
    }
  }

  async function writeCacheStorageResource(cacheKey, payload) {
    if (!canUseCacheStorage()) {
      return false;
    }

    const cache = await window.caches.open(RESOURCE_CACHE_NAME);
    await cache.put(
      cacheKey,
      new Response(payload.body, {
        status: payload.status,
        statusText: payload.statusText,
        headers: withJsonContentType(payload.headers),
      }),
    );
    return true;
  }

  async function deletePreviousResourceCache(previous, currentCacheKey, currentStorageKey) {
    if (!previous || typeof previous !== "object") {
      return;
    }

    if (previous.cacheKey && previous.cacheKey !== currentCacheKey) {
      await deleteCacheStorageResource(previous.cacheKey);
    }

    if (previous.storageKey && previous.storageKey !== currentStorageKey) {
      await deleteStoredValue(previous.storageKey);
    }

    if (previous.key && previous.key !== currentCacheKey && previous.key !== currentStorageKey) {
      await deleteStoredValue(previous.key);
    }
  }

  async function deleteCacheStorageResource(cacheKey) {
    if (!canUseCacheStorage()) {
      return;
    }

    try {
      const cache = await window.caches.open(RESOURCE_CACHE_NAME);
      await cache.delete(cacheKey);
    } catch (error) {
      logger.warn("i18n.resource.cache-storage-delete.failed", {
        message: stringifyError(error),
      });
    }
  }

  function canUseCacheStorage() {
    return typeof window.caches === "object" && window.caches && typeof window.caches.open === "function";
  }

  function isFreshVersionCache(value, now) {
    return (
      value &&
      Array.isArray(value.hash) &&
      typeof value.checkedAt === "number" &&
      now - value.checkedAt < VERSION_REFRESH_INTERVAL_MS
    );
  }

  function buildRemoteI18nUrl(locale, kind) {
    if (kind === "dynamic") {
      return `${REMOTE_I18N_BASE_URL}/i18n/dynamic/${encodeURIComponent(locale)}.json`;
    }

    return `${REMOTE_I18N_BASE_URL}/i18n/${encodeURIComponent(locale)}.json`;
  }

  function buildVersionStorageKey(locale) {
    return `${VERSION_CACHE_KEY_PREFIX}${locale}`;
  }

  function buildResourceCacheKey(locale, kind, hash) {
    return `${RESOURCE_CACHE_URL_PREFIX}/${encodeURIComponent(locale)}/${kind}/${encodeURIComponent(hash)}.json`;
  }

  function buildResourceStorageKey(locale, kind, hash) {
    return `${RESOURCE_STORAGE_KEY_PREFIX}${locale}:${kind}:${hash}`;
  }

  function buildResourceIndexKey(locale, kind) {
    return `${RESOURCE_INDEX_KEY_PREFIX}${locale}:${kind}`;
  }

  function normalizeVersionInfo(locale, data, checkedAt) {
    return {
      locale,
      hash: Array.isArray(data?.hash) ? data.hash : [],
      builtAt: typeof data?.builtAt === "string" ? data.builtAt : "",
      checkedAt,
    };
  }

  function normalizeI18nResourceRequest(payload) {
    const locale = payload?.locale;
    const kind = payload?.kind;

    if (typeof locale !== "string" || (kind !== "base" && kind !== "dynamic")) {
      return null;
    }

    return {
      locale,
      kind,
    };
  }

  async function fetchJsonNoStore(url) {
    const { response, body } = await fetchTextNoStore(url);
    return {
      response,
      data: JSON.parse(body),
    };
  }

  async function fetchTextNoStore(url) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      controller.abort();
    }, REMOTE_REQUEST_TIMEOUT_MS);

    try {
      const response = await nativeFetch(url, {
        cache: "no-store",
        signal: controller.signal,
      });

      return {
        response: {
          ok: response.ok,
          status: response.status,
          statusText: response.statusText || "",
          headers: headersToObject(response.headers),
        },
        body: await response.text(),
      };
    } catch (error) {
      if (error && error.name === "AbortError") {
        throw new Error(`Request timed out: ${url}`);
      }

      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function headersToObject(headers) {
    const output = {};
    if (!headers) {
      return output;
    }

    if (typeof headers.forEach === "function") {
      headers.forEach((value, key) => {
        output[String(key).toLowerCase()] = value;
      });
      return output;
    }

    for (const line of String(headers).split(/\r?\n/)) {
      const separator = line.indexOf(":");
      if (separator <= 0) {
        continue;
      }

      const key = line.slice(0, separator).trim().toLowerCase();
      const value = line.slice(separator + 1).trim();
      if (key) {
        output[key] = value;
      }
    }

    return output;
  }

  function withJsonContentType(headers) {
    const output = headers && typeof headers === "object" ? { ...headers } : {};
    if (!output["content-type"]) {
      output["content-type"] = "application/json; charset=utf-8";
    }

    return output;
  }

  async function getStoredValue(key, fallback) {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw === null) {
        return fallback;
      }

      return decodeStoredValue(raw, fallback);
    } catch (error) {
      logger.warn("storage.get.failed", {
        key,
        message: stringifyError(error),
      });
      return fallback;
    }
  }

  async function setStoredValue(key, value) {
    try {
      window.localStorage.setItem(key, encodeStoredValue(value));
    } catch (error) {
      logger.warn("storage.set.failed", {
        key,
        message: stringifyError(error),
      });
      throw error;
    }
  }

  async function deleteStoredValue(key) {
    try {
      window.localStorage.removeItem(key);
    } catch (error) {
      logger.warn("storage.delete.failed", {
        key,
        message: stringifyError(error),
      });
    }
  }

  function encodeStoredValue(value) {
    return JSON.stringify(value);
  }

  function decodeStoredValue(raw, fallback) {
    if (typeof raw !== "string") {
      return raw;
    }

    try {
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  function createLogger(component) {
    return {
      info(event, detail) {
        log("info", event, detail);
      },
      warn(event, detail) {
        log("warn", event, detail);
      },
      error(event, detail) {
        log("error", event, detail);
      },
    };

    function log(level, event, detail) {
      const message = `[claude-i18n][${component}] ${event}`;
      const safeDetail = compactDetail(detail);
      if (safeDetail) {
        console[level](message, safeDetail);
        return;
      }

      console[level](message);
    }
  }

  function compactDetail(detail) {
    if (!detail || typeof detail !== "object") {
      return null;
    }

    const output = {};
    for (const [key, value] of Object.entries(detail)) {
      if (value !== undefined && value !== null && value !== "") {
        output[key] = value;
      }
    }

    return Object.keys(output).length > 0 ? output : null;
  }

  function isString(value) {
    return typeof value === "string";
  }

  function stringifyError(error) {
    return error instanceof Error ? error.message : String(error);
  }

  function installClaudeI18nHook() {
    if (window.__CLAUDE_ARRAY_PROXY_INSTALLED__) {
      return;
    }
    window.__CLAUDE_ARRAY_PROXY_INSTALLED__ = true;

    const TARGET_FIRST = "en-US";
    const TARGET_LAST = "id-ID";
    const DEFAULT_EXTENSION_LOCALES = ["zh-CN"];
    const EXTENSION_LOCALES_KEY = "__CLAUDE_EXTENSION_LOCALES__";
    const EXTENSION_LOCALES_STORAGE_KEY = "__CLAUDE_EXTENSION_LOCALES_CACHE__";
    const PROFILE_LOCALE_STORAGE_KEY = "__CLAUDE_EXTENSION_PROFILE_LOCALE__";
    const REPORT_KEY = "__CLAUDE_ARRAY_PROXY_REPORT__";
    const PAGE_SOURCE = "claude-i18n-page";
    const EXTENSION_SOURCE = "claude-i18n-extension";
    const EXTENSION_REQUEST_TYPE = "extension-request";
    const EXTENSION_RESPONSE_TYPE = "extension-response";
    const ACCOUNT_PROFILE_FALLBACK_LOCALE = "en-US";
    const LOCALES_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
    const EXTENSION_REQUEST_TIMEOUT_MS = 15 * 1000;

    const PATH_PATTERNS = {
      baseI18nResource: /^\/i18n\/([^/]+)\.json$/,
      dynamicI18nResource: /^\/i18n\/dynamic\/([^/]+)\.json$/,
      overridesI18n: /^\/i18n\/[^/]+\.overrides\.json$/,
    };
    const ORIGINAL = {
      isArray: Array.isArray,
      indexOf: Array.prototype.indexOf,
      push: Array.prototype.push,
      splice: Array.prototype.splice,
      fetch: window.fetch.bind(window),
      setTimeout: window.setTimeout.bind(window),
      clearTimeout: window.clearTimeout.bind(window),
    };
    const NON_PATCHABLE_KEYS = new Set(["length", "name", "prototype"]);
    const MUTATING_PROTOTYPE_METHODS = new Set([
      "copyWithin",
      "fill",
      "pop",
      "push",
      "reverse",
      "shift",
      "sort",
      "splice",
      "unshift",
    ]);
    const SKIPPED_STATIC_METHODS = new Set(["isArray"]);

    const runtime = createRuntimeState();
    const logger = createLogger("hook", recordLogEntry);

    install();

    function install() {
      installFetchInterceptor();
      installArrayPatches();
      scheduleLocalesRefresh();
      logger.info("hook.installed", {
        localeCount: runtime.extensionLocales.length,
        manifestVersion: runtime.report.localesManifestVersion || "none",
      });
    }

    function createRuntimeState() {
      const cachedLocales = readLocalesCache();
      const extensionLocales = initializeExtensionLocales(cachedLocales);
      const report = createReport(extensionLocales, cachedLocales);
      window[REPORT_KEY] = report;

      return {
        extensionLocales,
        report,
        requestCounter: 0,
      };
    }

    function createReport(extensionLocales, cachedLocales) {
      return {
        installedAt: Date.now(),
        extensionLocales: extensionLocales.slice(),
        localesManifestVersion: typeof cachedLocales?.version === "string" ? cachedLocales.version : "",
        prototypeMethodsPatched: [],
        staticMethodsPatched: [],
        prototypeMethodsSkipped: [],
        staticMethodsSkipped: [],
        localesManifestRefreshHits: 0,
        localesManifestRefreshErrors: 0,
        requestLocaleRewriteHits: 0,
        queryLocaleRewriteHits: 0,
        bodyLocaleRewriteHits: 0,
        responseLocaleRewriteHits: 0,
        i18nOverridesHits: 0,
        i18nRedirectHits: 0,
        i18nCacheHits: 0,
        mutationCount: 0,
        lastMutation: null,
        logs: [],
        errors: [],
      };
    }

    function installArrayPatches() {
      patchFunctionGroup(Array.prototype, {
        kind: "prototype",
        shouldSkipKey(key) {
          return MUTATING_PROTOTYPE_METHODS.has(key);
        },
        invoke(original, key, receiver, args) {
          ensureTargetLocale(receiver, key);
          return Reflect.apply(original, receiver, args);
        },
      });

      patchFunctionGroup(Array, {
        kind: "static",
        shouldSkipKey(key) {
          return SKIPPED_STATIC_METHODS.has(key);
        },
        invoke(original, key, receiver, args) {
          if (args.length > 0) {
            ensureTargetLocale(args[0], key);
          }

          return Reflect.apply(original, receiver, args);
        },
      });
    }

    function patchFunctionGroup(target, config) {
      const patchedReportKey =
        config.kind === "prototype" ? "prototypeMethodsPatched" : "staticMethodsPatched";
      const skippedReportKey =
        config.kind === "prototype" ? "prototypeMethodsSkipped" : "staticMethodsSkipped";

      for (const key of Reflect.ownKeys(target)) {
        if (NON_PATCHABLE_KEYS.has(key)) {
          continue;
        }

        const descriptor = Object.getOwnPropertyDescriptor(target, key);
        if (!descriptor || typeof descriptor.value !== "function") {
          continue;
        }

        if (config.shouldSkipKey(key)) {
          runtime.report[skippedReportKey].push(formatKey(key));
          continue;
        }

        const original = descriptor.value;
        if (original.__claudeArrayProxyWrapped__) {
          continue;
        }

        const wrapped = function (...args) {
          return config.invoke(original, key, this, args);
        };

        Object.defineProperty(wrapped, "__claudeArrayProxyWrapped__", {
          value: true,
        });
        Object.defineProperty(target, key, {
          ...descriptor,
          value: wrapped,
        });
        runtime.report[patchedReportKey].push(formatKey(key));
      }
    }

    function ensureTargetLocale(value, key) {
      if (!ORIGINAL.isArray(value) || !shouldInjectLocale(value)) {
        return;
      }

      try {
        let changed = false;
        for (const locale of runtime.extensionLocales) {
          if (!isString(locale) || hasArrayValue(value, locale)) {
            continue;
          }

          ORIGINAL.push.call(value, locale);
          changed = true;
        }

        if (!changed) {
          return;
        }

        runtime.report.mutationCount += 1;
        runtime.report.lastMutation = {
          method: formatKey(key),
          length: value.length,
          locales: runtime.extensionLocales.slice(),
          at: Date.now(),
        };
      } catch (error) {
        pushError(`Failed to inject via ${formatKey(key)}: ${stringifyError(error)}`);
      }
    }

    function shouldInjectLocale(value) {
      return (
        value.length > 0 &&
        typeof value[0] === "string" &&
        value[0] === TARGET_FIRST &&
        typeof value[value.length - 1] === "string" &&
        value[value.length - 1] === TARGET_LAST
      );
    }

    function initializeExtensionLocales(cachedLocales) {
      const existing = window[EXTENSION_LOCALES_KEY];
      if (ORIGINAL.isArray(existing) && existing.length > 0) {
        return existing;
      }

      const locales =
        cachedLocales && ORIGINAL.isArray(cachedLocales.locales) && cachedLocales.locales.length > 0
          ? cachedLocales.locales.filter(isString)
          : DEFAULT_EXTENSION_LOCALES.slice();
      window[EXTENSION_LOCALES_KEY] = locales;
      return locales;
    }

    function scheduleLocalesRefresh() {
      const cached = readLocalesCache();
      if (
        cached &&
        typeof cached.checkedAt === "number" &&
        Date.now() - cached.checkedAt < LOCALES_REFRESH_INTERVAL_MS
      ) {
        return;
      }

      ORIGINAL.setTimeout(() => {
        refreshExtensionLocales().catch((error) => {
          runtime.report.localesManifestRefreshErrors += 1;
          pushError(`Failed to refresh locales manifest: ${stringifyError(error)}`);
        });
      }, 50);
    }

    async function refreshExtensionLocales() {
      const cached = readLocalesCache();
      const payload = await requestExtension("fetch-locales-manifest", {});
      if (!payload.ok || !ORIGINAL.isArray(payload.locales)) {
        throw new Error(payload.error || "Invalid locales manifest response");
      }

      const nextLocales = payload.locales.filter(isString);
      const nextVersion = typeof payload.version === "string" ? payload.version : "";
      if (nextLocales.length === 0) {
        throw new Error("Remote locales manifest is empty");
      }

      if (!cached || cached.version !== nextVersion || !sameStringArray(cached.locales, nextLocales)) {
        replaceArrayContents(runtime.extensionLocales, nextLocales);
        window[EXTENSION_LOCALES_KEY] = runtime.extensionLocales;
        writeLocalesCache({
          version: nextVersion,
          locales: nextLocales,
          checkedAt: Date.now(),
        });
        runtime.report.extensionLocales = runtime.extensionLocales.slice();
        runtime.report.localesManifestVersion = nextVersion;
        runtime.report.localesManifestRefreshHits += 1;
        logger.info("locales.refresh.updated", {
          version: nextVersion || "unknown",
          localeCount: nextLocales.length,
        });
        return;
      }

      writeLocalesCache({
        ...cached,
        checkedAt: Date.now(),
      });
    }

    function replaceArrayContents(target, nextValues) {
      ORIGINAL.splice.call(target, 0, target.length);
      for (const value of nextValues) {
        ORIGINAL.push.call(target, value);
      }
    }

    function installFetchInterceptor() {
      window.fetch = function interceptedFetch(...args) {
        return runFetchRules(this, args);
      };
    }

    async function runFetchRules(fetchThis, args) {
      const context = createFetchContext(args);
      const afterFetchRules = [];

      try {
        if (context.isGetRequest() && matchesSameOriginUrl(context.url, { pathnamePattern: PATH_PATTERNS.overridesI18n })) {
          runtime.report.i18nOverridesHits += 1;
          logger.info("i18n.overrides.served");
          return createJsonResponse("{}", 200);
        }

        const resource = context.isGetRequest() ? parseI18nResource(context.url) : null;
        if (resource && isExtensionLocale(resource.locale)) {
          runtime.report.i18nRedirectHits += 1;
          const payload = await requestExtension("get-i18n-resource", resource);
          if (!payload.ok) {
            throw new Error(payload.error || `Failed to resolve ${resource.kind} for ${resource.locale}`);
          }

          runtime.report.i18nCacheHits += 1;
          logger.info("i18n.resource.served", {
            locale: resource.locale,
            kind: resource.kind,
            source: payload.meta?.source || "unknown",
            status: payload.status,
          });
          return createResponseFromPayload(payload);
        }

        if (isSameOriginApplicationRequest(context.url)) {
          const requestState = await prepareLocaleAwareRequest(context.input, context.init);
          if (requestState.changed) {
            context.replaceRequest(requestState.request);
          }

          if (requestState.cachedLocale) {
            writeStoredProfileLocale(requestState.cachedLocale);
          } else if (requestState.sawLocaleParameter) {
            clearStoredProfileLocale();
          }

          if (requestState.queryChanged) {
            runtime.report.queryLocaleRewriteHits += 1;
          }
          if (requestState.bodyChanged) {
            runtime.report.bodyLocaleRewriteHits += 1;
          }
          if (requestState.changed) {
            runtime.report.requestLocaleRewriteHits += 1;
            logger.info("locale.request.rewritten", {
              method: requestState.method,
              queryChanged: requestState.queryChanged,
              bodyChanged: requestState.bodyChanged,
              locale: requestState.cachedLocale || "cleared",
            });
          }

          afterFetchRules.push(rewriteLocaleAwareJsonResponse);
        }

        let response = await context.fetch(fetchThis);
        for (const afterFetch of afterFetchRules) {
          response = await afterFetch(response);
        }
        return response;
      } catch (error) {
        logger.error("fetch.rule.failed", {
          request: describeRequest(context.url),
          method: context.method,
          message: stringifyError(error),
        });
        throw error;
      }
    }

    function createFetchContext(args) {
      let [input, init] = args;
      let requestState = {
        url: toUrl(input),
        method: getRequestMethod(input, init),
      };

      return {
        get input() {
          return input;
        },
        get init() {
          return init;
        },
        get url() {
          return requestState.url;
        },
        get method() {
          return requestState.method;
        },
        isGetRequest() {
          return requestState.method === "GET";
        },
        replaceRequest(nextRequest) {
          input = nextRequest.input;
          init = nextRequest.init;
          requestState = {
            url: toUrl(input),
            method: getRequestMethod(input, init),
          };
        },
        fetch(fetchThis) {
          const fetchArgs = init === undefined ? [input] : [input, init];
          return Reflect.apply(ORIGINAL.fetch, fetchThis, fetchArgs);
        },
      };
    }

    async function prepareLocaleAwareRequest(input, init) {
      const request = {
        input,
        init,
      };
      const method = getRequestMethod(input, init);
      let nextRequest = request;
      let cachedLocale = null;
      let sawLocaleParameter = false;
      let queryChanged = false;
      let bodyChanged = false;

      const queryRewrite = rewriteLocaleInUrl(toUrl(input));
      if (queryRewrite.sawLocaleParameter) {
        sawLocaleParameter = true;
      }
      if (queryRewrite.cachedLocale) {
        cachedLocale = queryRewrite.cachedLocale;
      }
      if (queryRewrite.changed) {
        nextRequest = replaceUrl(nextRequest.input, nextRequest.init, queryRewrite.url);
        queryChanged = true;
      }

      const bodyRewrite = await rewriteLocaleInRequestBody(nextRequest.input, nextRequest.init);
      if (bodyRewrite.sawLocaleParameter) {
        sawLocaleParameter = true;
      }
      if (bodyRewrite.cachedLocale) {
        cachedLocale = bodyRewrite.cachedLocale;
      }
      if (bodyRewrite.changed) {
        nextRequest = replaceRequestBody(
          nextRequest.input,
          nextRequest.init,
          bodyRewrite.body,
          bodyRewrite.replaceOptions,
        );
        bodyChanged = true;
      }

      return {
        request: nextRequest,
        method,
        cachedLocale,
        changed: queryChanged || bodyChanged,
        queryChanged,
        bodyChanged,
        sawLocaleParameter,
      };
    }

    async function rewriteLocaleAwareJsonResponse(response) {
      const profileLocale = readStoredProfileLocale();
      if (!isExtensionLocale(profileLocale)) {
        return response;
      }

      const body = await readJsonObjectResponse(response);
      if (!body) {
        return response;
      }

      let changed = false;
      if (hasOwn(body, "locale") && isString(body.locale)) {
        body.locale = profileLocale;
        changed = true;
      }

      if (
        body.gated_messages &&
        typeof body.gated_messages === "object" &&
        !ORIGINAL.isArray(body.gated_messages) &&
        hasOwn(body.gated_messages, "locale") &&
        isString(body.gated_messages.locale)
      ) {
        body.gated_messages.locale = profileLocale;
        changed = true;
      }

      if (!changed) {
        return response;
      }

      runtime.report.responseLocaleRewriteHits += 1;
      logger.info("locale.response.rewritten", {
        locale: profileLocale,
      });
      return replaceJsonResponse(response, body);
    }

    function requestExtension(action, payload) {
      return new Promise((resolve, reject) => {
        const requestId = `claude-i18n-${Date.now()}-${runtime.requestCounter++}`;
        const timeout = ORIGINAL.setTimeout(() => {
          window.removeEventListener("message", handleMessage);
          reject(new Error(`Timed out waiting for extension action ${action}`));
        }, EXTENSION_REQUEST_TIMEOUT_MS);

        function handleMessage(event) {
          if (event.source !== window) {
            return;
          }

          const data = parseExtensionMessage(event.data);
          if (
            !data ||
            data.source !== EXTENSION_SOURCE ||
            data.type !== EXTENSION_RESPONSE_TYPE ||
            data.requestId !== requestId
          ) {
            return;
          }

          ORIGINAL.clearTimeout(timeout);
          window.removeEventListener("message", handleMessage);

          try {
            resolve(parseExtensionResponsePayload(data));
          } catch (error) {
            reject(error);
          }
        }

        window.addEventListener("message", handleMessage);
        window.postMessage(
          JSON.stringify({
            source: PAGE_SOURCE,
            type: EXTENSION_REQUEST_TYPE,
            requestId,
            action,
            payload,
          }),
          window.location.origin,
        );
      });
    }

    function parseExtensionMessage(data) {
      if (typeof data === "string") {
        try {
          return JSON.parse(data);
        } catch {
          return null;
        }
      }

      return data;
    }

    function parseExtensionResponsePayload(data) {
      if (typeof data.payloadJson === "string") {
        try {
          return JSON.parse(data.payloadJson);
        } catch (error) {
          throw new Error(`Invalid extension response payload: ${stringifyError(error)}`);
        }
      }

      return data.payload;
    }

    function hasArrayValue(value, expected) {
      return ORIGINAL.indexOf.call(value, expected) !== -1;
    }

    function isExtensionLocale(value) {
      return isString(value) && hasArrayValue(runtime.extensionLocales, value);
    }

    function sameStringArray(left, right) {
      if (!ORIGINAL.isArray(left) || !ORIGINAL.isArray(right) || left.length !== right.length) {
        return false;
      }

      for (let index = 0; index < left.length; index += 1) {
        if (left[index] !== right[index]) {
          return false;
        }
      }

      return true;
    }

    function readStoredProfileLocale() {
      try {
        return window.localStorage.getItem(PROFILE_LOCALE_STORAGE_KEY);
      } catch {
        return null;
      }
    }

    function writeStoredProfileLocale(locale) {
      try {
        window.localStorage.setItem(PROFILE_LOCALE_STORAGE_KEY, locale);
      } catch {}
    }

    function clearStoredProfileLocale() {
      try {
        window.localStorage.removeItem(PROFILE_LOCALE_STORAGE_KEY);
      } catch {}
    }

    function readLocalesCache() {
      try {
        const raw = window.localStorage.getItem(EXTENSION_LOCALES_STORAGE_KEY);
        if (!raw) {
          return null;
        }

        const parsed = JSON.parse(raw);
        if (!parsed || !ORIGINAL.isArray(parsed.locales)) {
          return null;
        }

        return parsed;
      } catch {
        return null;
      }
    }

    function writeLocalesCache(value) {
      try {
        window.localStorage.setItem(EXTENSION_LOCALES_STORAGE_KEY, JSON.stringify(value));
      } catch {}
    }

    function matchesSameOriginUrl(url, criteria) {
      if (url.origin !== window.location.origin) {
        return false;
      }

      if (criteria.pathname && url.pathname !== criteria.pathname) {
        return false;
      }

      if (criteria.pathnamePattern && !criteria.pathnamePattern.test(url.pathname)) {
        return false;
      }

      return true;
    }

    function isSameOriginApplicationRequest(url) {
      return url.origin === window.location.origin && !isI18nTransportUrl(url);
    }

    function toUrl(input) {
      if (input instanceof URL) {
        return input;
      }

      if (input instanceof Request) {
        return new URL(input.url, window.location.href);
      }

      return new URL(String(input), window.location.href);
    }

    function getRequestMethod(input, init) {
      if (init && typeof init.method === "string") {
        return init.method.toUpperCase();
      }

      if (input instanceof Request) {
        return input.method.toUpperCase();
      }

      return "GET";
    }

    async function readRequestBodyText(input, init) {
      if (init && typeof init.body === "string") {
        return init.body;
      }

      if (input instanceof Request) {
        return input.clone().text();
      }

      return "";
    }

    function replaceRequestBody(input, init, body, options = {}) {
      if (input instanceof Request) {
        const requestInit = {
          body,
        };
        if (options.headers) {
          requestInit.headers = options.headers;
        }

        return {
          input: new Request(input, requestInit),
          init: stripRequestOverrideInit(init, {
            stripBody: true,
            stripHeaders: Boolean(options.headers),
          }),
        };
      }

      const nextInit = {
        ...(init || {}),
        body,
      };
      if (options.headers) {
        nextInit.headers = options.headers;
      }

      return {
        input,
        init: nextInit,
      };
    }

    function stripRequestOverrideInit(init, options) {
      if (!init) {
        return undefined;
      }

      const nextInit = {
        ...init,
      };

      if (options.stripBody) {
        delete nextInit.body;
      }
      if (options.stripHeaders) {
        delete nextInit.headers;
      }

      return Object.keys(nextInit).length > 0 ? nextInit : undefined;
    }

    function replaceUrl(input, init, url) {
      if (input instanceof Request) {
        return {
          input: new Request(url.href, {
            method: input.method,
            headers: input.headers,
            cache: input.cache,
            credentials: input.credentials,
            integrity: input.integrity,
            keepalive: input.keepalive,
            mode: input.mode,
            redirect: input.redirect,
            referrer: input.referrer,
            referrerPolicy: input.referrerPolicy,
            signal: input.signal,
          }),
          init,
        };
      }

      if (input instanceof URL) {
        return {
          input: new URL(url.href),
          init,
        };
      }

      return {
        input: url.href,
        init,
      };
    }

    function parseI18nResource(url) {
      if (url.origin !== window.location.origin) {
        return null;
      }

      let match = url.pathname.match(PATH_PATTERNS.baseI18nResource);
      if (match) {
        return {
          kind: "base",
          locale: match[1],
        };
      }

      match = url.pathname.match(PATH_PATTERNS.dynamicI18nResource);
      if (match) {
        return {
          kind: "dynamic",
          locale: match[1],
        };
      }

      return null;
    }

    function createJsonResponse(bodyText, status) {
      return new Response(bodyText, {
        status,
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
      });
    }

    function createResponseFromPayload(payload) {
      return new Response(payload.body, {
        status: payload.status,
        statusText: payload.statusText,
        headers: payload.headers,
      });
    }

    async function readJsonObjectResponse(response) {
      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("application/json")) {
        return null;
      }

      const text = await response.clone().text();
      if (!text) {
        return null;
      }

      return parseJsonObject(text);
    }

    function replaceJsonResponse(response, body) {
      const headers = new Headers(response.headers);
      headers.delete("content-length");

      return new Response(JSON.stringify(body), {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }

    function parseJsonObject(text) {
      try {
        const value = JSON.parse(text);
        if (!value || typeof value !== "object" || ORIGINAL.isArray(value)) {
          return null;
        }

        return value;
      } catch {
        return null;
      }
    }

    function rewriteLocaleInUrl(url) {
      const locale = url.searchParams.get("locale");
      if (!isString(locale)) {
        return {
          changed: false,
          sawLocaleParameter: false,
          cachedLocale: null,
          url,
        };
      }

      if (!isExtensionLocale(locale)) {
        return {
          changed: false,
          sawLocaleParameter: true,
          cachedLocale: null,
          url,
        };
      }

      const nextUrl = new URL(url.href);
      nextUrl.searchParams.set("locale", ACCOUNT_PROFILE_FALLBACK_LOCALE);
      return {
        changed: true,
        sawLocaleParameter: true,
        cachedLocale: locale,
        url: nextUrl,
      };
    }

    async function rewriteLocaleInRequestBody(input, init) {
      const sourceHeaders = getRequestHeaders(input, init);
      const initBodyRewrite = await rewriteLocaleInProvidedBody(
        init?.body,
        getRequestContentType(input, init),
        sourceHeaders,
      );
      if (initBodyRewrite) {
        return initBodyRewrite;
      }

      if (!(input instanceof Request)) {
        return createNoBodyRewriteResult();
      }

      const contentType = input.headers.get("content-type") || "";
      if (!isSupportedLocaleBodyContentType(contentType)) {
        return createNoBodyRewriteResult();
      }

      const text = await input.clone().text();
      if (!text) {
        return createNoBodyRewriteResult();
      }

      return rewriteLocaleInTextBody(text, contentType, sourceHeaders);
    }

    async function rewriteLocaleInProvidedBody(body, contentType, sourceHeaders) {
      if (body === undefined || body === null) {
        return null;
      }

      if (body instanceof URLSearchParams) {
        return rewriteLocaleInSearchParams(new URLSearchParams(body.toString()), {
          replaceOptions: {
            headers: ensureContentTypeHeader(
              sourceHeaders,
              contentType || "application/x-www-form-urlencoded;charset=UTF-8",
            ),
          },
        });
      }

      if (body instanceof FormData) {
        return rewriteLocaleInFormData(body, sourceHeaders);
      }

      if (typeof body === "string") {
        return rewriteLocaleInTextBody(body, contentType, sourceHeaders);
      }

      return createNoBodyRewriteResult();
    }

    function rewriteLocaleInTextBody(text, contentType, sourceHeaders) {
      if (looksLikeJsonBody(text, contentType)) {
        const parsed = parseJsonObject(text);
        if (!parsed || !hasOwn(parsed, "locale") || !isString(parsed.locale)) {
          return createNoBodyRewriteResult();
        }

        const originalLocale = parsed.locale;
        if (!isExtensionLocale(parsed.locale)) {
          return {
            changed: false,
            sawLocaleParameter: true,
            cachedLocale: null,
            body: text,
            replaceOptions: null,
          };
        }

        parsed.locale = ACCOUNT_PROFILE_FALLBACK_LOCALE;
        return {
          changed: true,
          sawLocaleParameter: true,
          cachedLocale: originalLocale,
          body: JSON.stringify(parsed),
          replaceOptions: {
            headers: ensureContentTypeHeader(sourceHeaders, contentType || "application/json"),
          },
        };
      }

      if (looksLikeFormUrlEncodedBody(text, contentType)) {
        return rewriteLocaleInSearchParams(new URLSearchParams(text), {
          serializeAsString: true,
          replaceOptions: {
            headers: ensureContentTypeHeader(
              sourceHeaders,
              contentType || "application/x-www-form-urlencoded;charset=UTF-8",
            ),
          },
        });
      }

      return createNoBodyRewriteResult();
    }

    function rewriteLocaleInSearchParams(searchParams, options = {}) {
      if (!searchParams.has("locale")) {
        return createNoBodyRewriteResult();
      }

      const locale = searchParams.get("locale");
      if (!isString(locale)) {
        return createNoBodyRewriteResult();
      }

      if (!isExtensionLocale(locale)) {
        return {
          changed: false,
          sawLocaleParameter: true,
          cachedLocale: null,
          body: options.serializeAsString ? searchParams.toString() : searchParams,
          replaceOptions: options.replaceOptions || null,
        };
      }

      searchParams.set("locale", ACCOUNT_PROFILE_FALLBACK_LOCALE);
      return {
        changed: true,
        sawLocaleParameter: true,
        cachedLocale: locale,
        body: options.serializeAsString ? searchParams.toString() : searchParams,
        replaceOptions: options.replaceOptions || null,
      };
    }

    function rewriteLocaleInFormData(formData, sourceHeaders) {
      if (!formData.has("locale")) {
        return createNoBodyRewriteResult();
      }

      const locale = formData.get("locale");
      if (!isString(locale)) {
        return createNoBodyRewriteResult();
      }

      if (!isExtensionLocale(locale)) {
        return {
          changed: false,
          sawLocaleParameter: true,
          cachedLocale: null,
          body: formData,
          replaceOptions: null,
        };
      }

      const nextFormData = new FormData();
      for (const [key, value] of formData.entries()) {
        nextFormData.append(key, value);
      }
      nextFormData.set("locale", ACCOUNT_PROFILE_FALLBACK_LOCALE);

      return {
        changed: true,
        sawLocaleParameter: true,
        cachedLocale: locale,
        body: nextFormData,
        replaceOptions: {
          headers: ensureContentTypeHeader(sourceHeaders, null),
        },
      };
    }

    function createNoBodyRewriteResult() {
      return {
        changed: false,
        sawLocaleParameter: false,
        cachedLocale: null,
        body: null,
        replaceOptions: null,
      };
    }

    function getRequestContentType(input, init) {
      const headers = getRequestHeaders(input, init);
      return headers.get("content-type") || "";
    }

    function getRequestHeaders(input, init) {
      return new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
    }

    function ensureContentTypeHeader(sourceHeaders, contentType) {
      const headers = new Headers(sourceHeaders || undefined);
      if (contentType === null) {
        headers.delete("content-type");
        return headers;
      }

      if (!headers.has("content-type")) {
        headers.set("content-type", contentType);
      }
      return headers;
    }

    function looksLikeJsonBody(text, contentType) {
      const trimmed = text.trim();
      if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
        return false;
      }

      return isJsonContentType(contentType) || contentType === "";
    }

    function looksLikeFormUrlEncodedBody(text, contentType) {
      if (isFormUrlEncodedContentType(contentType)) {
        return true;
      }

      return contentType === "" && text.includes("=") && !text.trim().startsWith("{");
    }

    function isSupportedLocaleBodyContentType(contentType) {
      return isJsonContentType(contentType) || isFormUrlEncodedContentType(contentType);
    }

    function isJsonContentType(contentType) {
      return /(^|\/|\+)(json)(;|$)/i.test(contentType);
    }

    function isFormUrlEncodedContentType(contentType) {
      return /^application\/x-www-form-urlencoded(?:;|$)/i.test(contentType);
    }

    function isI18nTransportUrl(url) {
      return parseI18nResource(url) !== null || PATH_PATTERNS.overridesI18n.test(url.pathname);
    }

    function pushError(message) {
      runtime.report.errors.push({
        at: Date.now(),
        message,
      });
      logger.error("runtime.error", {
        message,
      });

      if (runtime.report.errors.length > 20) {
        runtime.report.errors.shift();
      }
    }

    function recordLogEntry(entry) {
      runtime.report.logs.push(entry);
      if (runtime.report.logs.length > 50) {
        runtime.report.logs.shift();
      }
    }

    function formatKey(key) {
      return typeof key === "symbol" ? key.toString() : String(key);
    }

    function stringifyError(error) {
      return error instanceof Error ? error.message : String(error);
    }

    function isString(value) {
      return typeof value === "string";
    }

    function hasOwn(value, key) {
      return Object.prototype.hasOwnProperty.call(value, key);
    }

    function describeRequest(url) {
      const resource = parseI18nResource(url);
      if (resource) {
        return `i18n:${resource.kind}`;
      }

      if (matchesSameOriginUrl(url, { pathnamePattern: PATH_PATTERNS.overridesI18n })) {
        return "i18n:overrides";
      }

      if (isSameOriginApplicationRequest(url)) {
        return "same-origin-json";
      }

      return "other";
    }

    function createLogger(component, onRecord) {
      return {
        info(event, detail) {
          log("info", event, detail);
        },
        error(event, detail) {
          log("error", event, detail);
        },
      };

      function log(level, event, detail) {
        const message = `[claude-i18n][${component}] ${event}`;
        const safeDetail = compactDetail(detail);
        const entry = {
          at: new Date().toISOString(),
          level,
          component,
          event,
          ...(safeDetail || {}),
        };

        if (typeof onRecord === "function") {
          onRecord(entry);
        }

        if (safeDetail) {
          console[level](message, safeDetail);
          return;
        }

        console[level](message);
      }
    }

    function compactDetail(detail) {
      if (!detail || typeof detail !== "object") {
        return null;
      }

      const output = {};
      for (const [key, value] of Object.entries(detail)) {
        if (value !== undefined && value !== null && value !== "") {
          output[key] = value;
        }
      }

      return Object.keys(output).length > 0 ? output : null;
    }
  }
})();
