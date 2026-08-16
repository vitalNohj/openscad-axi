// Minimal integration fixture: a hollow 10mm box.
// The boolean operation makes OpenSCAD evaluate real geometry, so the summary
// carries the manifold `simple` flag rather than plain PolySet statistics.
size = 10;  // [5:50] Outer edge in mm
wall = 2;   // [1:0.5:5] Wall thickness in mm

difference() {
  cube([size, size, size]);
  translate([wall, wall, wall])
    cube([size - 2 * wall, size - 2 * wall, size]);
}
