# Drax editor support

Editor plugins for the [Drax](https://github.com/drax-lang/drax) language (`.dx` files).

```
drax-ls/
  server/   language server (Node, LSP over stdio)
  vscode/   VS Code extension (grammar, snippets, icon, LSP client)
  vim/      Vim/Neovim runtime files (syntax, indent, ftplugin) + LSP setup
```

## Language server

Features: diagnostics (lexer errors, unbalanced `do`/`end`, brackets, missing `do`, duplicate
parameters), go to definition (functions, variables, parameters, `import('...')` paths and
`mod.key` across imported files), hover (signature + `#` doc comments, builtins), completion
(keywords, builtins, `List.`/`Frame.`/... members, imported module keys, snippets), references,
rename (same file), document symbols and workspace symbols.

It is a lightweight analyser (no type inference): the tokenizer mirrors `drax/src/dlex.c`.
Builtins are generated from the C sources: `cd server && npm run gen`.

```
cd server && npm install && npm test
```

## VS Code (`vscode/`)

Install from the [Marketplace](https://marketplace.visualstudio.com/items?itemName=drax-lang.drax-lang):

```
code --install-extension drax-lang.drax-lang
```

To build it from source:

```
cd vscode && npm install && npm run package
code --install-extension drax-lang-0.1.0.vsix --force
```

The language server is bundled in the extension (`drax.languageServer.enabled` turns it off).

## Vim / Neovim (`vim/`)

Syntax, indent and filetype work with any plugin manager:

- vim-plug: `Plug 'drax-lang/drax-ls', { 'rtp': 'vim' }`
- native packages: `ln -s "$PWD/vim" ~/.vim/pack/drax/start/drax`
  (Neovim: `~/.local/share/nvim/site/pack/drax/start/drax`)

Language server (needs `node` and `cd server && npm install`):

- **Neovim:** `require('drax.lsp').setup()` in `init.lua`. Ctrl-] / `gd` via `vim.lsp.buf.definition()`, `K` for hover.
- **Vim 9:** install [yegappan/lsp](https://github.com/yegappan/lsp); `plugin/drax_lsp.vim` registers the server.
  Use `:LspGotoDefinition`, `:LspHover`.
