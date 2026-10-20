const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><rect width="128" height="128" rx="24" fill="#111827"/>' +
  '<path d="M22 42 Q22 30 34 30 L54 30 L54 54 L38 64 L54 74 L54 98 L34 98 Q22 98 22 86 Z" fill="white"/>' +
  '<path d="M106 42 Q106 30 94 30 L74 30 L74 54 L90 64 L74 74 L74 98 L94 98 Q106 98 106 86 Z" fill="white"/>' +
  '<rect x="52" y="52" width="24" height="24" rx="2" transform="rotate(45 64 64)" fill="#3b82f6"/></svg>';

/** The WalletPair icon as a data URI, the form EIP-6963 requires. */
export const ICON = `data:image/svg+xml;base64,${btoa(SVG)}` as const;

export const NAME = 'WalletPair';
