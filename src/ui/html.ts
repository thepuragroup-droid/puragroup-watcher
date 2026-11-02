/** Minimal escaped HTML templating: `html\`<p>${userText}</p>\`` escapes by default. */

export class SafeHtml {
  readonly value: string;
  constructor(value: string) {
    this.value = value;
  }
  toString(): string {
    return this.value;
  }
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

type Part = SafeHtml | string | number | null | undefined | false | Part[];

function render(part: Part): string {
  if (part === null || part === undefined || part === false) return '';
  if (Array.isArray(part)) return part.map(render).join('');
  if (part instanceof SafeHtml) return part.value;
  return escapeHtml(String(part));
}

export function html(strings: TemplateStringsArray, ...parts: Part[]): SafeHtml {
  let out = strings[0];
  for (let i = 0; i < parts.length; i++) out += render(parts[i]) + strings[i + 1];
  return new SafeHtml(out);
}

/** Trusted markup (generated SVG, CSS). Never pass user input. */
export function raw(s: string): SafeHtml {
  return new SafeHtml(s);
}
