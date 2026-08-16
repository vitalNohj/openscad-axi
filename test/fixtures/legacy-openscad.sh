#!/bin/bash
# Simulates an OpenSCAD build that predates --backend and --summary (2021.01
# stable), by hiding those flags from --help and forwarding everything else to
# the real binary named in OPENSCAD_AXI_REAL_BIN.
if [[ "$1" == "--help" ]]; then
  echo "Usage: openscad [options] file.scad"
  echo "  -o [ --o ] arg    output file: stl, off, png, echo"
  echo "  --imgsize arg     =width,height"
  echo "  --camera arg      camera parameters"
  echo "  --colorscheme arg =colorscheme"
  exit 0
fi

if [[ "$1" == "--version" ]]; then
  echo "OpenSCAD version 2021.01" >&2
  exit 0
fi

exec "$OPENSCAD_AXI_REAL_BIN" "$@"
