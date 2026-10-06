export function looksLikeLegacyModuleHeader(node: Element | null): boolean {
  if (!(node instanceof HTMLElement)) {
    return false;
  }

  const heading = node.querySelector('h1');
  if (!(heading instanceof HTMLElement)) {
    return false;
  }

  const className = typeof node.className === 'string' ? node.className : '';
  const tokens = className.split(/\s+/).filter(Boolean);

  return tokens.includes('flex') && (
    tokens.includes('items-center') ||
    tokens.includes('justify-between')
  );
}
