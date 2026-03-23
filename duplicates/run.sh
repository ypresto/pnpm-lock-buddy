#!/usr/bin/env bash
set -euo pipefail

# Determine pnpm-lock-buddy version
if [ -n "${INPUT_VERSION}" ]; then
  VERSION="${INPUT_VERSION}"
else
  VERSION=$(node -e "console.log(require('${ACTION_PATH}/../package.json').version)")
fi

# Set NODE_OPTIONS for large lockfiles
export NODE_OPTIONS="--max-old-space-size=${INPUT_MAX_OLD_SPACE_SIZE}"

# Build arguments
ARGS=(duplicates)

if [ "${INPUT_PER_PROJECT}" = "true" ]; then
  ARGS+=(--per-project)
fi

if [ "${INPUT_DEPS}" = "true" ]; then
  ARGS+=(--deps)
fi

if [ -n "${INPUT_OMIT}" ]; then
  for type in ${INPUT_OMIT}; do
    ARGS+=("--omit=${type}")
  done
fi

if [ -n "${INPUT_LOCKFILE}" ]; then
  ARGS+=(--file "${INPUT_LOCKFILE}")
fi

if [ -n "${INPUT_IGNORE_FILE}" ] && [ -f "${INPUT_IGNORE_FILE}" ]; then
  ARGS+=(--ignore-file "${INPUT_IGNORE_FILE}")
fi

ARGS+=(--exit-code)

# Add extra args
if [ -n "${INPUT_EXTRA_ARGS}" ]; then
  # shellcheck disable=SC2086
  ARGS+=(${INPUT_EXTRA_ARGS})
fi

# Add packages (word-split intentionally)
# shellcheck disable=SC2086
ARGS+=(${INPUT_PACKAGES})

# Run the command, capturing output
OUTPUT_FILE=$(mktemp)
EXIT_CODE=0
pnpm dlx "pnpm-lock-buddy@${VERSION}" "${ARGS[@]}" 2>&1 | tee "${OUTPUT_FILE}" || EXIT_CODE=$?

# Set outputs
if [ "${EXIT_CODE}" -ne 0 ]; then
  echo "has-duplicates=true" >> "${GITHUB_OUTPUT}"
else
  echo "has-duplicates=false" >> "${GITHUB_OUTPUT}"
fi

# Post PR comment if enabled
if [ "${INPUT_COMMENT}" = "true" ] && [ "${GITHUB_EVENT_NAME}" = "pull_request" ]; then
  OUTPUT_CONTENT=$(cat "${OUTPUT_FILE}")
  MARKER="<!-- pnpm-lock-buddy-duplicates -->"

  if [ "${EXIT_CODE}" -ne 0 ]; then
    SUMMARY="Duplicate packages found"
  else
    SUMMARY="No duplicate packages found"
  fi

  # Truncate if too long (GitHub comment limit is 65536 chars)
  MAX_BODY_LENGTH=60000
  BODY_LENGTH=${#OUTPUT_CONTENT}
  if [ "${BODY_LENGTH}" -gt "${MAX_BODY_LENGTH}" ]; then
    OUTPUT_CONTENT="${OUTPUT_CONTENT:0:${MAX_BODY_LENGTH}}

... (truncated, ${BODY_LENGTH} chars total)"
  fi

  # Build comment body
  COMMENT_BODY="${MARKER}
<details>
<summary><strong>${SUMMARY}</strong></summary>

\`\`\`
${OUTPUT_CONTENT}
\`\`\`

</details>"

  # Write comment body to a temp file for gh cli
  COMMENT_FILE=$(mktemp)
  echo "${COMMENT_BODY}" > "${COMMENT_FILE}"

  # Try to find and update existing comment, or create new one
  PR_NUMBER=$(jq -r '.pull_request.number' "${GITHUB_EVENT_PATH}")

  EXISTING_COMMENT_ID=$(gh api \
    "repos/${GITHUB_REPOSITORY}/issues/${PR_NUMBER}/comments" \
    --jq ".[] | select(.body | startswith(\"${MARKER}\")) | .id" \
    2>/dev/null | head -1 || true)

  if [ -n "${EXISTING_COMMENT_ID}" ]; then
    gh api \
      "repos/${GITHUB_REPOSITORY}/issues/comments/${EXISTING_COMMENT_ID}" \
      --method PATCH \
      --field "body=@${COMMENT_FILE}" || echo "::warning::Failed to update PR comment"
  else
    gh pr comment "${PR_NUMBER}" --body-file "${COMMENT_FILE}" || echo "::warning::Failed to create PR comment"
  fi

  rm -f "${COMMENT_FILE}"
fi

rm -f "${OUTPUT_FILE}"

exit "${EXIT_CODE}"
