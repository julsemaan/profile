# 00-core.bash — Shell foundation, prompt, reload, ble.sh, fzf
#
# This file is sourced by the jprofile loader (profile/.bashrc_append).
# Edit in the repo; install copies to /usr/local/etc/bashrc.d/.

# return if we are not in a tty
[ -z "$PS1" ] && return

# --- Bashrc reload mechanism ---
__JPROFILE_BASHRC_TRIGGER_FILE="$HOME/.bashrc-reload-trigger"
if [ -f "$__JPROFILE_BASHRC_TRIGGER_FILE" ]; then
  __JPROFILE_LAST_BASHRC_TRIGGER="$(cat "$__JPROFILE_BASHRC_TRIGGER_FILE" 2>/dev/null)"
fi

jprofile_prompt_hook() {
  if [ -f "$__JPROFILE_BASHRC_TRIGGER_FILE" ]; then
    local current_trigger
    current_trigger="$(cat "$__JPROFILE_BASHRC_TRIGGER_FILE" 2>/dev/null)"
    if [ -n "$current_trigger" ] && [ "$current_trigger" != "$__JPROFILE_LAST_BASHRC_TRIGGER" ]; then
      __JPROFILE_LAST_BASHRC_TRIGGER="$current_trigger"
      if [ -z "$__JPROFILE_RELOADING_BASHRC" ]; then
        __JPROFILE_RELOADING_BASHRC=1
        source ~/.bashrc
        unset __JPROFILE_RELOADING_BASHRC
      fi
    fi
  fi
}

trigger-bashrc-reload() {
  echo "$(date +%s):$$:$RANDOM" > "$__JPROFILE_BASHRC_TRIGGER_FILE"
}

alias rbrc-all='trigger-bashrc-reload'
# --- End bashrc reload mechanism ---

export EDITOR=vim

# --- Completions ---
source /etc/bash_completion
source /etc/bash_completion.d/complete_alias

if command -v direnv >/dev/null 2>&1; then
  eval "$(direnv hook bash)"
fi

# --- Basic aliases ---
alias rm='rm -I'
alias cd..='cd ..'
alias ll='ls -al --color=auto'

function add_alias {
  alias $1="$2"
  complete -F _complete_alias $1
}

# --- Prompt ---
# parse_git_dirty and parse_git_branch are defined in 20-git.bash
PS1="\$(history -a)\u\[$(tput bold)\]\[$(tput sgr0)\]\[\033[38;5;196m\]@\H\[$(tput sgr0)\]\[$(tput sgr0)\]\[\033[38;5;15m\] [\w] {\[$(tput sgr0)\]\[\033[38;5;4m\]\$?\[$(tput sgr0)\]\[\033[38;5;15m\]} \$(parse_git_branch) \n\[$(tput bold)\]\\$\[$(tput sgr0)\] \[$(tput sgr0)\]"
shopt -s histappend

if [ -z "$PROMPT_COMMAND" ]; then
  PROMPT_COMMAND='jprofile_prompt_hook'
elif [[ "$PROMPT_COMMAND" != *"jprofile_prompt_hook"* ]]; then
  PROMPT_COMMAND="$PROMPT_COMMAND;jprofile_prompt_hook"
fi

trap 'printf "\033]0;%s\007" "${BASH_COMMAND//[^[:print:]]/}"' DEBUG

# --- Shell binds ---
bind '"\C-xa": alias-expand-line'

# --- ble.sh ---
if [ -z "${BLE_ENABLE+x}" ]; then
  if [ "${TERM_PROGRAM:-}" = "ghostty" ] || [ "${TERM:-}" = "xterm-ghostty" ]; then
    BLE_ENABLE=no
  else
    BLE_ENABLE=yes
  fi
fi
if [ -z "$__JPROFILE_RELOADING_BASHRC" ] && [ "$BLE_ENABLE" = "yes" ] && [ -f /usr/local/etc/ble.sh/out/ble.sh ]; then
  source /usr/local/etc/ble.sh/out/ble.sh
  bind '"\e\C-?": backward-kill-word'
fi

# --- fzf ---
if [ -f /usr/local/etc/.fzf.bash ]; then
  export PATH="/usr/local/etc/fzf/bin/:$PATH"
  if [ -z "$__JPROFILE_RELOADING_BASHRC" ]; then
    source /usr/local/etc/.fzf.bash
    _ble_contrib_fzf_base=/usr/local/etc/fzf
  fi

  _fzf_comprun() {
    local command=$1
    shift
    case "$command" in
      cd)              fzf --preview 'ls -l {} | head -200'   "$@" ;;
      export|unset|echo) fzf --preview "eval 'echo \$'{}"         "$@" ;;
      ssh)             fzf --preview 'comm -13 <(ssh -T -G non-existing-host | sort) <(ssh -T -G {} | sort)' "$@" ;;
      *)               fzf --preview 'bat -n --color=always {}' "$@" ;;
    esac
  }
  complete -o default -o nospace -v -F _fzf_var_completion echo
fi

# --- PATH ---
export PATH="/opt/nvim-linux64/bin:$PATH"
