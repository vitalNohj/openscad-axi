// --summary-file JSON -> validation fields.
// Manifold backend geometry: { simple, vertices, facets, bounding_box }.
// CGAL backend geometry adds edges/volumes; PolySet output has convex/triangular
// and no `simple` key at all, which means we cannot claim manifold either way.

export function readSummary(text) {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// manifold is true/false only when the summary carries `simple`; anything else
// is honestly 'unknown'.
export function geometryFacts(summary) {
  const geometry = summary && summary.geometry;
  if (!geometry || typeof geometry !== 'object') {
    return { manifold: 'unknown', triangles: null, vertices: null, size_mm: null };
  }
  const manifold =
    typeof geometry.simple === 'boolean' ? geometry.simple : 'unknown';
  const size = geometry.bounding_box && geometry.bounding_box.size;
  return {
    manifold,
    triangles: Number.isFinite(geometry.facets) ? geometry.facets : null,
    vertices: Number.isFinite(geometry.vertices) ? geometry.vertices : null,
    size_mm: Array.isArray(size) && size.length === 3 ? size.map(round2) : null,
  };
}

// Binary STL triangle count: uint32 LE at byte offset 80. Only used on the
// legacy path where no summary JSON exists.
export function trianglesFromBinaryStl(buffer) {
  if (!buffer || buffer.length < 84) return null;
  return buffer.readUInt32LE(80);
}
