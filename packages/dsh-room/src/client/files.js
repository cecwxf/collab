export function normalizeWorkspacePath(path) {
  return (path || '').replace(/\\/g, '/').replace(/^\/private\/var(?=\/)/, '/var').replace(/\/+$/, '');
}

export function sameWorkspacePath(a, b) {
  const na = normalizeWorkspacePath(a);
  const nb = normalizeWorkspacePath(b);
  return !!na && !!nb && na === nb;
}

export function sessionFileAddress(sessionId, path) {
  const normalized = path.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '');
  const segment = s => encodeURIComponent(s).replace(/%3A/gi, ':');
  return `dsh-resource://file/session/${segment(sessionId)}/${normalized.split('/').map(segment).join('/')}`;
}

export function inlineFile(value) {
  const match = /^(.*?)(?::(\d+)|#L(\d+)(?:-L?\d+)?)?$/.exec(value);
  return { path: match[1], line: Number(match[2] || match[3]) || undefined };
}

/** Candidates become links only after the host verifies they name real local files. */
export function fileCandidates(text) {
  const values = [...text.matchAll(/`([^`\n]{1,4096})`/g)].map(m => inlineFile(m[1]).path);
  const images = [...text.matchAll(/!\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)].map(m => m[1]);
  return { paths: [...new Set([...values, ...images].filter(p => !/^[a-z]+:\/\//i.test(p) && /[./\\]/.test(p)))].slice(0, 50), images };
}
