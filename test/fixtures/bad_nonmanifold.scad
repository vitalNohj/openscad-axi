// An open (not closed) surface unioned with a solid.
// The pyramid is missing its fourth side and its base, so the manifold backend
// cannot close it and drops it from the result. Export must report the
// non_manifold issue instead of claiming the mesh is print-ready.
union() {
  polyhedron(
    points = [[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0], [5, 5, 10]],
    faces = [[0, 1, 4], [1, 2, 4], [2, 3, 4]]
  );
  translate([20, 0, 0]) cube([10, 10, 10]);
}
