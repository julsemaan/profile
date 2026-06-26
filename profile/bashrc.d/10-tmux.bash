# 10-tmux.bash — Tmux helpers, tmuxifier integration
#
# This file is sourced by the jprofile loader (profile/.bashrc_append).
# Edit in the repo; install copies to /usr/local/etc/bashrc.d/.

joined-tmux() {
  tmux -u attach -d -t "$1" || tmux -u new -s "$1"
}

alias jointmux=joined-tmux

command="jointmux `basename $PWD`"
alias pwdtmux="$command"

CLEAN_HOSTNAME="${HOSTNAME//\./-}"
command="jointmux $CLEAN_HOSTNAME"
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
  local win_root="$1"
  if [ -z "$win_root" ]; then
    echo "usage: tmux-new-coding <T_WIN_ROOT>" >&2
    return 1
  fi

  T_WIN_ROOT="$win_root" tmuxifier load-window coding
}

tmux-new-coding-wt() {
  local path
  path="$(gwt create)" || return 1
  [ -d "$path" ] || { echo "tmux-new-coding-wt: invalid worktree path" >&2; return 1; }
  tmux-new-coding "$path"
}

fix-tmux-ssh() {
  eval $(tmux show-env -s |grep '^SSH_')
}
alias fts=fix-tmux-ssh

# --- Tmuxifier init ---
if [ -d /usr/local/etc/.tmuxifier ]; then
  export PATH="/usr/local/etc/.tmuxifier/bin:$PATH"
  export TMUXIFIER_LAYOUT_PATH=/usr/local/etc/tmuxifiers/
  if [ -z "$__JPROFILE_RELOADING_BASHRC" ]; then
    eval "$(tmuxifier init -)"
  fi
fi

# --- new-session hack (sets terminal title) ---
new-session () {
  nothing > /dev/null 2>&1
}
new-session
