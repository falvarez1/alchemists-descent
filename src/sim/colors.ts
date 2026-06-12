import { Cell } from '@/sim/CellType';

/** Pack 8-bit RGB channels into a single 0xRRGGBB integer. */
export function packRGB(r: number, g: number, b: number): number {
  return ((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff);
}

export function unpackR(c: number): number {
  return (c >> 16) & 0xff;
}

export function unpackG(c: number): number {
  return (c >> 8) & 0xff;
}

export function unpackB(c: number): number {
  return c & 0xff;
}

const rand = (n: number) => Math.floor(Math.random() * n);

/** The dark cave-air backdrop color for empty cells. */
export const EMPTY_COLOR = packRGB(8, 8, 12);

export const emptyColor = () => EMPTY_COLOR;
export const sandColor = () => packRGB(225 + rand(25), 180 + rand(25), 90 + rand(20));
export const waterColor = () => packRGB(35 + rand(15), 105 + rand(25), 240 + rand(15));
export const wallColor = () => packRGB(60 + rand(10), 60 + rand(10), 65 + rand(10));
export const woodColor = () => packRGB(110 + rand(15), 70 + rand(10), 35 + rand(10));
export const fireColor = () => packRGB(255, 70 + rand(70), 0);
export const oilColor = () => packRGB(58 + rand(10), 45 + rand(8), 35 + rand(8));
export const acidColor = () => packRGB(40 + rand(20), 250, 40);
export const gunpowderColor = () => {
  const g = 55 + rand(15);
  return packRGB(g, g, g + 5);
};
export const steamColor = () => {
  const s = 160 + rand(20);
  return packRGB(s, s, s + 10);
};
export const iceColor = () => packRGB(160 + rand(20), 215 + rand(20), 255);
export const emberColor = () => packRGB(250 + rand(6), 80 + rand(70), 8 + rand(14));
export const lavaColor = () => packRGB(250 + rand(6), 22 + rand(24), 0);
export const stoneColor = () => packRGB(85 + rand(15), 80 + rand(15), 85 + rand(15));
export const metalColor = () => packRGB(105 + rand(10), 115 + rand(10), 130 + rand(10));
export const smokeColor = () => {
  const s = 45 + rand(20);
  return packRGB(s, s, s + 5);
};
export const vineColor = () => packRGB(35 + rand(15), 165 + rand(25), 55 + rand(15));
export const goldColor = () => packRGB(245 + rand(10), 195 + rand(20), 30);
export const nitrogenColor = () => packRGB(210 + rand(30), 245, 255);
export const bloodColor = () => packRGB(160 + rand(50), 12 + rand(18), 25 + rand(12));
export const slimeColor = () => packRGB(80 + rand(25), 200 + rand(30), 50 + rand(20));
export const elixirLifeColor = () => packRGB(255, 100 + rand(40), 130 + rand(40));
export const elixirLevityColor = () => packRGB(130 + rand(40), 220 + rand(30), 255);
export const elixirStoneColor = () => packRGB(155 + rand(30), 140 + rand(20), 100 + rand(20));
export const toxicColor = () => packRGB(64 + rand(18), 118 + rand(26), 36 + rand(12));
export const healiumColor = () => packRGB(248 + rand(8), 110 + rand(30), 160 + rand(30));
export const teleportiumColor = () => packRGB(150 + rand(30), 60 + rand(20), 235 + rand(20));
export const snowColor = () => {
  const s = 232 + rand(18);
  return packRGB(s, s, Math.min(255, s + 8));
};
export const coalColor = () => {
  const c = 30 + rand(14);
  return packRGB(c, c, c + 3);
};
export const crystalColor = () => {
  const v = Math.random();
  return packRGB(96 + Math.floor(v * 50), 200 + Math.floor(v * 45), 228 + rand(27));
};
export const fungusColor = () => packRGB(40 + rand(20), 190 + rand(35), 150 + rand(30));
export const glassColor = () => packRGB(185 + rand(20), 210 + rand(18), 222 + rand(16));
export const ashColor = () => {
  const a = 95 + rand(22);
  return packRGB(a, a - 4, a - 6);
};
export const glowshroomColor = () => packRGB(120 + rand(40), 230 + rand(25), 140 + rand(50));
export const mossColor = () => packRGB(38 + rand(20), 96 + rand(44), 42 + rand(18));
// philosopher's dust: rose-gold grains with the occasional white-hot glint
export const catalystColor = () =>
  Math.random() < 0.12
    ? packRGB(255, 235 + rand(20), 200 + rand(40))
    : packRGB(240 + rand(15), 140 + rand(40), 70 + rand(30));

/** Fresh randomized color for a newly placed cell of the given material. */
export const COLOR_FN: Record<number, () => number> = {
  [Cell.Empty]: emptyColor,
  [Cell.Sand]: sandColor,
  [Cell.Water]: waterColor,
  [Cell.Wall]: wallColor,
  [Cell.Wood]: woodColor,
  [Cell.Fire]: fireColor,
  [Cell.Oil]: oilColor,
  [Cell.Acid]: acidColor,
  [Cell.Gunpowder]: gunpowderColor,
  [Cell.Steam]: steamColor,
  [Cell.Ice]: iceColor,
  [Cell.Lava]: lavaColor,
  [Cell.Stone]: stoneColor,
  [Cell.Metal]: metalColor,
  [Cell.Smoke]: smokeColor,
  [Cell.Vines]: vineColor,
  [Cell.Nitrogen]: nitrogenColor,
  [Cell.Gold]: goldColor,
  [Cell.Blood]: bloodColor,
  [Cell.Slime]: slimeColor,
  [Cell.Ember]: emberColor,
  [Cell.ElixirLife]: elixirLifeColor,
  [Cell.ElixirLevity]: elixirLevityColor,
  [Cell.ElixirStone]: elixirStoneColor,
  [Cell.Toxic]: toxicColor,
  [Cell.Healium]: healiumColor,
  [Cell.Teleportium]: teleportiumColor,
  [Cell.Snow]: snowColor,
  [Cell.Coal]: coalColor,
  [Cell.Crystal]: crystalColor,
  [Cell.Fungus]: fungusColor,
  [Cell.Glass]: glassColor,
  [Cell.Ash]: ashColor,
  [Cell.Glowshroom]: glowshroomColor,
  [Cell.Moss]: mossColor,
  [Cell.Catalyst]: catalystColor,
};
