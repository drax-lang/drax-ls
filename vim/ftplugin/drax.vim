if exists('b:did_ftplugin') | finish | endif
let b:did_ftplugin = 1

setlocal commentstring=#\ %s
setlocal comments=:#
setlocal formatoptions-=t formatoptions+=croql
setlocal iskeyword+=?
setlocal expandtab shiftwidth=2 softtabstop=2 tabstop=2
setlocal suffixesadd=.dx
setlocal includeexpr=substitute(v:fname,'^\\./','','')

if exists('loaded_matchit')
  let b:match_words = '\<do\>:\<else\>:\<end\>'
  let b:match_ignorecase = 0
endif

let b:undo_ftplugin = 'setlocal commentstring< comments< formatoptions< iskeyword< expandtab< shiftwidth< softtabstop< tabstop< suffixesadd< includeexpr< | unlet! b:match_words b:match_ignorecase'
