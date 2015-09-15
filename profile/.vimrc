set tabstop=2       " The width of a TAB is set to 2.
                    " Still it is a \t. It is just that
                    " Vim will interpret it to be having
                    " a width of 2.

set shiftwidth=2    " Indents will have a width of 2

set softtabstop=2   " Sets the number of columns for a TAB

set expandtab       " Expand TABs to spaces

set ic              " Ignore case when searching

:map <C-K> :tabp <Enter> " Make Ctrl-down go to the previous tab
:map <C-L> :tabn <Enter>   " Make Ctrl-up go to the next tab

map vs <esc> :/\%V

" Alias the sudo write trick
cnoreabbrev sudowrite w !sudo tee % >/dev/null 

" Dynamically load vim plugins
:filetype plugin on

"map <ESC>[D <C-Left>
"map <ESC>[C <C-Right>
"map! <ESC>[D <C-Left>
"map! <ESC>[C <C-Right>

if &term =~ '^screen'
    " tmux will send xterm-style keys when its xterm-keys option is on
    execute "set <xUp>=\e[1;*A"
    execute "set <xDown>=\e[1;*B"
    execute "set <xRight>=\e[1;*C"
    execute "set <xLeft>=\e[1;*D"
endif
