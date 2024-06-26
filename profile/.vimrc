"""""
" Control variables to put in .bashrc
" SKIP_VIM_PLUGINS=1 will skip the installation+usage of the vim plugins
" CTRLP_USE_AG=1 will use ag in Ctrl-P instead of the slow vimscript searcher

" leader
:let mapleader = ","
":let mapleader = " "

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

  Plugin 'https://github.com/kien/ctrlp.vim'
  Plugin 'https://github.com/tmhedberg/matchit'
  Plugin 'https://github.com/scrooloose/nerdtree'
  Plugin 'https://github.com/jistr/vim-nerdtree-tabs'
  Plugin 'fatih/vim-go'
  " markdown
  Plugin 'godlygeek/tabular'
  Plugin 'plasticboy/vim-markdown'

  Plugin 'mustache/vim-mustache-handlebars'

  Plugin 'Yggdroot/indentLine'

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

" Fix for YAML indentation comment/uncomment
autocmd FileType yaml,yaml.ansible setlocal indentkeys-=0#

" Visual indentation
let g:indentLine_enabled = 1 
let g:indentLine_setConceal = 2
let g:vim_json_conceal=0
let g:markdown_syntax_conceal=0
let g:vim_markdown_conceal_code_blocks = 0

"""""""""""""""""
" Key bindings

" Tab navigation
nnoremap <Leader>k :tabp <Enter>    " Make ,k go to the previous tab
nnoremap <Leader>l :tabn <Enter>    " Make ,l go to the next tab

" Paste mode
nnoremap <Leader>p :set paste <Enter>
nnoremap <Leader>np :set nopaste <Enter>

" Buffers
nnoremap <Leader>b :b# <Enter>
nnoremap <Leader>v :buffers <Enter>

" Autocomplete
inoremap <Leader>, <C-x><C-o><C-r>=pumvisible() ? "\<lt>Down>\<lt>C-p>\<lt>Down>" : ""<CR>
inoremap <Leader>; <C-n><C-r>=pumvisible() ? "\<lt>Down>\<lt>C-p>\<lt>Down>" : ""<CR>
inoremap <Leader>: <C-x><C-f><C-r>=pumvisible() ? "\<lt>Down>\<lt>C-p>\<lt>Down>" : ""<CR>
inoremap <Leader>= <C-x><C-l><C-r>=pumvisible() ? "\<lt>Down>\<lt>C-p>\<lt>Down>" : ""<CR>

" Relative line number
nnoremap <Leader>nn :set number! \| set relativenumber! \| IndentLinesToggle <CR>

" Spell check
nnoremap <Leader>sc :set spell spelllang=en_us <Enter>

"""""""""
" CtrlP
"
" Use ag for file indexing
let ctrlp_use_ag=$CTRLP_USE_AG
if ctrlp_use_ag == '1'
  let g:ctrlp_user_command = 'ag %s -l --nocolor -g ""'
endif

" no limit for files
let g:ctrlp_max_files=0

"""""""""
" Other 
"

" Allow local directories to set their own .vimrc
set exrc

" Enable relative line numbers by default
set relativenumber
set rnu
set nu rnu

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


" Don't fold markdown
let g:vim_markdown_folding_disabled=1

" Filetypes
"au BufNewFile,BufRead *.tt set filetype=html

" Nicer completion
set wildmode=longest,list,full
set wildmenu

" ignores
set wildignore+=*/node_modules,*/log,*/logs,*/.git

" golang/vim-go configuration
let g:go_fmt_command = "goimports"
let g:go_highlight_functions = 1
let g:go_highlight_methods = 1
let g:go_highlight_fields = 1
let g:go_highlight_types = 1
let g:go_highlight_operators = 1
let g:go_highlight_build_constraints = 1
let g:go_highlight_trailing_whitespace_error = 0
let g:go_version_warning = 0

autocmd FileType go nmap <C-d> <Plug>(go-decls-dir)

" map Ctrl-A and Ctrl-E to beginning and end of line
map <C-a> <ESC>^
imap <C-a> <ESC>I
map <C-e> <ESC>$
imap <C-e> <ESC>A

" map these sequences to move by one word
map <Esc>b <ESC>b
map <Esc>f <ESC>w

" no mouse
set mouse=
set ttymouse=

" ignore patterns for Ctrl-P
set wildignore+=*/tmp/*,*.so,*.swp,*.zip,*/venv/*

" Helper function used for auto-formatters
function! Preserve(command)
  " Save the last search.
  let search = @/

  " Save the current cursor position.
  let cursor_position = getpos('.')

  " Save the current window position.
  normal! H
  let window_position = getpos('.')
  call setpos('.', cursor_position)

  " Execute the command.
  execute a:command

  " Restore the last search.
  let @/ = search

  " Restore the previous window position.
  call setpos('.', window_position)
  normal! zt

  " Restore the previous cursor position.
  call setpos('.', cursor_position)
endfunction

" Example auto-formatting for YAML
" autocmd FileType yaml autocmd BufWritePre <buffer> call Preserve("%!yq")

" Use dark-background
set background=dark
