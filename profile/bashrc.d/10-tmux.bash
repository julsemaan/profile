# 10-tmux.bash - Tmux helpers, tmuxifier integration
#
# This file is sourced by the jprofile loader (profile/.bashrc_append).
# Edit in the repo; install copies to /usr/local/etc/bashrc.d/.

joined-tmux() {
  tmux -u attach -d -t "$1" || tmux -u new -s "$1"
}

alias jointmux=joined-tmux

command="jointmux $(basename "$PWD")"
# shellcheck disable=SC2139
alias pwdtmux="$command"

CLEAN_HOSTNAME="${HOSTNAME//\./-}"
command="jointmux $CLEAN_HOSTNAME"
# shellcheck disable=SC2139
alias htmux="$command"

function jointmuxifier {
  local session="$1"
  if [ -z "$session" ]; then
    echo "usage: jointmuxifier <session>" >&2
    return 1
  fi

  tmuxifier load-session "$session"
}

alias kpptmux="cd ~ && jointmuxifier kpp"
alias kubextmux="cd ~ && jointmuxifier kubex"

tmux-new-coding() {
  local win_root="$1" win_name git_dir common_dir
  if [ -z "$win_root" ]; then
    echo "usage: tmux-new-coding <T_WIN_ROOT>" >&2
    return 1
  fi

  git_dir="$(git -C "$win_root" rev-parse --git-dir 2>/dev/null)" || git_dir=""
  common_dir="$(git -C "$win_root" rev-parse --git-common-dir 2>/dev/null)" || common_dir=""
  if [ -n "$git_dir" ] && [ -n "$common_dir" ]; then
    git_dir="$(cd "$win_root" && cd "$git_dir" && pwd -P)" || git_dir=""
    common_dir="$(cd "$win_root" && cd "$common_dir" && pwd -P)" || common_dir=""
  fi

  if [ -n "$git_dir" ] && [ -n "$common_dir" ] && [ "$git_dir" != "$common_dir" ]; then
    win_name="$(git -C "$win_root" symbolic-ref --quiet --short HEAD)" || {
      echo "tmux-new-coding: unable to resolve worktree branch" >&2
      return 1
    }
    [ -n "$win_name" ] || {
      echo "tmux-new-coding: unable to resolve worktree branch" >&2
      return 1
    }
  else
    win_name="${T_WIN_NAME:-}"
  fi

  if [ -n "$win_name" ]; then
    T_WIN_NAME="$win_name" T_WIN_ROOT="$win_root" tmuxifier load-window coding
  else
    T_WIN_ROOT="$win_root" tmuxifier load-window coding
  fi
}

tmux-new-coding-wt() {
  local path branch
  path="$(gwt create)" || return 1
  [ -d "$path" ] || {
    echo "tmux-new-coding-wt: invalid worktree path" >&2
    return 1
  }
  branch="$(git -C "$path" symbolic-ref --quiet --short HEAD)" || {
    echo "tmux-new-coding-wt: unable to resolve worktree branch" >&2
    return 1
  }
  [ -n "$branch" ] || {
    echo "tmux-new-coding-wt: unable to resolve worktree branch" >&2
    return 1
  }
  T_WIN_NAME="$branch" tmux-new-coding "$path"
}

alias tnc='tmux-new-coding'
alias tncw='tmux-new-coding-wt'

fix-tmux-ssh() {
  eval "$(tmux show-env -s | grep '^SSH_')"
}
alias fts=fix-tmux-ssh

# --- Tmuxifier init ---
if [ -d /usr/local/etc/.tmuxifier ]; then
  jprofile_path_prepend /usr/local/etc/.tmuxifier/bin
  export TMUXIFIER_LAYOUT_PATH=/usr/local/etc/tmuxifiers/
  if [ -z "$__JPROFILE_RELOADING_BASHRC" ]; then
    eval "$(tmuxifier init -)"
  fi
fi

# --- new-session hack (sets terminal title) ---
new-session() {
  nothing >/dev/null 2>&1
}
new-session
