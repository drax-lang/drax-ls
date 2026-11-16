"use strict";
// JavaScript port of drax/src/dlex.c. Keep both in sync.

const KEYWORDS = new Set([
  "and", "as", "do", "else", "end", "false", "fun", "if", "nil", "or",
  "true", "import", "export", "return",
]);

const isAlpha = (c) => (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_" || c === "?";
const isDigit = (c) => c >= "0" && c <= "9";
const isHex = (c) => /[0-9a-fA-F]/.test(c);
const isBin = (c) => c === "0" || c === "1";
const isOct = (c) => c >= "0" && c <= "7";

/**
 * Token: { type, text, start, end }
 * types: id | kw | num | str | op | error
 * Comments are returned separately: { start, end, text }.
 */
function lex(src) {
  const tokens = [];
  const comments = [];
  const n = src.length;
  let i = 0;

  const push = (type, start, end, extra) =>
    tokens.push(Object.assign({ type, text: src.slice(start, end), start, end }, extra));
  const err = (start, end, message) => push("error", start, end, { message });

  while (i < n) {
    const c = src[i];
    const start = i;

    if (c === " " || c === "\t" || c === "\r" || c === "\n") { i++; continue; }

    if (c === "#") {
      while (i < n && src[i] !== "\n") i++;
      comments.push({ start, end: i, text: src.slice(start, i) });
      continue;
    }

    if (isDigit(c)) {
      let kind = "dec";
      i++;
      if (c === "0" && (src[i] === "x" || src[i] === "b" || src[i] === "o")) {
        kind = src[i] === "x" ? "hex" : src[i] === "b" ? "bin" : "oct";
        i++;
        const ok = kind === "hex" ? isHex : kind === "bin" ? isBin : isOct;
        if (!(i < n && (isDigit(src[i]) || (kind === "hex" && isHex(src[i]))))) {
          err(start, i, "Invalid numeric literal: expected digits after prefix.");
          continue;
        }
        while (i < n && ok(src[i])) i++;
      } else {
        while (i < n && isDigit(src[i])) i++;
      }
      if (i < n && (isAlpha(src[i]) || isDigit(src[i]))) {
        while (i < n && (isAlpha(src[i]) || isDigit(src[i]))) i++;
        err(start, i, "Invalid digit for the selected number base.");
        continue;
      }
      if (src[i] === "." && kind === "dec") {
        if (isDigit(src[i + 1] || "")) {
          i++;
          while (i < n && isDigit(src[i])) i++;
        }
      } else if (src[i] === "." && kind !== "dec") {
        i++;
        err(start, i, "Base-prefixed numbers (hex, bin, oct) cannot have fractions.");
        continue;
      }
      push("num", start, i);
      continue;
    }

    if (c === "'") {
      i++;
      while (i < n && src[i] !== "'") {
        if (src[i] === "\\" && i + 1 < n) i++;
        i++;
      }
      if (i >= n) { err(start, n, "Unterminated string."); continue; }
      i++;
      push("str", start, i);
      continue;
    }

    if (c === '"') {
      if (src[i + 1] === '"' && src[i + 2] === '"') {
        i += 3;
        const close = src.indexOf('"""', i);
        if (close === -1) { i = n; err(start, n, "Unterminated multiline string."); continue; }
        i = close + 3;
        push("str", start, i, { multiline: true });
        continue;
      }
      i++;
      while (i < n && src[i] !== '"') {
        if (src[i] === "\\" && i + 1 < n) i++;
        i++;
      }
      if (i >= n) { err(start, n, "Unterminated string."); continue; }
      i++;
      push("str", start, i);
      continue;
    }

    if (isAlpha(c)) {
      i++;
      while (i < n && (isAlpha(src[i]) || isDigit(src[i]))) i++;
      const text = src.slice(start, i);
      push(KEYWORDS.has(text) ? "kw" : "id", start, i);
      continue;
    }

    const two = src.slice(i, i + 2);
    if (["++", "::", "|>", "!=", "==", "<<", "<=", ">>", ">="].includes(two)) {
      i += 2;
      push("op", start, i);
      continue;
    }
    if ("+-&*/()[]{},:.!=<>".includes(c)) {
      i++;
      push("op", start, i);
      continue;
    }
    i++;
    err(start, i, c === "|" ? "Invalid token." : "Unexpected token.");
  }

  return { tokens, comments };
}

module.exports = { lex, KEYWORDS };
