# Drax

Syntax highlighting, snippets and language support for [Drax](https://github.com/drax-lang/drax) (`.dx`).

## Syntax at a glance

```elixir
# a comment
name = 'drax'                     # strings: 'a', "a" or """a"""
list = [1, 2, 3]
frame = { key: 'value', n: 10 }   # frames (maps)
text = 'hello ' ++ name           # ++ joins strings and lists
```

### Functions

```elixir
fun add(a, b) do                  # named, the arity is part of the name:
    a + b                         # add/1 and add/2 can coexist
end

double = fun (x) x * 2 end        # anonymous

fun sum_to(n, acc) do             # a call in tail position reuses the frame
    if (n == 0) do
        acc
    else
        sum_to(n - 1, acc + n)
    end
end
```

### Pipe

```elixir
3 |> add(4) |> double()           # add(3, 4), then double(7)
```

### Modules

```elixir
lib = import('./lib.dx')          # in lib.dx: export({ add: add })
lib.add(1, 2)
List.length([1, 2, 3])            # builtin modules: List, String, Number, Math, Frame, Os, ...
```

### Errors

There is no `try`/`catch`: a failure is a value, an `Error`, and you choose where to handle it.

```elixir
fun parse(s) do
    if (String.length(s) == 0) do
        return Error('empty input')   # an expected failure is returned
    end
    s
end

r = parse('')
Error.is(r)                       # true
Error.message(r)                  # 'empty input'
Error.or_else(r, 'default')       # 'default' when r is an Error

r = div?(1, 'a')                  # f?(...): protected call, a runtime error
                                  # inside the call becomes an Error
'ok' |?> String.length()          # |?>: safe pipe, stops at the first Error
parse('') |?> String.length()     # the call is skipped and the Error goes on
```

| Syntax | Meaning |
|---|---|
| `Error(payload)` | an error value, the payload can be any value |
| `Error.is(x)` `Error.payload(x)` `Error.message(x)` `Error.or_else(x, d)` | work with an error |
| `f?(args)` | protected call (`?` is not allowed in names) |
| `a \|?> f()` | safe pipe: skips `f` when `a` is an `Error` |

## Features

- Syntax highlighting for `.dx` (including `|>`, `|?>` and `f?()`) and `.dgraph`.
- Snippets: `fun`, `lam`, `if`, `ife`, `imp`, `exp`, `prot` (protected call), `pipes` (safe pipe).
- Language server: diagnostics, go to definition, hover, completion, references, rename and symbols.
  Turn it off with `drax.languageServer.enabled`.
