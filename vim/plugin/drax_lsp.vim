" Vim 8/9 with yegappan/lsp: registers the Drax language server when the plugin is loaded.
" (Neovim users: use require('drax.lsp').setup() instead.)
if has('nvim') || exists('g:loaded_drax_lsp') | finish | endif
let g:loaded_drax_lsp = 1

let s:server = expand('<sfile>:p:h:h:h') . '/server/bin/drax-language-server'

if exists('*LspAddServer')
  call LspAddServer([#{
        \ name: 'drax',
        \ filetype: ['drax'],
        \ path: s:server,
        \ args: ['--stdio'],
        \ }])
endif
