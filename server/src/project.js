"use strict";
// Cross-file knowledge: open documents, import resolution and frame shapes.

const fs = require("fs");
const path = require("path");
const { fileURLToPath, pathToFileURL } = require("url");
const { analyze } = require("./analyzer");

const SKIP_DIRS = new Set(["node_modules", ".git", ".hg", ".svn", "dist", "build"]);
const MAX_FILES = 5000;

class Project {
  constructor() {
    this.open = new Map(); // uri -> { text, version }
    this.cache = new Map(); // uri -> { key, analysis }
    this.roots = []; // absolute directories
  }

  setRoots(roots) { this.roots = roots; }

  setOpen(uri, text, version) { this.open.set(uri, { text, version }); }
  closeOpen(uri) { this.open.delete(uri); }

  analysisFor(uri) {
    const o = this.open.get(uri);
    if (o) {
      const key = "v" + o.version + ":" + o.text.length;
      const c = this.cache.get(uri);
      if (c && c.key === key) return c.analysis;
      const analysis = analyze(o.text);
      this.cache.set(uri, { key, analysis });
      return analysis;
    }
    let file;
    try { file = fileURLToPath(uri); } catch { return null; }
    let st;
    try { st = fs.statSync(file); } catch { return null; }
    const key = "m" + st.mtimeMs + ":" + st.size;
    const c = this.cache.get(uri);
    if (c && c.key === key) return c.analysis;
    let text;
    try { text = fs.readFileSync(file, "utf8"); } catch { return null; }
    const analysis = analyze(text);
    this.cache.set(uri, { key, analysis });
    return analysis;
  }

  /** Resolve an import('spec') made from fromUri to a file URI (see docs/imports.md). */
  resolveImport(spec, fromUri) {
    let fromDir;
    try { fromDir = path.dirname(fileURLToPath(fromUri)); } catch { return null; }

    const bases = [];
    if (spec.startsWith("./") || spec.startsWith("../")) {
      bases.push(path.resolve(fromDir, spec));
    } else if (path.isAbsolute(spec)) {
      bases.push(spec);
    } else {
      for (let d = fromDir; ; d = path.dirname(d)) {
        bases.push(path.join(d, "lib", spec));
        if (path.dirname(d) === d) break;
      }
      for (const r of this.roots) bases.push(path.join(r, "lib", spec));
    }

    for (const b of bases) {
      for (const cand of [b, b + ".dx", path.join(b, "main.dx")]) {
        try {
          if (fs.statSync(cand).isFile()) return pathToFileURL(cand).toString();
        } catch { /* try next */ }
      }
    }
    return null;
  }

  listWorkspaceFiles() {
    const out = [];
    const walk = (dir) => {
      if (out.length >= MAX_FILES) return;
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (e.isDirectory()) {
          if (!SKIP_DIRS.has(e.name) && !e.name.startsWith(".")) walk(path.join(dir, e.name));
        } else if (e.name.endsWith(".dx")) {
          out.push(pathToFileURL(path.join(dir, e.name)).toString());
        }
      }
    };
    for (const r of this.roots) walk(r);
    for (const uri of this.open.keys()) if (!out.includes(uri)) out.push(uri);
    return out;
  }

  /** Frame shape produced by a symbol: a literal frame or an imported module's exports. */
  shapeOfSymbol(sym, ctx) {
    if (!sym) return null;
    if (sym.frameShape) return { shape: sym.frameShape, ctx };
    if (sym.importPath) {
      const target = this.resolveImport(sym.importPath, ctx.uri);
      if (!target) return null;
      const a = this.analysisFor(target);
      if (a && a.exportShape) return { shape: a.exportShape, ctx: { uri: target, analysis: a } };
    }
    return null;
  }

  /** Resolve a chain such as a.b.c (array of tokens). Returns the final entry and its context. */
  resolveChain(ctx, chain) {
    const base = chain[0];
    const a = ctx.analysis;
    const sym = a.resolve(base.text, a.scopeAt(base.start), base.start);
    let cur = this.shapeOfSymbol(sym, ctx);
    let entry = null;
    for (let k = 1; k < chain.length; k++) {
      if (!cur) return null;
      entry = cur.shape.get(chain[k].text);
      if (!entry) return null;
      if (k < chain.length - 1) {
        if (entry.nested) cur = { shape: entry.nested, ctx: cur.ctx };
        else if (entry.valueRef) {
          const ca = cur.ctx.analysis;
          const vs = ca.resolve(entry.valueRef.name, ca.globalScope, entry.valueRef.start);
          cur = this.shapeOfSymbol(vs, cur.ctx);
        } else return null;
      } else {
        let target = { start: entry.start, end: entry.end, sym: null };
        if (entry.valueRef) {
          const ca = cur.ctx.analysis;
          const vs = ca.resolve(entry.valueRef.name, ca.scopeAt(entry.valueRef.start), entry.valueRef.start);
          if (vs) target = { start: vs.start, end: vs.end, sym: vs };
        }
        return { uri: cur.ctx.uri, analysis: cur.ctx.analysis, entry, ...target };
      }
    }
    return null;
  }

  /** Shape reachable from a chain (for completion after `chain.`). */
  shapeOfChain(ctx, chain) {
    const a = ctx.analysis;
    const base = chain[0];
    const sym = a.resolve(base.text, a.scopeAt(base.start), base.start);
    let cur = this.shapeOfSymbol(sym, ctx);
    for (let k = 1; k < chain.length && cur; k++) {
      const entry = cur.shape.get(chain[k].text);
      if (!entry) return null;
      if (entry.nested) cur = { shape: entry.nested, ctx: cur.ctx };
      else if (entry.valueRef) {
        const ca = cur.ctx.analysis;
        const vs = ca.resolve(entry.valueRef.name, ca.globalScope, entry.valueRef.start);
        cur = this.shapeOfSymbol(vs, cur.ctx);
      } else return null;
    }
    return cur;
  }
}

module.exports = { Project };
