"""""
" Control variables to put in .bashrc
" SKIP_VIM_PLUGINS=1 will skip the installation+usage of the vim plugins
" CTRLP_USE_AG=1 will use ag in Ctrl-P instead of the slow vimscript searcher

" leader
:let mapleader = ","

""""""""""""""""""""
" Vundle + Plugins
" # git clone https://github.com/VundleVim/Vundle.vim.git /usr/local/etc/.vim/bundle/Vundle.vim
"
set nocompatible              " be iMproved, required
filetype off                  " required

let skip_vim_plugins=$SKIP_VIM_PLUGINS
if skip_vim_plugins != '1'
  " set the runtime path to include Vundle and initialize
  set rtp+=/usr/local/etc/.vim/bundle/Vundle.vim
  call vundle#begin()

  Plugin 'git://github.com/kien/ctrlp.vim.git'
  Plugin 'git://github.com/tmhedberg/matchit.git'
  Plugin 'git://github.com/scrooloose/nerdtree.git'
  Plugin 'git://github.com/jistr/vim-nerdtree-tabs.git'
  Plugin 'fatih/vim-go'
  " markdown
  Plugin 'godlygeek/tabular'
  Plugin 'plasticboy/vim-markdown'

  Plugin 'mustache/vim-mustache-handlebars'

  " All of your Plugins must be added before the following line
  call vundle#end()            " required
  filetype plugin indent on    " required
endif

"""""""""""""
" Tabs (\t)
"
set tabstop=2               " The width of a TAB is set to 2.
                            " Still it is a \t. It is just that
                            " Vim will interpret it to be having
                            " a width of 2.
        
set shiftwidth=2            " Indents will have a width of 2
        
set softtabstop=2           " Sets the number of columns for a TAB

set expandtab               " Expand TABs to spaces

set smartindent             " Make new lines indent automagically

" Tabs for perl are 4
autocmd Filetype perl setlocal expandtab tabstop=4 shiftwidth=4 softtabstop=4

"""""""""""""""""
" Key bindings
"
:map <Leader>k :tabp <Enter>    " Make ,k go to the previous tab
:map <Leader>l :tabn <Enter>    " Make ,l go to the next tab

set pastetoggle=<Leader>p       " Make ,p toggle paste mode

"""""""""
" CtrlP
"
" Use ag for file indexing
let ctrlp_use_ag=$CTRLP_USE_AG
if ctrlp_use_ag == '1'
  let g:ctrlp_user_command = 'ag %s -l --nocolor -g ""'
endif

"""""""""
" Other 
"

" We want syntax
syntax on

" Keep vim backups file in a temp directory
set backup
set backupdir=~/.vim-tmp,~/.tmp,~/tmp,/var/tmp,/tmp
set backupskip=/tmp/*,/private/tmp/*
set directory=~/.vim-tmp,~/.tmp,~/tmp,/var/tmp,/tmp
set writebackup

" Search
set ic                      " Ignore case when searching
" vs will search in the selected visual block
map vs <esc> :/\%V

" Alias the sudo write trick
cnoreabbrev sudowrite w !sudo tee % >/dev/null 

" Make tmux ctrl+arrows map to the proper thing (alias moving)
if &term =~ '^screen'
    " tmux will send xterm-style keys when its xterm-keys option is on
    execute "set <xUp>=\e[1;*A"
    execute "set <xDown>=\e[1;*B"
    execute "set <xRight>=\e[1;*C"
    execute "set <xLeft>=\e[1;*D"
endif

" map to open nerdtree
map <Leader>n <plug>NERDTreeTabsToggle<CR>

" Don't fold markdown
let g:vim_markdown_folding_disabled=1

" Filetypes
"au BufNewFile,BufRead *.tt set filetype=html