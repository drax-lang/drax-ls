"use strict";
// End-to-end: spawn the server over stdio and talk LSP to it.
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const { spawn } = require("child_process");
const { pathToFileURL } = require("url");
const fs = require("fs");

const DRAX = path.resolve(__dirname, "../../../drax/tests/drax");

function client() {
  const p = spawn(process.execPath, [path.resolve(__dirname, "../bin/drax-language-server")]);
  let buf = Buffer.alloc(0);
  let id = 0;
  const pending = new Map();
  const notes = [];
  p.stdout.on("data", (d) => {
    buf = Buffer.concat([buf, d]);
    for (;;) {
      const h = buf.indexOf("\r\n\r\n");
      if (h < 0) return;
      const len = +/Content-Length: (\d+)/i.exec(buf.slice(0, h).toString())[1];
      if (buf.length < h + 4 + len) return;
      const msg = JSON.parse(buf.slice(h + 4, h + 4 + len).toString());
      buf = buf.slice(h + 4 + len);
      if (msg.id !== undefined && pending.has(msg.id)) pending.get(msg.id)(msg.result);
      else if (msg.method) notes.push(msg);
    }
  });
  const send = (m) => {
    const s = JSON.stringify(m);
    p.stdin.write(`Content-Length: ${Buffer.byteLength(s)}\r\n\r\n${s}`);
  };
  return {
    notes,
    request: (method, params) => new Promise((res) => { const i = ++id; pending.set(i, res); send({ jsonrpc: "2.0", id: i, method, params }); }),
    notify: (method, params) => send({ jsonrpc: "2.0", method, params }),
    close: () => p.kill(),
  };
}

test("initialize, diagnostics, definition across files, hover, completion", async () => {
  const c = client();
  const root = pathToFileURL(DRAX).toString();
  const init = await c.request("initialize", { processId: null, rootUri: root, workspaceFolders: [{ uri: root, name: "t" }], capabilities: {} });
  assert.ok(init.capabilities.definitionProvider);
  c.notify("initialized", {});

  const uri = pathToFileURL(path.join(DRAX, "import.dx")).toString();
  const text = fs.readFileSync(path.join(DRAX, "import.dx"), "utf8");
  c.notify("textDocument/didOpen", { textDocument: { uri, languageId: "drax", version: 1, text } });

  const lines = text.split("\n");
  const ln = lines.findIndex((l) => l.includes("lib.calc(5, 5)"));
  const col = lines[ln].indexOf("calc") + 1;

  const def = await c.request("textDocument/definition", { textDocument: { uri }, position: { line: ln, character: col } });
  assert.ok(def.uri.endsWith("export.dx"), JSON.stringify(def));

  const hover = await c.request("textDocument/hover", { textDocument: { uri }, position: { line: ln, character: col } });
  assert.match(hover.contents.value, /fun calc_two\(a, b\)/);

  const impLn = lines.findIndex((l) => l.includes("import('./export.dx')"));
  const impDef = await c.request("textDocument/definition", { textDocument: { uri }, position: { line: impLn, character: lines[impLn].indexOf("export") } });
  assert.ok(impDef.uri.endsWith("export.dx"));

  const comp = await c.request("textDocument/completion", { textDocument: { uri }, position: { line: ln, character: lines[ln].indexOf("calc") } });
  const labels = comp.map((i) => i.label);
  assert.ok(labels.includes("calc") && labels.includes("name"), labels.join());

  const syms = await c.request("textDocument/documentSymbol", { textDocument: { uri } });
  assert.ok(syms.some((s) => s.name === "lib"));

  // diagnostics for a broken document
  const bad = pathToFileURL(path.join(DRAX, "broken.dx")).toString();
  c.notify("textDocument/didOpen", { textDocument: { uri: bad, languageId: "drax", version: 1, text: "fun f() do\n" } });
  await new Promise((r) => setTimeout(r, 300));
  const d = c.notes.filter((n) => n.method === "textDocument/publishDiagnostics" && n.params.uri === bad).pop();
  assert.match(d.params.diagnostics[0].message, /Expect 'end'/);

  // module completion
  c.notify("textDocument/didChange", { textDocument: { uri: bad, version: 2 }, contentChanges: [{ text: "List." }] });
  const mc = await c.request("textDocument/completion", { textDocument: { uri: bad }, position: { line: 0, character: 5 } });
  assert.ok(mc.some((i) => i.label === "map"));
  c.close();
});
