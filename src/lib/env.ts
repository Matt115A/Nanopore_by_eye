/** Public build (GitHub Pages): only sessions 1 and 2, no debug tools, an explainer for new visitors. */
export const PUBLIC = import.meta.env.VITE_PUBLIC === 'true';
export const PUBLIC_PRESETS = ['first', 'pretrained'];
