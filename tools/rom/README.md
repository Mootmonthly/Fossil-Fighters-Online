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

Expected layout: `rom/ffc.nds` next to a `rom/defs/` folder of decompressed tables and `rom/out/` for outputs;
see the scripts for the exact paths.
