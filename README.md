# openscad-axi

Agent-ergonomic CLI to create, preview, validate, and export OpenSCAD 3D-printable models.

> Status: placeholder release (`0.0.0`). Implementation in progress.

Once released, invoke without a global install:

```
npx -y openscad-axi
```

## What it will do

An [AXI](https://toonformat.dev/)-style CLI that wraps a local OpenSCAD install so agents can:

- Scaffold versioned `.scad` files (`name_NNN.scad`)
- Validate syntax and surface warnings as structured issues
- Render multi-angle previews for visual verification
- Extract Customizer parameters
- Export STL with honest, geometry-summary-based manifold reporting

Output is [TOON](https://toonformat.dev/)-encoded and token-efficient.

## Credits

Combines ideas from two prior OpenSCAD agent toolkits:

- [iancanderson/openscad-agent](https://github.com/iancanderson/openscad-agent) (MIT) - versioning and iteration loop
- [mitsuhiko/agent-stuff `skills/openscad`](https://github.com/mitsuhiko/agent-stuff/tree/main/skills/openscad) - multi-angle previews, Customizer params, validation

## License

MIT
