"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { analyze } = require("../src/analyzer");
const { Project } = require("../src/project");

const DRAX = path.resolve(__dirname, "../../../drax/tests/drax");
const msgs = (a) => a.diagnostics.map((d) => d.message);

test("balanced code has no diagnostics", () => {
  const a = analyze(`fun f(a, b) do
  if (a > b) do a else b end
end
g = fun (x) x + 1 end
f(1, 2)
`);
  assert.deepStrictEqual(msgs(a), []);
});

test("diagnostics: missing end, stray end, missing do, bad if", () => {
  assert.match(msgs(analyze("fun f() do\n 1\n"))[0], /Expect 'end'/);
  assert.match(msgs(analyze("end"))[0], /Unexpected 'end'/);
  assert.match(msgs(analyze("fun f()\n 1\nend"))[0], /Expect 'do' before function body/);
  assert.match(msgs(analyze("if x do 1 end"))[0], /Expect '\('/);
  assert.match(msgs(analyze("x = 'abc"))[0], /Unterminated string/);
  assert.match(msgs(analyze("f(1, 2"))[0], /Unclosed '\('/);
  assert.match(msgs(analyze("fun f(a, a) do end"))[0], /duplicate argument/);
});

test("anonymous function with optional do", () => {
  assert.deepStrictEqual(msgs(analyze("f = fun () do 1 end")), []);
});

test("scopes and overloads by arity", () => {
  const a = analyze(`fun add(a) do a end
fun add(a, b) do a + b end
x = 10
fun f(x) do x + 1 end
add(1, 2)
add(1)
`);
  const refs = a.refs.filter((r) => r.name === "add");
  assert.strictEqual(refs[0].sym.arity, 2);
  assert.strictEqual(refs[1].sym.arity, 1);
  const inner = a.refs.find((r) => r.name === "x" && r.scope !== a.globalScope);
  assert.strictEqual(inner.sym.kind, "parameter");
});

test("local assignment shadows global", () => {
  const a = analyze("y = 5\nfun s() do\n y = 6\n y\nend\n");
  const y = a.symbols.filter((s) => s.name === "y");
  assert.strictEqual(y.length, 2);
});

test("doc comments are attached to functions", () => {
  const a = analyze("# adds\n# two numbers\nfun add(a, b) do a + b end\n");
  assert.strictEqual(a.symbols[0].doc, "adds\ntwo numbers");
});

test("frame shapes and export", () => {
  const a = analyze(`fun calc() do 1 end
export({ calc: calc, name: "x", nested: { k: 1 } })
`);
  assert.deepStrictEqual([...a.exportShape.keys()], ["calc", "name", "nested"]);
  assert.ok(a.exportShape.get("nested").nested.has("k"));
  assert.strictEqual(a.exportShape.get("calc").valueRef.name, "calc");
});

test("cross file: lib.calc resolves to the exported function", () => {
  const p = new Project();
  const uri = pathToFileURL(path.join(DRAX, "import.dx")).toString();
  const a = p.analysisFor(uri);
  const idx = a.tokens.findIndex((t, i) => t.text === "calc" && a.tokens[i - 1].text === ".");
  const chain = a.chainAt(idx);
  const r = p.resolveChain({ uri, analysis: a }, chain);
  assert.ok(r && r.uri.endsWith("export.dx"));
  assert.strictEqual(r.sym.name, "calc_two");
});

test("import resolution", () => {
  const p = new Project();
  const uri = pathToFileURL(path.join(DRAX, "import.dx")).toString();
  assert.ok(p.resolveImport("./export.dx", uri).endsWith("export.dx"));
  assert.ok(p.resolveImport("./export", uri).endsWith("export.dx"));
  assert.strictEqual(p.resolveImport("./nope", uri), null);
});

test("the Drax test suite parses without diagnostics", () => {
  const skip = new Set(["errors.dx"]);
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith(".dx") ? [path.join(d, e.name)] : []);
  const bad = [];
  for (const f of walk(DRAX)) {
    if (skip.has(path.basename(f)) || f.includes(`${path.sep}errors${path.sep}`)) continue;
    const a = analyze(fs.readFileSync(f, "utf8"));
    if (a.diagnostics.length) bad.push(`${path.relative(DRAX, f)}: ${a.diagnostics[0].message} @${a.lineOf(a.diagnostics[0].start) + 1}`);
  }
  assert.deepStrictEqual(bad, []);
});

test("safe pipe |?> and protected call f?() are tokens, '?' is not part of a name", () => {
  const { lex } = require("../src/lexer");
  const ops = (s) => lex(s).tokens.filter((t) => t.type === "op").map((t) => t.text);
  assert.deepStrictEqual(ops("x |?> f()"), ["|?>", "(", ")"]);
  assert.deepStrictEqual(ops("x |> f()"), ["|>", "(", ")"]);
  const t = lex("f?(1)").tokens.map((x) => [x.type, x.text]);
  assert.deepStrictEqual(t, [["id", "f"], ["op", "?"], ["op", "("], ["num", "1"], ["op", ")"]]);
  // a single '|' or '|?' without '>' is still invalid
  assert.strictEqual(lex("a | b").tokens.some((x) => x.type === "error"), true);
  assert.strictEqual(lex("a |? b").tokens.some((x) => x.type === "error"), true);
});

test("protected call resolves the function by its arguments", () => {
  const a = analyze(`fun add(a) do a end
fun add(a, b) do a + b end
add?(1, 2)
add?(1)
1 |?> add(2)
`);
  assert.deepStrictEqual(msgs(a), []);
  const refs = a.refs.filter((r) => r.name === "add");
  assert.strictEqual(refs[0].sym.arity, 2);
  assert.strictEqual(refs[1].sym.arity, 1);
});

test("'?' is not allowed in a function name", () => {
  assert.match(msgs(analyze("fun is_ok?(x) do x end"))[0], /'\?' is not allowed in names/);
  assert.deepStrictEqual(msgs(analyze("fun is_ok(x) do x end\nis_ok?(1)\n")), []);
});

test("Error module and global are known builtins", () => {
  const { GLOBALS, MODULES } = require("../src/builtins");
  assert.strictEqual(GLOBALS.Error, 1);
  assert.deepStrictEqual(Object.keys(MODULES.Error).sort(), ["is", "message", "or_else", "payload"]);
});
