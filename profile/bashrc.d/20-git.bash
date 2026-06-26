# 20-git.bash — Git aliases and helpers
#
# This file is sourced by the jprofile loader (profile/.bashrc_append).
# Edit in the repo; install copies to /usr/local/etc/bashrc.d/.

# --- Git prompt helpers (used by PS1 in 00-core.bash) ---
function parse_git_dirty {
  git diff --no-ext-diff --quiet --exit-code &> /dev/null || echo "*"
}

function parse_git_branch {
  git branch --no-color 2> /dev/null | sed -e '/^[^*]/d' -e "s/* \(.*\)/(\1$(parse_git_dirty))/"
}

# --- Basic git aliases ---
if `which fortune > /dev/null 2>&1`; then
  add_alias gco 'git commit -a -m"$(fortune -n 50 -s)"'
else
  add_alias gco 'git commit -a'
fi
add_alias gpush 'git push origin HEAD'
add_alias grh 'git reset HEAD --hard'
add_alias gfo 'git fetch origin'
add_alias gpoh 'git fetch origin && git pull --no-rebase origin HEAD'
add_alias gs 'git status'
add_alias sbrc 'source ~/.bashrc'

# gch: git checkout with fzf branch picker when no args given
unalias gch 2>/dev/null
gch() {
  if [ $# -eq 0 ]; then
    local local_branches remote_branches selected
    local_branches=$(git branch --format='%(refname:short)' 2>/dev/null)
    remote_branches=$(git branch --remote --format='%(refname:short)' 2>/dev/null | grep -v '/HEAD$')
    selected=$(printf '%s\n%s\n' "$local_branches" "$remote_branches" | awk '!seen[$0]++' | fzf --height=40% --reverse --prompt="Checkout branch> ")
    [ -z "$selected" ] && return 0
    if [[ "$selected" == */* ]]; then
      local branch_name="${selected#*/}"
      if git show-ref --verify --quiet "refs/heads/$branch_name" 2>/dev/null; then
        git checkout "$branch_name"
      else
        git checkout --track "$selected"
      fi
    else
      git checkout "$selected"
    fi
  else
    git checkout "$@"
  fi
}
if type __git_complete >/dev/null 2>&1; then
  __git_complete gch git_checkout
fi

# --- gchjira ---
gchjira() {
  local opt jira_url branch create_new=false
  local OPTIND=1

  while getopts "b" opt; do
    case "$opt" in
      b) create_new=true ;;
      *) echo "Usage: gchjira [-b] <jira-url>"; return 1 ;;
    esac
  done

  shift $((OPTIND - 1))

  jira_url="$1"

  if [ -z "$jira_url" ]; then
    echo "Usage: gchjira [-b] <jira-url>"
    return 1
  fi

  branch="$(printf '%s' "$jira_url" | grep -oE '[A-Z][A-Z0-9]*-[0-9]+' | head -n1)"

  if [ -z "$branch" ]; then
    echo "Could not extract JIRA issue key from URL: $jira_url"
    return 1
  fi

  if [ "$create_new" = true ]; then
    git checkout -b "$branch"
  else
    git checkout "$branch"
  fi
}

# --- gtagpush ---
gtagpush() {
  local tag="$1"
  if [ -z "$tag" ]; then
    echo "usage: gtagpush <tag>"
    return 1
  fi

  git tag "$tag" && git push origin "$tag"
}

# --- gom ---
gom() {
  local base

  git fetch origin || return 1

  base="$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null)"
  if [ -z "$base" ]; then
    # ponytail: origin/HEAD often missing on self-hosted git; fallback to common defaults
    if git show-ref --verify --quiet refs/remotes/origin/main; then
      base=origin/main
    elif git show-ref --verify --quiet refs/remotes/origin/master; then
      base=origin/master
    else
      echo "gom: could not detect origin default branch; run: git remote set-head origin -a" >&2
      return 1
    fi
  fi

  git merge "$base"
}

# --- Review aliases ---
add_alias gautoreview 'git commit -m "[ai-review]" --allow-empty && gpush'
add_alias gaireview 'git commit -m "[ai-review]" --allow-empty && gpush'

# --- Legacy aliases ---
alias qco=gco
alias qpush=gpush


