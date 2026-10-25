"""Inspect a .blend file (read-only) and print a JSON summary between JARVIS_JSON_START / JARVIS_JSON_END.
Run:  Blender -b --factory-startup -noaudio file.blend --python inspect_blend.py
Never saves the file."""
import bpy, json

def r(x, n=3):
    try:
        return round(float(x), n)
    except Exception:
        return None

out = {"blender": bpy.app.version_string, "file": bpy.data.filepath, "scenes": [], "collections": [], "objects": {}, "top_objects": [],
       "materials": len(bpy.data.materials), "images": len(bpy.data.images), "actions": [], "cameras": len(bpy.data.cameras),
       "lights": len(bpy.data.lights), "armatures": len(bpy.data.armatures), "warnings": []}

for sc in bpy.data.scenes:
    out["scenes"].append({"name": sc.name, "frame_start": sc.frame_start, "frame_end": sc.frame_end, "fps": sc.render.fps,
                          "engine": sc.render.engine, "markers": len(sc.timeline_markers),
                          "view_layers": [{"name": vl.name, "use_for_rendering": vl.use} for vl in sc.view_layers]})
    for vl in sc.view_layers:
        if not vl.use:
            out["warnings"].append("View layer '%s' has 'Use for Rendering' off: headless renders will be empty until you set view_layer.use = True" % vl.name)
    if sc.timeline_markers:
        out["warnings"].append("Scene '%s' has timeline markers (camera switching): clear them before setting your own camera" % sc.name)

for c in bpy.data.collections:
    out["collections"].append({"name": c.name, "objects": len(c.objects), "hide_render": c.hide_render, "hide_viewport": c.hide_viewport})

mesh_rows = []
for o in bpy.data.objects:
    out["objects"][o.type] = out["objects"].get(o.type, 0) + 1
    if o.type == "MESH" and o.data is not None:
        mesh_rows.append({"name": o.name, "verts": len(o.data.vertices), "polys": len(o.data.polygons),
                          "dims": [r(v) for v in o.dimensions], "materials": [m.name for m in o.data.materials if m][:6],
                          "hidden": bool(o.hide_render)})
mesh_rows.sort(key=lambda m: -m["polys"])
out["top_objects"] = mesh_rows[:40]
out["total_polys"] = sum(m["polys"] for m in mesh_rows)
out["mesh_objects"] = len(mesh_rows)
out["actions"] = [{"name": a.name, "frames": [r(a.frame_range[0], 1), r(a.frame_range[1], 1)]} for a in bpy.data.actions][:40]
if out["total_polys"] > 2_000_000:
    out["warnings"].append("Very heavy model (%d polygons): decimate or use Draco before using it on the web" % out["total_polys"])

print("JARVIS_JSON_START")
print(json.dumps(out))
print("JARVIS_JSON_END")
