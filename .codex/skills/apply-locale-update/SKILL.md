---
name: apply-locale-update
description: "Use when applying the claude-i18n pending locale-update branch work: translate repository-generated JSONL chunks, run local apply validation, clean pending artifacts, and prepare the expected locale-update commit."
---

# Apply Locale Update

## Core Boundary

This skill is for the repository's `locale-update` flow. Use it when the maintainer wants the pending locale diff translated and applied locally, without writing a custom prompt. The target locale is a community-supported optional locale such as `zh-CN`, `zh-TW`, or another future locale; do not assume the workflow is Simplified-Chinese-specific.

Use the local workflow and scripts as the source of truth:

- `.github/workflows/locale-update.yml`
- `scripts/locale-update/build_diff.mjs`
- `scripts/locale-update/prepare_translation.mjs`
- `scripts/locale-update/apply_translation.mjs`
- `scripts/locale-update/shared.mjs`

Do not use web search, online translators, translation APIs, remote repositories other than the configured `origin`, generated distribution files, or unrelated translated locale files. Subagents must not read broad repository context. The primary agent may inspect the workflow, scripts, manifests, git state, and the target files needed by the local scripts.

## CI/CD Model

The GitHub Actions workflow runs on a schedule and by manual dispatch. It works on `bot/locale-update`, fetches upstream locale JSON, overwrites `.original`, and creates `.pending/locale-update` only when base-locale entries changed.

The pending directory contains:

- `manifest.json`
- `main.diff.jsonl`
- `dynamic.diff.jsonl`

The bot commit message is `chore: Update original locale files and build diff`. The local maintainer then runs this skill on the same branch to translate, apply, clear pending artifacts, and commit the result. After merge, normal deployment continues from the main branch.

## Mandatory Preflight

Before preparing or translating anything:

1. Confirm the repo root is the current workspace.
2. Confirm `origin` canonicalizes to `github.com/Pectics/claude-i18n.git`. SSH and HTTPS forms are acceptable only if they resolve to that host and path.
3. Confirm the current branch is `bot/locale-update`. If not, switch only when the worktree is clean or the current changes are unrelated and safe to leave untouched.
4. Run `git fetch origin bot/locale-update` and `git pull --rebase origin bot/locale-update`. If sandboxing blocks network access, request approval for the same command instead of skipping this step.
5. Confirm `.pending/locale-update/manifest.json`, `.pending/locale-update/main.diff.jsonl`, and `.pending/locale-update/dynamic.diff.jsonl` exist. If not, stop and report that there is no pending locale-update work to apply.
6. Inspect `git status --short`. Do not proceed if unrelated local changes would be mixed into the translation commit.

## Prepare

Run:

```bash
node scripts/locale-update/prepare_translation.mjs --locale <TARGET_LOCALE>
```

Use the default pending directory unless the user explicitly supplies another one. This script:

- reads `.pending/locale-update/manifest.json`
- reads `main.diff.jsonl` and `dynamic.diff.jsonl`
- reads the current target locale files
- removes any previous `.pending/locale-update/translation/<TARGET_LOCALE>` work directory
- writes input chunks under `.pending/locale-update/translation/<TARGET_LOCALE>/chunks/...`
- expects output chunks under `.pending/locale-update/translation/<TARGET_LOCALE>/out/...`
- writes `.pending/locale-update/translation/<TARGET_LOCALE>/manifest.json`
- writes the expected translated-value field as `outputField` in the work manifest

Read the generated work manifest and use its `chunks` array as the only assignment list. Do not invent chunk paths. Read `outputField` from the same manifest and pass that exact field name to workers. New work manifests normally use `translation`; older pending work may use the legacy `zh` field. Capture the summary counts before apply, because the apply script clears the pending directory on success.

If the manifest has no chunks because the diff only removes keys, skip translation and run the apply step directly.

## Translation Contract

Each input line is a JSON object with:

- `file`, `index`, `key`, `en`
- optional `reference`, `ja`, `op`, `beforeEn`, `currentTarget`

The source of truth is `en`. Reference fields are context only:

- use `reference` only as a hint when present
- use `ja` only as a legacy alias when the reference locale is Japanese
- use `currentTarget` only for terminology continuity
- use `beforeEn` only to understand what changed
- if any context conflicts with `en`, `en` wins

Each output line must:

- be valid JSONL
- preserve row count and order exactly
- preserve `file`, `index`, and `key` exactly
- write a non-empty translated string in the `outputField` from the work manifest

Current generated work manifests use the output field `translation`. If the manifest has no `outputField`, inspect `apply_translation.mjs`; the compatibility fallback for older pending work is `zh`.

Example shape:

```json
{"file":"main","index":0,"key":"example.key","translation":"<translated text>"}
```

Never print full translated chunks in chat. Write them to the output paths from the work manifest.

## Subagent Strategy

Use subagents only when a concrete subagent tool is visible and its file edits can be made available to the primary workspace. If subagents are unavailable, fail to spawn, write in isolated workspaces that cannot be merged, or repeatedly produce invalid chunks, use the sequential fallback.

For routine chunk translation, do not let subagents inherit an expensive frontier model by default. When the runtime supports model overrides, choose the lowest-cost model that can reliably preserve JSON, placeholders, and ICU structure. In the current runtime, a small model such as `gpt-5.4-mini` with low or medium reasoning is appropriate for normal chunks. Escalate a single difficult chunk only after concrete validation failures or semantic ambiguity show the cheaper model is insufficient.

Use a bounded pool. Assign exactly one chunk per subagent unless the user explicitly asks for larger batches. Keep the primary agent responsible for preparation, validation, apply, cleanup, staging, and commit decisions.

Do not send vague delegation prompts. Every subagent prompt must include exact input path, exact output path, target locale, output field from the work manifest, source-of-truth rules, preservation rules, quote and punctuation rules, validation expectations, and final response format.

### Runtime Worker Selection

Use the in-product invisible SubAgent/Worker facility, not a background-thread or create-thread tool that adds ordinary user-visible conversations to the task list. Do not use an external `codex` CLI process as a substitute.

When the maintainer specifies a model or reasoning effort, pass the runtime's actual Worker override fields explicitly. In runtimes where full-history forks inherit the parent configuration, use an isolated/no-history fork so the requested Worker model and reasoning effort can take effect. A concrete known shape is `model: gpt-5.6-luna`, `reasoning_effort: medium`, and `fork_turns: none`; use the maintainer's requested values rather than silently substituting these defaults.

If a Worker call rejects a model-setting field, inspect the returned accepted-field list. For example, the runtime may accept `reasoning_effort` rather than `thinking`. Do not claim that overrides are unavailable until the real Worker call has been tested. Do not use a visible background thread merely because it exposes easier model controls.

Follow-up assignments may reuse an already-created Worker because it retains its configured model and reasoning effort. Still assign exactly one chunk per Worker turn and keep the pool bounded.

### Low-Noise Output Generation

Do not make the model generate a complete output JSONL file through an add-file patch. That repeats `file`, `index`, and `key` for every row and spends model output on deterministic metadata. Copying the input chunk and then editing it with a line-based unified diff is also inefficient: each JSONL object occupies one line, so changing only the translation still emits the whole line, and often an old line plus diff context.

Prefer this low-noise pattern:

1. The Worker translates the rows into an ordered in-memory array containing only translated strings.
2. The Worker uses a small inline, deterministic JSON-safe writer such as Node.js to parse the input chunk and pair each row with `translations[index]`.
3. The writer writes the manifest-provided output path directly, with the minimal shape `{ file, index, key, [outputField]: translations[index] }` and one JSON object per line.
4. The Worker verifies array length before writing and validates the completed output afterward.

The inline writer is mechanical serialization, not a translation service or repository translation script. It must not infer, rewrite, or translate text. Do not create extra temporary files when the output can be assembled directly. Do not retain `en`, `reference`, `ja`, `op`, `beforeEn`, or `currentTarget` in output rows even though the current apply validator may tolerate extra fields.

Never use generic filler, reference-field fallback, source copying, or a repeated placeholder merely to complete a chunk. Missing `currentTarget` is normal and is not a reason to weaken translation quality. If a Worker reports fallback, incomplete work, or insufficient time, reject the chunk and reassign it to another Worker using the same requested model before validation.

## Execution Pitfalls

1. “Worker” means the in-product SubAgent/Worker facility. Do not invoke an external `codex` CLI process as a substitute for a Worker. When the user specifies a Worker model, select or request that model in the Worker facility; do not silently substitute another model.
2. A temporary Worker capacity failure is not a reason to downgrade the requested model. Retry the same chunk with the same Worker model, using the bounded pool, before considering a fallback. Ask the maintainer before changing models.
3. Do not inspect or validate an output path until its Worker has returned `status: done`. Reading a chunk while it is still being written can produce false structural failures.
4. Keep the configured `origin` transport unchanged. If an SSH `fetch`, `pull`, `push`, or verification command stalls or fails transiently, first retry the exact same SSH command once. Do not switch to HTTPS, rewrite URLs, change SSH host or port, or infer missing credentials unless the maintainer explicitly asks. After a successful push, verify the same branch with `git ls-remote` over the configured transport.

## Preset Subagent Prompt

Use this prompt structure when spawning subagents. Fill every placeholder before sending. Keep the hard boundaries intact.

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
1. Each input line contains file, index, key, en, and may contain reference, ja, op, beforeEn, currentTarget.
2. Translate according to en. If reference exists, use it only as contextual help.
3. If en and any context conflict, en wins.
4. If currentTarget exists, use it only for terminology continuity; do not mechanically reuse it.
5. If beforeEn exists, use it only to understand the source change.
6. If ja exists, treat it only as a legacy Japanese-reference alias, not as the source of truth.

Output rules:
1. Output JSONL with one object per input row.
2. Preserve row count and row order exactly.
3. Preserve file, index, and key exactly.
4. Write only the translated value in the {OUTPUT_FIELD} field.
5. Every translated value must be a non-empty string.
6. The output file must be valid JSONL. Prefer JSON.stringify or an equivalent JSON-safe writer if you generate rows programmatically.
7. Generate an ordered array of translated strings first, then use a deterministic inline writer to combine it with file/index/key from the input rows.
8. Write minimal output objects only. Do not copy source or context fields into the output.
9. Do not create the complete JSONL through an add-file patch or a line-by-line unified diff.

Style rules:
1. Use natural, modern target-locale UI wording.
2. Keep UI labels short and product-like.
3. Keep explanatory copy complete and fluent.
4. Translate sample prompts conversationally without changing task intent.
5. Preserve the source meaning first; do not over-localize product behavior.
6. Avoid unnatural calques from any reference field.

Quote and punctuation rules:
1. Source straight quotation marks around human-language text are punctuation, not protected syntax.
2. Render human-language quotes and surrounding punctuation using common target-locale writing conventions.
3. If the target locale has multiple common quote styles, choose the style most natural for contemporary UI prose and use it consistently.
4. Do not keep escaped straight quotes from the source merely to avoid JSON escaping.
5. Do not choose an unusual quote style merely to avoid JSON escaping.
6. Preserve straight quotes only when they are part of code, commands, paths, placeholders, HTML/XML attributes, URLs, emails, backtick spans, or another literal syntax.
7. Never write raw unescaped straight quotes inside a JSON string.

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
7. The output file actually exists at the exact requested path; a final `status: done` without a valid file is a failure.
8. Every row was genuinely translated from en; no row uses generic filler, repeated placeholder text, source copying, or reference-only fallback.

Final response only:
output: {OUTPUT_CHUNK_PATH}
count: <number of rows>
status: done
```

## Sequential Fallback

When subagents are unavailable or unsuitable, process chunks one at a time using the same rules as the preset prompt. If the runtime has a plan or checklist tool, create a visible chunk checklist and update it as chunks complete. For many chunks, group visible plan items by small ranges, but still validate every individual chunk.

Do not lower quality expectations in fallback mode. Write each chunk to the manifest-provided output path, then perform structural checks before moving to the next chunk.

## Validation

Validate every output chunk before apply:

- input and output line counts match
- output parses as JSONL
- row order and `file`/`index`/`key` match exactly
- translated field is present, a string, and non-empty
- no replacement character, TODO marker, or obvious untranslated prose
- placeholders, brace structures, ICU branches, tags, URLs, emails, code spans, backtick spans, and Markdown structure are preserved
- human-language quotes follow target-locale conventions while JSON remains valid
- target-locale-specific checks are respected; for example, Chinese-family locales still reject obvious untranslated English, while Latin-script target locales are not rejected merely for using Latin letters
- the output file exists even if the Worker returned `status: done`; never trust the final response without checking the artifact
- output rows use the minimal expected keys rather than retaining source/context fields
- translations are not generic filler, repeated fallback text, source copies, or reference-only translations

Treat a Worker final response and a valid output artifact as separate conditions. Do not inspect an output while its Worker is still running, but after `status: done`, confirm existence and parse it immediately. If the file is missing, structurally invalid, or the Worker admits using fallback, reject and retry that same chunk. After repeated quality failures, replace the Worker while keeping the requested model and reasoning effort.

The authoritative validation happens in:

```bash
node scripts/locale-update/apply_translation.mjs --locale <TARGET_LOCALE>
```

Run it only after all chunk outputs exist. If it fails, fix the specific chunk/key it reports and rerun. If it succeeds, it writes the production target files and removes `.pending/locale-update`.

## Apply And Cleanup

After all chunks are valid, run:

```bash
node scripts/locale-update/apply_translation.mjs --locale <TARGET_LOCALE>
```

Expected successful behavior:

- rebuilds `<TARGET_LOCALE>/<TARGET_LOCALE>.json`
- rebuilds `<TARGET_LOCALE>/<TARGET_LOCALE>.dynamic.json`
- removes keys marked `remove`
- applies translated values for `add` and `update`
- preserves existing target values for unchanged keys
- deletes `.pending/locale-update`

After apply, confirm `.pending/locale-update` no longer exists. Never commit a still-present `.pending` translation work directory. If pending artifacts remain, stop and investigate before staging.

### Applying Multiple Existing Locales

When the maintainer asks to update every existing target locale, derive the locale list from the repository's locale manifest such as `locales.json`; do not assume there is only one target.

`apply_translation.mjs` clears the entire pending directory after each successful locale apply. Therefore process locales sequentially:

1. Prepare, translate, validate, and apply the first locale.
2. Confirm its production files were updated and pending was cleared.
3. Restore only the tracked pending source artifacts from the current branch commit, for example with `git restore --source=HEAD -- .pending/locale-update` when those artifacts are tracked.
4. Prepare the next locale from that restored source and repeat.
5. Never restore or overwrite already-applied production locale files.
6. After the final locale apply, leave `.pending/locale-update` deleted.

Record the shared diff summary before the first apply. Restoring tracked pending source artifacts between locales is an intentional intermediate step, not the final cleanup state. Do not use a copied alternate pending directory unless the maintainer explicitly requests one.

## Post-Apply Checks

Run `git status --short` and `git diff --name-status`.

Expected changes are:

- modified production locale files for `<TARGET_LOCALE>`
- deleted `.pending/locale-update/...` files only if those pending artifacts were tracked on the current branch

There must be no added or modified `.pending` files, no `.original` changes from the local run, and no unrelated files. If unexpected files changed, do not stage them.

Perform a lightweight count sanity check before committing:

- before apply, record each file's `add`, `update`, and `remove` counts from the pending manifest or `*.diff.jsonl`
- after apply, compare the production file diff with the expected changed value-line count: `add + remove + (update * 2)`
- count changed JSON value lines with a narrow diff view such as `git diff --unified=0 -- <TARGET_FILE>` and inspect lines beginning with `+` or `-` for JSON keys
- verify that files with zero diff rows did not receive production changes
- spot-check additions, updates, removals, placeholders, and quoted prose

This count check is a sanity signal, not a replacement for `apply_translation.mjs` validation.

## Commit

Inspect recent commit subjects before choosing the message:

```bash
git log -10 --format=%s
```

Use the repository's established style. For this workflow, the human translation commit normally follows:

```text
chore: Apply <TARGET_LOCALE> translations and build diff
```

Stage narrowly. Prefer explicit paths, for example:

```bash
git add <TARGET_LOCALE>/<TARGET_LOCALE>.json <TARGET_LOCALE>/<TARGET_LOCALE>.dynamic.json
git add -u .pending/locale-update
```

Use the second command only to record deletion of tracked pending artifacts. Do not use `git add -A` for the translation commit. Before committing, re-run `git status --short` and confirm the staged set matches the expected changes.

## Completion Report

At the end, report:

- target locale
- output field used
- prepare/apply commands run
- number of chunks translated
- whether `.pending/locale-update` was cleared
- files staged or committed
- validation result

If the work was not committed, say exactly what remains for the maintainer to do.
