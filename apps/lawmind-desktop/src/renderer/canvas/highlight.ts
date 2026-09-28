export type HighlightKind = "plain" | "keyword" | "string" | "comment" | "number" | "type" | "punct";

export type HighlightToken = { text: string; kind: HighlightKind };

const SHARED = [
  "const", "let", "var", "function", "return", "if", "else", "for", "while", "import", "export", "from", "class",
  "type", "interface", "new", "async", "await", "break", "continue", "switch", "case", "default", "try", "catch",
  "throw", "typeof", "extends", "implements", "public", "private", "protected", "static", "void", "null", "true", "false",
];

const BY_LANGUAGE: Record<string, string[]> = {
  ts: [...SHARED, "as", "enum", "readonly", "infer", "keyof", "satisfies"],
  tsx: [...SHARED, "as", "enum", "readonly", "infer", "keyof", "satisfies"],
  js: SHARED,
  jsx: SHARED,
  py: ["def", "class", "return", "if", "elif", "else", "for", "while", "import", "from", "as", "with", "yield", "lambda", "pass", "raise", "try", "except", "finally", "True", "False", "None", "async", "await", "in", "not", "and", "or"],
  sh: [],
  yaml: [],
  yml: [],
  toml: [],
  rb: [],
  rs: ["fn", "let", "mut", "pub", "struct", "enum", "impl", "trait", "use", "mod", "return", "if", "else", "match", "async", "await", "self", "Self"],
  go: ["func", "package", "import", "return", "if", "else", "for", "range", "var", "const", "type", "struct", "interface", "go", "defer"],
  md: [],
};

export function languageFromPath(path: string | undefined, language: string | undefined): string {
  const named = language?.trim().toLowerCase();
  if (named === "typescript" || named === "ts") {return "ts";}
  if (named === "tsx") {return "tsx";}
  if (named === "javascript" || named === "js") {return "js";}
  if (named === "jsx") {return "jsx";}
  if (named === "python" || named === "py") {return "py";}
  if (named === "shell" || named === "sh" || named === "bash") {return "sh";}
  if (named === "yaml" || named === "yml") {return "yaml";}
  if (named === "toml") {return "toml";}
  if (named === "ruby" || named === "rb") {return "rb";}
  if (named === "rust" || named === "rs") {return "rs";}
  if (named === "go" || named === "golang") {return "go";}
  if (named === "markdown" || named === "md") {return "md";}
  const ext = path?.split(".").pop()?.toLowerCase() ?? "";
  return ext in BY_LANGUAGE ? ext : "ts";
}

const HASH_COMMENT_LANGUAGES = new Set(["py", "sh", "yaml", "yml", "toml", "rb"]);

export function highlightLine(content: string, language: string): HighlightToken[] {
  const keywords = new Set(BY_LANGUAGE[language] ?? SHARED);
  const hashIsComment = HASH_COMMENT_LANGUAGES.has(language);
  const hashPattern = hashIsComment ? "(#.*$)" : "(#[A-Za-z_]\\w*)";
  const tokens: HighlightToken[] = [];
  const re = new RegExp(
    `(\\/\\*[\\s\\S]*?\\*\\/)|(\\/\\/.*$)|${hashPattern}|("(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*'|\`(?:\\\\.|[^\`\\\\])*\`)|(\\b\\d+(?:\\.\\d+)?\\b)|(\\b[A-Za-z_][\\w]*\\b)|(\\s+)|([^\\s])`,
    "g",
  );
  let match: RegExpExecArray | null;
  while ((match = re.exec(content))) {
    const [text, block, lineComment, hashComment, stringLit, number, word] = match;
    let kind: HighlightKind = "plain";
    if (block || lineComment || (hashComment && hashIsComment)) {
      kind = "comment";
    } else if (stringLit) {
      kind = "string";
    } else if (number) {
      kind = "number";
    } else if (word && keywords.has(word)) {
      kind = "keyword";
    } else if (word && /^[A-Z]/.test(word)) {
      kind = "type";
    } else if (!word && !stringLit && !number && !block && !lineComment && !hashComment && text.trim()) {
      kind = "punct";
    }
    tokens.push({ text, kind });
  }
  return tokens;
}
