---
name: create-full-locale
description: Use when the maintainer wants to create a brand-new full target locale under the claude-i18n repo root from .original source files and an existing context locale, not when applying pending locale-update diffs.
---

# Create Full Locale

## Core Boundary

Use this skill only for full creation of a new root locale directory such as `fr-FR/fr-FR.json` and `fr-FR/fr-FR.dynamic.json`. This is not the `bot/locale-update` diff workflow; do not use `.pending/locale-update`, `scripts/locale-update/*`, upstream fetches, online translators, browser translation, web search, or generated `dist/` files as translation sources.

The local scripts for this workflow are:

- `scripts/create-full-locale/prepare_translation.mjs`
- `scripts/create-full-locale/apply_translation.mjs`
- `scripts/create-full-locale/shared.mjs`

## Mandatory Guards

Stop before preparing chunks when any guard fails:

- If the user did not specify a target locale, ask for the exact BCP-47 language-region tag and the intended audience/use case.
- If the target locale directory exists, or the target appears in `locales.json`, refuse because this workflow is only for new full locales.
- If the requested language is a joke, dead, constructed, private-use, or extremely niche language without a clear product audience, refuse or ask for a concrete application case first.
- If `.original/<base>.json`, `.original/<base>.dynamic.json`, the reference files, or `<context>/<context>.json` and `<context>/<context>.dynamic.json` are missing, stop.
- If `git status --short` shows unrelated local changes that could be mixed into the new-locale commit, stop and report them.
- Do not commit unless the user explicitly asks. Never push unless the user explicitly asks.

Default locales:

- base source: `en-US`
- reference: `ja-JP`
- context: `zh-CN`

## Prepare

Run from the repo root:

```bash
node scripts/create-full-locale/prepare_translation.mjs --locale <TARGET_LOCALE>
```

Optional flags:

```bash
--base-locale en-US
--reference-locale ja-JP
--context-locale zh-CN
--pending-dir .pending/create-full-locale
--output-field translation
--target-chars 12000
--max-entries 300
--min-entries 50
```

The prepare script refuses existing target locales, reads `.original/<base>*.json`, optional `.original/<reference>*.json`, and root `<context>/<context>*.json`, then writes:

- `.pending/create-full-locale/<TARGET_LOCALE>/manifest.json`
- chunk inputs under `.pending/create-full-locale/<TARGET_LOCALE>/chunks/...`
- expected outputs under `.pending/create-full-locale/<TARGET_LOCALE>/out/...`

Read the generated manifest. Use only `manifest.chunks.main` and `manifest.chunks.dynamic` as the assignment list. Pass the exact `outputField` from the manifest to workers.

Safety notes:

- Never rerun prepare over a work directory that may contain translated output. If `.pending/create-full-locale/<TARGET_LOCALE>` exists and is non-empty, preserve it first or stop; prepare must not delete translated `out/...` files.
- If you need a different split after workers have started, move the existing work directory to a timestamped backup path first. Do not delete the backup until the locale has been successfully applied and the final files have been validated.
- Treat any prepare-time recursive removal of a translation work directory as a bug. Removal belongs only to successful apply/explicit final cleanup.

## Translation Contract

Each input line is a JSON object with:

- required `file`, `index`, `key`, `en`
- optional `reference`, `ja`, `context`, `op`

Rules:

- Treat `en` as the only source of truth.
- Use `reference` or `ja` only as a hint; `ja` is only a Japanese-reference alias.
- Use `context` only for terminology continuity from an existing root locale.
- If any hint conflicts with `en`, `en` wins.
- Preserve row count and row order exactly.
- Preserve `file`, `index`, and `key` exactly.
- Write a non-empty translated string in the manifest `outputField`.
- Never print full translated chunks in chat.

Output example:

```json
{"file":"main","index":0,"key":"example.key","translation":"<translated text>"}
```

## Subagent Strategy

Use subagents only when their file edits are available in the primary workspace. Use a bounded pool and assign exactly one chunk per subagent. Prefer the lowest-cost model that can reliably preserve JSON, placeholders, tags, and ICU MessageFormat; `gpt-5.4-mini` with low or medium reasoning is appropriate when available. Escalate only after concrete validation failures or semantic ambiguity.

If subagents are unavailable or unsuitable, translate chunks sequentially with the same contract and validate each chunk before moving on.

Worker pitfalls:

- Keep chunks small enough for the chosen model to finish safely. For `gpt-5.4-mini`, do not assume 300+ row chunks are safe; if workers block or produce weak output, preserve the current work directory and re-prepare with smaller `--target-chars` / `--max-entries`.
- Do not validate a worker output file while that worker is still running. A mid-write read can look like row-order corruption. Wait for the worker final response, then validate row count, order, `file`/`index`/`key`, and non-empty output fields.
- If a completed chunk fails validation, discard only that chunk output and re-run that exact chunk. Do not rerun prepare to fix one bad output file.

## Preset Subagent Prompt

Fill every placeholder before dispatching.

```text
You are an offline localization worker for target locale {TARGET_LOCALE}. You own exactly one JSONL chunk.

Input chunk:
{INPUT_CHUNK_PATH}

Output chunk:
{OUTPUT_CHUNK_PATH}

Output field:
{OUTPUT_FIELD}

Hard boundaries:
1. Read the input JSONL chunk and write the output JSONL chunk.
2. Do not modify any file except the output chunk path.
3. Do not read existing target-locale files, other translated locale files, generated distribution files, git history, remote repositories, websites, or online translation services.
4. Do not use translator APIs, browser translation, web search, or special translation scripts.
5. Do not print translated chunk content in chat.

Input rules:
1. Each input line contains file, index, key, en, and may contain reference, ja, context, op.
2. Translate according to en.
3. Use reference, ja, and context only as hints for terminology and tone.
4. If en and any hint conflict, en wins.
5. Do not mechanically copy the context locale.

Output rules:
1. Output valid JSONL with one object per input row.
2. Preserve row count and row order exactly.
3. Preserve file, index, and key exactly.
4. Write only the translated value in the {OUTPUT_FIELD} field.
5. Every translated value must be a non-empty string.

Style rules:
1. Use natural, modern target-locale UI wording.
2. Keep UI labels short and product-like.
3. Keep explanatory copy complete and fluent.
4. Translate sample prompts conversationally without changing task intent.
5. Preserve product behavior and technical meaning.

Must preserve exactly:
1. Product and technical names unless the source clearly uses a generic word.
2. File paths, commands, environment variables, URLs, emails, domains, model names, keyboard shortcuts, and code snippets.
3. Placeholders such as {name}, {count}, {date}.
4. HTML/XML tag names, attributes, and pairing such as <link>...</link> and <b>...</b>.
5. ICU MessageFormat variable names, plural/select branches, one, other, =0, #, and number/date/time formats.
6. Backtick spans.
7. Newlines, Markdown markers, bullets, and meaningful spacing.

Self-check before finishing:
1. Output line count equals input line count.
2. Row order and file/index/key match exactly.
3. No translated value is empty.
4. No translated value contains the replacement character, TODO, or obvious untranslated prose.
5. Placeholder, tag, URL, email, code, backtick, and ICU structures are preserved.
6. The file parses as JSONL.

Final response only:
output: {OUTPUT_CHUNK_PATH}
count: <number of rows>
status: done
```

## Apply And Validate

After all output chunks exist, run:

```bash
node scripts/create-full-locale/apply_translation.mjs --locale <TARGET_LOCALE>
```

The apply script validates every chunk, writes the new target files, appends the locale to `locales.json`, and removes only `.pending/create-full-locale/<TARGET_LOCALE>`.

Then run:

```bash
./build.sh
git status --short
git diff --name-status
```

Expected tracked changes:

- added `<TARGET_LOCALE>/<TARGET_LOCALE>.json`
- added `<TARGET_LOCALE>/<TARGET_LOCALE>.dynamic.json`
- modified `locales.json`
- new workflow scripts or Skill files only when developing this skill

`dist/` is ignored and should not be staged. There must be no `.pending` files in the final commit.

## Commit

When the user explicitly asks to commit, inspect recent subjects first:

```bash
git log -10 --format=%s
```

For a completed full-locale addition, use:

```text
feat: Add <TARGET_LOCALE> locale
```

Stage narrowly. Do not use `git add -A` unless the user explicitly asks and the status is clean except for this workflow.

## Completion Report

Report:

- target locale
- base, reference, and context locales
- output field
- prepare/apply commands run
- chunk counts translated
- whether pending work was cleared
- files changed, staged, or committed
- validation commands and results
