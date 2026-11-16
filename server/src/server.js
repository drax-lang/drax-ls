"use strict";
// Drax language server (LSP over stdio / node-ipc).

const {
  createConnection, ProposedFeatures, TextDocuments, TextDocumentSyncKind,
  CompletionItemKind, SymbolKind, DiagnosticSeverity, MarkupKind, InsertTextFormat,
} = require("vscode-languageserver/node");
const { TextDocument } = require("vscode-languageserver-textdocument");
const { fileURLToPath } = require("url");
const { Project } = require("./project");
const { GLOBALS, MODULES } = require("./builtins");
const { KEYWORDS } = require("./lexer");

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);
const project = new Project();

const isOp = (t, s) => !!t && t.type === "op" && t.text === s;

// ---------- conversions ----------
const toPos = (a, off) => {
  const line = a.lineOf(off);
  return { line, character: off - a.lineStarts[line] };
};
const toRange = (a, s, e) => ({ start: toPos(a, s), end: toPos(a, e) });
const loc = (uri, a, s, e) => ({ uri, range: toRange(a, s, e) });

function ctxOf(uri) {
  const analysis = project.analysisFor(uri);
  return analysis ? { uri, analysis } : null;
}

// ---------- docs ----------
function sig(sym) {
  if (sym.kind === "function") return `fun ${sym.name}(${sym.params.join(", ")})`;
  if (sym.kind === "parameter") return `${sym.name}  (parameter)`;
  if (sym.importPath) return `${sym.name} = import('${sym.importPath}')`;
  return sym.name;
}

function md(code, doc) {
  let value = "```drax\n" + code + "\n```";
  if (doc) value += "\n\n" + doc;
  return { kind: MarkupKind.Markdown, value };
}

function builtinSig(mod, name) {
  const arities = MODULES[mod][name];
  return arities.map((n) => `${mod}.${name}(${Array.from({ length: n }, (_, i) => "a" + (i + 1)).join(", ")})`).join("\n");
}

// ---------- diagnostics ----------
function validate(doc) {
  project.setOpen(doc.uri, doc.getText(), doc.version);
  const a = project.analysisFor(doc.uri);
  connection.sendDiagnostics({
    uri: doc.uri,
    diagnostics: a.diagnostics.map((d) => ({
      range: toRange(a, d.start, d.end),
      message: d.message,
      severity: d.severity === 1 ? DiagnosticSeverity.Error : DiagnosticSeverity.Warning,
      source: "drax",
    })),
  });
}

documents.onDidChangeContent((e) => validate(e.document));
documents.onDidClose((e) => {
  project.closeOpen(e.document.uri);
  connection.sendDiagnostics({ uri: e.document.uri, diagnostics: [] });
});

// ---------- lifecycle ----------
connection.onInitialize((params) => {
  const roots = [];
  for (const f of params.workspaceFolders || []) {
    try { roots.push(fileURLToPath(f.uri)); } catch { /* ignore */ }
  }
  if (!roots.length && params.rootUri) {
    try { roots.push(fileURLToPath(params.rootUri)); } catch { /* ignore */ }
  }
  project.setRoots(roots);
  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      definitionProvider: true,
      hoverProvider: true,
      referencesProvider: true,
      renameProvider: { prepareProvider: true },
      documentSymbolProvider: true,
      workspaceSymbolProvider: true,
      completionProvider: { triggerCharacters: ["."] },
    },
  };
});

// ---------- definition ----------
function definitionAt(uri, offset) {
  const ctx = ctxOf(uri);
  if (!ctx) return null;
  const a = ctx.analysis;

  for (const imp of a.imports) {
    if (imp.start <= offset && offset <= imp.end) {
      const target = project.resolveImport(imp.path, uri);
      if (!target) return null;
      const ta = project.analysisFor(target);
      return ta ? loc(target, ta, 0, 0) : null;
    }
  }

  const idx = a.tokenIndexAt(offset);
  const tok = idx >= 0 ? a.tokens[idx] : null;
  if (!tok || tok.type !== "id") return null;

  const chain = a.chainAt(idx);
  if (chain) {
    const r = project.resolveChain(ctx, chain);
    return r ? loc(r.uri, r.analysis, r.start, r.end) : null;
  }

  const sym = a.symbolAt(offset);
  return sym ? loc(uri, a, sym.start, sym.end) : null;
}

connection.onDefinition((p) => {
  const doc = documents.get(p.textDocument.uri);
  if (!doc) return null;
  return definitionAt(p.textDocument.uri, doc.offsetAt(p.position));
});

// ---------- hover ----------
connection.onHover((p) => {
  const uri = p.textDocument.uri;
  const doc = documents.get(uri);
  const ctx = ctxOf(uri);
  if (!doc || !ctx) return null;
  const a = ctx.analysis;
  const offset = doc.offsetAt(p.position);
  const idx = a.tokenIndexAt(offset);
  const tok = idx >= 0 ? a.tokens[idx] : null;
  if (!tok) return null;
  const range = toRange(a, tok.start, tok.end);

  if (tok.type === "kw") return null;
  if (tok.type !== "id") return null;

  const chain = a.chainAt(idx);
  if (chain) {
    const base = chain[0];
    if (chain.length === 2 && MODULES[base.text] && !a.resolve(base.text, a.scopeAt(base.start), base.start)) {
      if (MODULES[base.text][tok.text]) return { contents: md(builtinSig(base.text, tok.text)), range };
      return null;
    }
    const r = project.resolveChain(ctx, chain);
    if (r && r.sym) return { contents: md(sig(r.sym), r.sym.doc), range };
    if (r) return { contents: md(`${chain.map((c) => c.text).join(".")}`), range };
    return null;
  }

  const sym = a.symbolAt(offset);
  if (sym) return { contents: md(sig(sym), sym.doc), range };
  if (MODULES[tok.text]) {
    const names = Object.keys(MODULES[tok.text]);
    return { contents: md(`module ${tok.text}`, names.map((n) => "`" + n + "`").join(", ")), range };
  }
  if (GLOBALS[tok.text] !== undefined) {
    const n = GLOBALS[tok.text];
    return { contents: md(`${tok.text}(${Array.from({ length: n }, (_, i) => "a" + (i + 1)).join(", ")})`, "builtin"), range };
  }
  return null;
});

// ---------- references / rename ----------
function occurrences(a, sym) {
  const out = [{ start: sym.start, end: sym.end }];
  for (const r of sym.refs) out.push({ start: r.start, end: r.end });
  return out;
}

connection.onReferences((p) => {
  const uri = p.textDocument.uri;
  const doc = documents.get(uri);
  const ctx = ctxOf(uri);
  if (!doc || !ctx) return [];
  const sym = ctx.analysis.symbolAt(doc.offsetAt(p.position));
  if (!sym) return [];
  return occurrences(ctx.analysis, sym)
    .filter((o) => p.context.includeDeclaration || o.start !== sym.start)
    .map((o) => loc(uri, ctx.analysis, o.start, o.end));
});

connection.onPrepareRename((p) => {
  const uri = p.textDocument.uri;
  const doc = documents.get(uri);
  const ctx = ctxOf(uri);
  if (!doc || !ctx) return null;
  const a = ctx.analysis;
  const offset = doc.offsetAt(p.position);
  const sym = a.symbolAt(offset);
  if (!sym) return null;
  const idx = a.tokenIndexAt(offset);
  const t = a.tokens[idx];
  return toRange(a, t.start, t.end);
});

connection.onRenameRequest((p) => {
  const uri = p.textDocument.uri;
  const doc = documents.get(uri);
  const ctx = ctxOf(uri);
  if (!doc || !ctx) return null;
  if (!/^[A-Za-z_][A-Za-z0-9_]*\??$/.test(p.newName)) return null;
  const sym = ctx.analysis.symbolAt(doc.offsetAt(p.position));
  if (!sym) return null;
  return {
    changes: {
      [uri]: occurrences(ctx.analysis, sym).map((o) => ({
        range: toRange(ctx.analysis, o.start, o.end),
        newText: p.newName,
      })),
    },
  };
});

// ---------- symbols ----------
function buildSymbols(a, scope) {
  const out = [];
  const list = [];
  for (const syms of scope.symbols.values()) for (const s of syms) if (s.kind !== "parameter") list.push(s);
  list.sort((x, y) => x.start - y.start);
  for (const s of list) {
    if (s.kind === "function") {
      out.push({
        name: s.name,
        detail: `(${s.params.join(", ")})`,
        kind: SymbolKind.Function,
        range: toRange(a, s.fullStart, s.fullEnd),
        selectionRange: toRange(a, s.start, s.end),
        children: s.innerScope ? buildSymbols(a, s.innerScope) : [],
      });
    } else {
      out.push({
        name: s.name,
        detail: s.importPath ? `import('${s.importPath}')` : "",
        kind: s.importPath ? SymbolKind.Module : SymbolKind.Variable,
        range: toRange(a, s.start, s.end),
        selectionRange: toRange(a, s.start, s.end),
      });
    }
  }
  return out;
}

connection.onDocumentSymbol((p) => {
  const ctx = ctxOf(p.textDocument.uri);
  return ctx ? buildSymbols(ctx.analysis, ctx.analysis.globalScope) : [];
});

connection.onWorkspaceSymbol((p) => {
  const q = (p.query || "").toLowerCase();
  const out = [];
  for (const uri of project.listWorkspaceFiles()) {
    const a = project.analysisFor(uri);
    if (!a) continue;
    for (const syms of a.globalScope.symbols.values()) {
      for (const s of syms) {
        if (q && !s.name.toLowerCase().includes(q)) continue;
        out.push({
          name: s.name,
          kind: s.kind === "function" ? SymbolKind.Function : s.importPath ? SymbolKind.Module : SymbolKind.Variable,
          location: loc(uri, a, s.start, s.end),
        });
        if (out.length >= 500) return out;
      }
    }
  }
  return out;
});

// ---------- completion ----------
function symbolKind(s) {
  return s.kind === "function" ? CompletionItemKind.Function
    : s.kind === "parameter" ? CompletionItemKind.Variable
    : s.importPath ? CompletionItemKind.Module : CompletionItemKind.Variable;
}

connection.onCompletion((p) => {
  const uri = p.textDocument.uri;
  const doc = documents.get(uri);
  const ctx = ctxOf(uri);
  if (!doc || !ctx) return [];
  const a = ctx.analysis;
  const offset = doc.offsetAt(p.position);
  const idx = a.tokenIndexAt(offset);
  const tok = idx >= 0 ? a.tokens[idx] : null;

  // member completion: `base.` or `base.par|`
  let dotIdx = -1;
  if (tok && isOp(tok, ".")) dotIdx = idx;
  else if (tok && tok.type === "id" && isOp(a.tokens[idx - 1], ".")) dotIdx = idx - 1;
  if (dotIdx > 0 && a.tokens[dotIdx - 1].type === "id") {
    const chain = a.chainAt(dotIdx - 1) || [a.tokens[dotIdx - 1]];
    const base = chain[0];
    const userSym = a.resolve(base.text, a.scopeAt(base.start), base.start);
    if (chain.length === 1 && !userSym && MODULES[base.text]) {
      return Object.keys(MODULES[base.text]).map((n) => ({
        label: n, kind: CompletionItemKind.Function,
        detail: builtinSig(base.text, n).split("\n")[0],
      }));
    }
    const cur = project.shapeOfChain(ctx, chain);
    if (!cur) return [];
    return [...cur.shape.values()].map((e) => ({
      label: e.name,
      kind: e.valueRef ? CompletionItemKind.Function : CompletionItemKind.Field,
      detail: e.valueRef ? e.valueRef.name : undefined,
    }));
  }

  const items = [];
  const snippet = (label, text, detail) => ({
    label, kind: CompletionItemKind.Snippet, detail,
    insertText: text, insertTextFormat: InsertTextFormat.Snippet,
  });
  items.push(snippet("fun", "fun ${1:name}(${2}) do\n\t$0\nend", "named function"));
  items.push(snippet("if", "if (${1:cond}) do\n\t$0\nend", "if block"));
  for (const k of KEYWORDS) if (k !== "fun" && k !== "if") items.push({ label: k, kind: CompletionItemKind.Keyword });
  for (const [n, ar] of Object.entries(GLOBALS)) {
    items.push({ label: n, kind: CompletionItemKind.Function, detail: `${n}/${ar} (builtin)` });
  }
  for (const m of Object.keys(MODULES)) items.push({ label: m, kind: CompletionItemKind.Module });
  for (const [name, s] of a.visibleAt(offset)) {
    items.push({ label: name, kind: symbolKind(s), detail: sig(s) });
  }
  return items;
});

documents.listen(connection);
connection.listen();
