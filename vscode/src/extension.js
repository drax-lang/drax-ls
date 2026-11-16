"use strict";
const path = require("path");
const vscode = require("vscode");
const { LanguageClient, TransportKind } = require("vscode-languageclient/node");

let client;

function activate(context) {
  if (!vscode.workspace.getConfiguration("drax").get("languageServer.enabled", true)) return;

  const server = context.asAbsolutePath(path.join("dist", "server.js"));
  client = new LanguageClient(
    "drax",
    "Drax Language Server",
    {
      run: { module: server, transport: TransportKind.ipc },
      debug: { module: server, transport: TransportKind.ipc, options: { execArgv: ["--nolazy", "--inspect=6009"] } },
    },
    {
      documentSelector: [{ scheme: "file", language: "drax" }, { scheme: "untitled", language: "drax" }],
      synchronize: { fileEvents: vscode.workspace.createFileSystemWatcher("**/*.dx") },
    }
  );
  client.start();
}

function deactivate() {
  return client ? client.stop() : undefined;
}

module.exports = { activate, deactivate };
