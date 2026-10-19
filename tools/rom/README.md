# ROM data tools

Scripts used to pull battle data out of a Fossil Fighters: Champions ROM you own. No game files are included
in this repository; point the scripts at your own dump.

- `nds.py` – minimal DS toolkit: NitroFS listing, MAR/MCM containers (the game's Huffman + LZ stacked
  compression), NARC, NCLR/NCGR/NCER decoders.
- `extract_data.py` – reads `etc/creature_defs`, `etc/attack_defs`, `etc/rank_growth_pattern_defs`,
  `etc/btl_kp_defs`, `etc/state_effect_defs`, `etc/creature_evolution_abilityup_param_defs`, `etc/kaseki_defs`
  and the `text/` name tables, writing `rom_data.json`.
- `import_rom.py` – merges `rom_data.json` into `packages/shared/src/data/vivosaurs.json` and writes
  `growth.json`.
- `export_images.py <ffc.nds> <out dir> [prefix ...]` – renders `image/*` descriptors (linear bitmaps and tiled
  backgrounds) to PNG; the default prefix `kaseki_` exports the 734 cleaning-room fossil pictures.
- `build_fossil_images.py` – from `rom_data.json`'s rock table and the exported fossil PNGs, writes the cropped
  normal / red-boned / damaged picture of every set an obtainable vivosaur uses into
  `packages/client/public/img/fossils/` and the species+part → set mapping `data/fossilImages.json`.

The arena and menu backgrounds in `packages/client/public/img/{arena,bg}` were rendered the same way
(`export_images.py ... b00_ b10_ ...` and the named UI screens); see the main README.

Expected layout: `rom/ffc.nds` next to a `rom/defs/` folder of decompressed tables and `rom/out/` for outputs;
see the scripts for the exact paths.
