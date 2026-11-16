if exists('b:did_indent') | finish | endif
let b:did_indent = 1

setlocal indentexpr=DraxIndent()
setlocal indentkeys=o,O,0=end,0=else,0},0],0)

if exists('*DraxIndent') | finish | endif

function! DraxIndent() abort
  let lnum = prevnonblank(v:lnum - 1)
  if lnum == 0 | return 0 | endif

  let prev = substitute(getline(lnum), '\s*#.*$', '', '')
  let curr = getline(v:lnum)
  let ind = indent(lnum)

  if prev =~# '\<do\s*$' || prev =~# '^\s*else\s*$' || prev =~# '[\[{(]\s*$'
    let ind += shiftwidth()
  endif

  if curr =~# '^\s*\(end\|else\)\>' || curr =~# '^\s*[\]})]'
    let ind -= shiftwidth()
  endif

  return ind < 0 ? 0 : ind
endfunction
