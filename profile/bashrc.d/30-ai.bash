# 30-ai.bash - AI commit message helpers, agent shortcuts
#
# This file is sourced by the jprofile loader (profile/.bashrc_append).
# Edit in the repo; install copies to /usr/local/etc/bashrc.d/.

genCommitMsg() {
  local model="$1"
  if [ -z "$model" ]; then
    echo "genCommitMsg: missing model" >&2
    return 1
  fi

  local repo_root
  repo_root="$(git rev-parse --show-toplevel 2>/dev/null)" || {
    echo "Not a git repository" >&2
    return 1
  }

  if git diff --cached --quiet --exit-code; then
    echo "genCommitMsg: no staged changes" >&2
    return 1
  fi

  local tmp="$repo_root/.gen_commit_msg.$$.diff"
  git diff --staged >"$tmp"

  local pi_run
  if [ -f "$repo_root/profile/pi-unleashed-safely.sh" ]; then
    pi_run="$repo_root/profile/pi-unleashed-safely.sh --dev"
  else
    pi_run="pi-unleashed-safely"
  fi

  local exit_status=0
  local output
  output=$($pi_run \
    --mount "$repo_root" \
    --workdir "$PWD" \
    -- \
    --no-extensions \
    --print \
    --model "$model" \
    --thinking off \
    "@$tmp" \
    "Write a one-line commit message for the currently staged changes following the Conventional Commits standard. Output only the commit message, no backticks, no formatting, just the text." 2>&1) || exit_status=$?

  rm -f "$tmp"

  if [ $exit_status -ne 0 ]; then
    echo "genCommitMsg: failed to generate commit message (exit code $exit_status)" >&2
    printf '%s\n' "$output" >&2
    return $exit_status
  fi

  local msg
  msg="$(printf '%s\n' "$output" | sed '/^[[:space:]]*$/d' | tail -n 1 | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
  if [ -z "$msg" ]; then
    echo "genCommitMsg: model returned an empty commit message" >&2
    return 1
  fi
  if printf '%s' "$msg" | grep -Eiq '(^|[^a-z])(error|exception|traceback|rate limit|429|failed|unauthorized|forbidden)([^a-z]|$)'; then
    echo "genCommitMsg: refusing suspicious generated commit message: $msg" >&2
    return 1
  fi

  echo "$msg"
  return 0
}

gcoto-commit-with-model() {
  local model="$1"
  if [ -z "$model" ]; then
    echo "usage: gcoto-commit-with-model <model>" >&2
    return 1
  fi

  local msg
  msg="$(genCommitMsg "$model")" || return 1
  git commit -m "$msg"
}

gcoto-openai() {
  gcoto-commit-with-model openai-codex/gpt-5.4-mini
}

gcoto-deepseek() {
  gcoto-commit-with-model deepseek/deepseek-v4-flash
}

gcoto-free() {
  gcoto-commit-with-model opencode/mimo-v2.5-free
}

# gcoto-model: model selection helper (cached per session via _GCOTO_MODEL)
# Usage: gcoto-model [openai|deepseek|free|current|unset]
# shellcheck disable=SC2120
function gcoto-model {
  case "${1:-}" in
  "")
    if [ ! -t 0 ]; then
      echo "gcoto-model: no model set and not interactive - pass a model name" >&2
      return 1
    fi
    echo "Select AI model for commit messages:"
    echo "  1) openai (gpt-5.4-mini)"
    echo "  2) deepseek (v4-flash)"
    echo "  3) free (mimo-v2.5)"
    echo "  q) cancel"
    while true; do
      printf "Model (1-3): "
      if ! IFS= read -r -n 1; then
        echo
        return 1
      fi
      echo
      case $REPLY in
      1)
        _GCOTO_MODEL="openai-codex/gpt-5.4-mini"
        break
        ;;
      2)
        _GCOTO_MODEL="deepseek/deepseek-v4-flash"
        break
        ;;
      3)
        _GCOTO_MODEL="opencode/mimo-v2.5-free"
        break
        ;;
      q|Q)
        return 1
        ;;
      *) echo "Invalid choice" >&2 ;;
      esac
    done
    ;;
  openai) _GCOTO_MODEL="openai-codex/gpt-5.4-mini" ;;
  deepseek) _GCOTO_MODEL="deepseek/deepseek-v4-flash" ;;
  free) _GCOTO_MODEL="opencode/mimo-v2.5-free" ;;
  current) echo "${_GCOTO_MODEL:-<unset>}" ;;
  unset) unset _GCOTO_MODEL ;;
  *)
    echo "gcoto-model: unknown option '$1' - use openai, deepseek, free, current, or unset" >&2
    return 1
    ;;
  esac
}

# gcoto: generate commit message using selected model
function gcoto {
  if [ -z "${_GCOTO_MODEL:-}" ]; then
    # shellcheck disable=SC2119
    gcoto-model || return 1
  fi
  if [ -z "${_GCOTO_MODEL:-}" ]; then
    echo "gcoto: no model selected" >&2
    return 1
  fi
  gcoto-commit-with-model "$_GCOTO_MODEL"
}

# --- gacp (add-commit-push, depends on gcoto and gpush/gaireview from 20-git.bash) ---
function gacp {
  local ai_review=0
  if [[ "${1:-}" == "--ai-review" ]]; then
    ai_review=1
  elif [[ -n "${1:-}" ]]; then
    echo "Usage: gacp [--ai-review]"
    return 1
  fi

  git add .
  git diff --cached --stat
  echo
  if [[ $ai_review -eq 1 ]]; then
    read -p "Commit and request AI review? [y/N] " -n 1 -r
  else
    read -p "Commit and push staged changes? [y/N] " -n 1 -r
  fi
  echo
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    if [[ $ai_review -eq 1 ]]; then
      gcoto && gaireview
    else
      gcoto && gpush
    fi
  fi
}

# --- Agent shortcuts ---
alias codex-unleashed-safely-src='codex-unleashed-safely -m ~/src/'
alias opencode-unleashed-safely-src='opencode-unleashed-safely -m ~/src/'
alias pi-unleashed-safely-src='pi-unleashed-safely -m ~/src/'
