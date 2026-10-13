export function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[ \t\n\r\v\f_]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
