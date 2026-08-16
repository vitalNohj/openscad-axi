// The six named preview angles, format tx,ty,tz,rotx,roty,rotz,dist.
// Distance 0 paired with --viewall lets OpenSCAD frame the model itself.
export const CAMERAS = {
  iso: '0,0,0,55,0,25,0',
  front: '0,0,0,90,0,0,0',
  back: '0,0,0,90,0,180,0',
  left: '0,0,0,90,0,90,0',
  right: '0,0,0,90,0,-90,0',
  top: '0,0,0,0,0,0,0',
};

export const ANGLE_NAMES = Object.keys(CAMERAS);

export const DEFAULT_SIZE = '800x600';
export const DEFAULT_COLORSCHEME = 'Tomorrow Night';

export const COLORSCHEMES = [
  'Cornfield',
  'Metallic',
  'Sunset',
  'Starnight',
  'BeforeDawn',
  'Nature',
  'Daylight Gem',
  'Nocturnal Gem',
  'DeepOcean',
  'Solarized',
  'Tomorrow',
  'Tomorrow Night',
  'ClearSky',
  'Monotone',
];

export function parseSize(value) {
  const match = /^(\d+)x(\d+)$/i.exec(String(value || '').trim());
  if (!match) return null;
  const width = parseInt(match[1], 10);
  const height = parseInt(match[2], 10);
  if (width < 1 || height < 1) return null;
  return { width, height, text: `${width}x${height}` };
}
