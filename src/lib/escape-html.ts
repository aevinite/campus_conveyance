// Escape a string for safe interpolation into HTML. Leaflet's bindPopup /
// bindTooltip render their content as HTML (innerHTML), so any user-entered text
// (e.g. an agency's stop name) MUST be escaped before it goes in, or it's a
// stored-XSS sink. Shared by the map components.
export function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}
