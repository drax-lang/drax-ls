if exists('b:current_syntax') | finish | endif

syn iskeyword @,48-57,_,?

syn keyword draxKeyword    if else do end return
syn keyword draxFun        fun nextgroup=draxFunName skipwhite
syn keyword draxImport     import export as
syn keyword draxOperatorKw and or
syn keyword draxConstant   true false nil
syn keyword draxBuiltin    assert typeof sleep read print inspect help

syn match draxFunName      '\<[a-zA-Z_][a-zA-Z0-9_]*?\=' contained
syn match draxModule       '\<[A-Z][A-Za-z0-9_]*\>'
syn match draxModuleFn     '\.\@<=[a-zA-Z_][a-zA-Z0-9_]*?\=\ze\s*('
syn match draxFrameKey     '\<[a-zA-Z_][a-zA-Z0-9_]*?\=\ze\s*:\(:\)\@!'

syn match draxNumber       '\<[0-9]\+\(\.[0-9]\+\)\=\>'
syn match draxNumber       '\<0x[0-9a-fA-F]\+\>'
syn match draxNumber       '\<0b[01]\+\>'
syn match draxNumber       '\<0o[0-7]\+\>'

syn match draxOperator     '|>\|++\|==\|!=\|<=\|>=\|<<\|>>\|::\|[-+*/&<>=!]'

syn match draxEscape       '\\.' contained
syn region draxString      start=+'+ skip=+\\.+ end=+'+ contains=draxEscape
syn region draxString      start=+"+ skip=+\\.+ end=+"+ contains=draxEscape
syn region draxString      start=+"""+ end=+"""+ contains=draxEscape

syn keyword draxTodo       TODO FIXME XXX NOTE contained
syn match   draxComment    '#.*$' contains=draxTodo,@Spell

hi def link draxKeyword    Keyword
hi def link draxFun        Keyword
hi def link draxImport     Include
hi def link draxOperatorKw Operator
hi def link draxConstant   Constant
hi def link draxBuiltin    Function
hi def link draxFunName    Function
hi def link draxModule     Type
hi def link draxModuleFn   Function
hi def link draxFrameKey   Identifier
hi def link draxNumber     Number
hi def link draxOperator   Operator
hi def link draxEscape     SpecialChar
hi def link draxString     String
hi def link draxTodo       Todo
hi def link draxComment    Comment

let b:current_syntax = 'drax'
