"use strict";
// Lightweight, error tolerant analysis of a Drax source file: scopes, symbols,
// references, frame shapes (for `mod.key` navigation) and diagnostics.
// Everything is expressed in character offsets; the server converts to LSP positions.

const { lex } = require("./lexer");

const OPEN = new Set(["(", "[", "{"]);
const CLOSE = { ")": "(", "]": "[", "}": "{" };

const isOp = (t, s) => !!t && t.type === "op" && t.text === s;
const isKw = (t, s) => !!t && t.type === "kw" && t.text === s;

function unquote(text) {
  if (text.startsWith('"""')) return text.slice(3, -3);
  return text.slice(1, -1);
}

class Scope {
  constructor(parent, start) {
    this.parent = parent;
    this.start = start;
    this.end = Infinity;
    this.symbols = new Map();
    this.owner = null; // function symbol that owns this scope
    this.children = [];
  }
  add(sym) {
    if (!this.symbols.has(sym.name)) this.symbols.set(sym.name, []);
    this.symbols.get(sym.name).push(sym);
  }
}

class Analysis {
  constructor(text) {
    this.text = text;
    const { tokens, comments } = lex(text);
    this.tokens = tokens;
    this.comments = comments;
    this.diagnostics = [];
    this.symbols = [];
    this.refs = [];
    this.imports = []; // import('literal') occurrences
    this.exportShape = null; // Map of keys passed to export({...})
    this.lineStarts = [0];
    for (let i = 0; i < text.length; i++) if (text[i] === "\n") this.lineStarts.push(i + 1);
    this.globalScope = new Scope(null, 0);
    this.scopes = [this.globalScope];
    this._run();
    this._resolveAll();
  }

  // ---------- helpers ----------
  lineOf(offset) {
    let lo = 0, hi = this.lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.lineStarts[mid] <= offset) lo = mid; else hi = mid - 1;
    }
    return lo;
  }

  diag(tok, message, severity = 1) {
    this.diagnostics.push({ start: tok.start, end: tok.end, message, severity });
  }

  tokenIndexAt(offset) {
    const t = this.tokens;
    let lo = 0, hi = t.length - 1, found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (t[mid].start <= offset) { found = mid; lo = mid + 1; } else hi = mid - 1;
    }
    if (found >= 0 && offset <= t[found].end) return found;
    return -1;
  }

  scopeAt(offset) {
    let best = this.globalScope;
    for (const s of this.scopes) {
      if (s.start <= offset && offset <= s.end && s.start >= best.start) best = s;
    }
    return best;
  }

  docCommentFor(funTok) {
    const line = this.lineOf(funTok.start);
    const lines = [];
    let want = line - 1;
    for (let i = this.comments.length - 1; i >= 0; i--) {
      const c = this.comments[i];
      if (c.start >= funTok.start) continue;
      const cl = this.lineOf(c.start);
      if (cl === want && this.text.slice(this.lineStarts[cl], c.start).trim() === "") {
        lines.unshift(c.text.replace(/^#+\s?/, ""));
        want--;
      } else if (cl < want) break;
    }
    return lines.join("\n");
  }

  matchClose(idx) {
    let depth = 0;
    for (let i = idx; i < this.tokens.length; i++) {
      const t = this.tokens[i];
      if (t.type !== "op") continue;
      if (OPEN.has(t.text)) depth++;
      else if (CLOSE[t.text]) { depth--; if (depth === 0) return i; }
    }
    return -1;
  }

  frameShape(open) {
    const toks = this.tokens;
    const shape = new Map();
    let depth = 0;
    for (let i = open; i < toks.length; i++) {
      const t = toks[i];
      if (t.type === "op" && OPEN.has(t.text)) depth++;
      else if (t.type === "op" && CLOSE[t.text]) { depth--; if (depth === 0) break; }
      else if (
        depth === 1 && (t.type === "id" || t.type === "str") && isOp(toks[i + 1], ":") &&
        (isOp(toks[i - 1], "{") || isOp(toks[i - 1], ","))
      ) {
        const name = t.type === "str" ? unquote(t.text) : t.text;
        const entry = { name, start: t.start, end: t.end, valueRef: null, nested: null };
        const v = toks[i + 2];
        if (isOp(v, "{")) entry.nested = this.frameShape(i + 2);
        else if (v && v.type === "id") {
          const after = toks[i + 3];
          if (!after || isOp(after, ",") || isOp(after, "}")) {
            entry.valueRef = { name: v.text, start: v.start, end: v.end };
          }
        }
        shape.set(name, entry);
      }
    }
    return shape;
  }

  countArgs(openIdx) {
    const toks = this.tokens;
    const close = this.matchClose(openIdx);
    if (close === openIdx + 1) return 0;
    let depth = 0, n = 1;
    const end = close === -1 ? toks.length : close;
    for (let i = openIdx; i < end; i++) {
      const t = toks[i];
      if (t.type !== "op") continue;
      if (OPEN.has(t.text)) depth++;
      else if (CLOSE[t.text]) depth--;
      else if (t.text === "," && depth === 1) n++;
    }
    return n;
  }

  // ---------- main pass ----------
  _run() {
    const toks = this.tokens;
    const brackets = [];
    const blocks = [];
    const condClose = new Map(); // token index of `)` -> `if` block
    let scope = this.globalScope;

    const newSymbol = (props) => {
      const sym = Object.assign({ refs: [], scope: null }, props);
      this.symbols.push(sym);
      return sym;
    };

    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];

      const top = blocks[blocks.length - 1];
      if (top && top.awaitDo) {
        top.awaitDo = false;
        if (isKw(t, "do")) continue;
        if (top.needsDo) {
          this.diag(t, top.kind === "if" ? "Expect 'do' after condition." : "Expect 'do' before function body.");
        }
      }

      if (t.type === "error") {
        this.diagnostics.push({ start: t.start, end: t.end, message: t.message, severity: 1 });
        continue;
      }

      if (t.type === "op") {
        if (OPEN.has(t.text)) { brackets.push(t); continue; }
        if (CLOSE[t.text]) {
          const o = brackets.pop();
          if (!o) this.diag(t, `Unmatched '${t.text}'.`);
          else if (o.text !== CLOSE[t.text]) this.diag(t, `'${t.text}' does not match '${o.text}'.`);
          if (condClose.has(i)) {
            const b = condClose.get(i);
            b.awaitDo = true;
            b.needsDo = true;
          }
        }
        continue;
      }

      if (t.type === "kw") {
        switch (t.text) {
          case "fun": {
            const nx = toks[i + 1];
            let named = false;
            let sym = null;
            let j = i + 1;
            if (nx && nx.type === "id") {
              named = true;
              j = i + 2;
              sym = newSymbol({
                name: nx.text, kind: "function", start: nx.start, end: nx.end,
                params: [], arity: 0, fullStart: t.start, fullEnd: t.end,
                doc: this.docCommentFor(t), scope,
              });
              scope.add(sym);
            } else if (!isOp(nx, "(")) {
              this.diag(t, "Expect function name or '(' after 'fun'.");
            }
            const inner = new Scope(scope, t.start);
            this.scopes.push(inner);
            scope.children.push(inner);
            inner.owner = sym;
            const params = [];
            if (isOp(toks[j], "(")) {
              j++;
              while (j < toks.length && !isOp(toks[j], ")")) {
                const p = toks[j];
                if (p.type === "id") {
                  if (params.some((q) => q.name === p.text)) this.diag(p, "duplicate argument in function definition");
                  const ps = newSymbol({ name: p.text, kind: "parameter", start: p.start, end: p.end, scope: inner });
                  inner.add(ps);
                  params.push(ps);
                  j++;
                  if (isOp(toks[j], ",")) j++;
                } else {
                  this.diag(p, "Expect parameter name.");
                  break;
                }
              }
              if (isOp(toks[j], ")")) {
                // the `)` is consumed here, keep the bracket stack balanced
              } else {
                this.diag(t, "Expect ')' after parameters.");
              }
            } else {
              this.diag(nx || t, "Expect '(' before parameters.");
              j--;
            }
            if (sym) { sym.params = params.map((p) => p.name); sym.arity = params.length; sym.innerScope = inner; }
            blocks.push({ kind: "fun", tok: t, scope: inner, awaitDo: true, needsDo: named, sym });
            scope = inner;
            i = Math.min(j, toks.length - 1);
            break;
          }
          case "if": {
            const b = { kind: "if", tok: t, awaitDo: false, needsDo: false };
            blocks.push(b);
            if (isOp(toks[i + 1], "(")) {
              const c = this.matchClose(i + 1);
              if (c !== -1) condClose.set(c, b);
            } else {
              this.diag(t, "Expect '(' after 'if'.");
            }
            break;
          }
          case "else": {
            const b = blocks[blocks.length - 1];
            if (!b || b.kind !== "if") this.diag(t, "Unexpected 'else'.");
            break;
          }
          case "do":
            blocks.push({ kind: "do", tok: t });
            break;
          case "end": {
            const b = blocks.pop();
            if (!b) { this.diag(t, "Unexpected 'end'."); break; }
            if (b.kind === "fun") {
              b.scope.end = t.end;
              if (b.sym) b.sym.fullEnd = t.end;
              scope = b.scope.parent;
            }
            break;
          }
          case "import": {
            if (isOp(toks[i + 1], "(") && toks[i + 2] && toks[i + 2].type === "str" && isOp(toks[i + 3], ")")) {
              const s = toks[i + 2];
              this.imports.push({ path: unquote(s.text), start: s.start, end: s.end });
            }
            break;
          }
          case "export": {
            if (isOp(toks[i + 1], "(") && isOp(toks[i + 2], "{")) this.exportShape = this.frameShape(i + 2);
            break;
          }
          default:
            break;
        }
        continue;
      }

      if (t.type === "id") {
        const prev = toks[i - 1];
        const next = toks[i + 1];
        if (isOp(prev, ".")) continue; // property access

        const inFrame = brackets.length && brackets[brackets.length - 1].text === "{";
        if (isOp(next, ":") && inFrame && (isOp(prev, "{") || isOp(prev, ","))) continue; // frame key

        if (isOp(next, "=")) {
          const existing = (scope.symbols.get(t.text) || []).find((s) => s.kind !== "function");
          if (existing) {
            const r = { name: t.text, start: t.start, end: t.end, scope, sym: existing, write: true };
            this.refs.push(r);
            existing.refs.push(r);
          } else {
            const sym = newSymbol({ name: t.text, kind: "variable", start: t.start, end: t.end, scope });
            const r = toks[i + 2];
            if (isKw(r, "import") && isOp(toks[i + 3], "(") && toks[i + 4] && toks[i + 4].type === "str") {
              sym.importPath = unquote(toks[i + 4].text);
            } else if (isOp(r, "{")) {
              sym.frameShape = this.frameShape(i + 2);
            }
            scope.add(sym);
          }
          continue;
        }

        const ref = { name: t.text, start: t.start, end: t.end, scope, sym: null };
        if (isOp(next, "(")) ref.argc = this.countArgs(i + 1);
        this.refs.push(ref);
      }
    }

    for (const b of blocks) this.diag(b.tok, `Expect 'end' to close this '${b.tok.text}'.`);
    for (const b of brackets) this.diag(b, `Unclosed '${b.text}'.`);
    for (const s of this.scopes) if (s.end === Infinity) s.end = this.text.length;
  }

  // ---------- resolution ----------
  resolve(name, scope, offset, argc) {
    for (let s = scope; s; s = s.parent) {
      const cands = s.symbols.get(name);
      if (!cands) continue;
      const funs = cands.filter((c) => c.kind === "function");
      const vars = cands.filter((c) => c.kind !== "function");
      const pickVar = () => {
        if (!vars.length) return null;
        let best = null;
        for (const v of vars) if (v.start <= offset) best = v;
        return best || vars[0];
      };
      if (argc !== undefined) {
        const exact = funs.find((f) => f.arity === argc);
        if (exact) return exact;
        return pickVar() || funs[0] || null;
      }
      return pickVar() || funs[0] || null;
    }
    return null;
  }

  _resolveAll() {
    for (const r of this.refs) {
      if (r.sym) continue;
      const sym = this.resolve(r.name, r.scope, r.start, r.argc);
      if (sym) { r.sym = sym; sym.refs.push(r); }
    }
  }

  // ---------- queries ----------
  /** Symbol (definition or reference) under the offset. */
  symbolAt(offset) {
    for (const s of this.symbols) if (s.start <= offset && offset <= s.end) return s;
    for (const r of this.refs) if (r.start <= offset && offset <= r.end) return r.sym;
    return null;
  }

  /** Is the identifier token at idx a property (`a.idx`)? Returns the chain of names. */
  chainAt(idx) {
    const toks = this.tokens;
    const names = [toks[idx]];
    let i = idx;
    while (isOp(toks[i - 1], ".") && toks[i - 2] && toks[i - 2].type === "id") {
      names.unshift(toks[i - 2]);
      i -= 2;
    }
    return names.length > 1 ? names : null;
  }

  /** Visible symbols (name -> symbol) at the offset. */
  visibleAt(offset) {
    const out = new Map();
    for (let s = this.scopeAt(offset); s; s = s.parent) {
      for (const [name, list] of s.symbols) {
        if (!out.has(name)) out.set(name, list[list.length - 1]);
      }
    }
    return out;
  }
}

function analyze(text) {
  return new Analysis(text);
}

module.exports = { analyze, Analysis };
