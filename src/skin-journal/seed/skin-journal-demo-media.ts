import { mkdir, rm, writeFile } from 'fs/promises';
import { dirname, resolve, sep } from 'path';
import sharp from 'sharp';
import { SKIN_JOURNAL_LOCAL_DIR } from '../skin-journal.constants';

export type DemoPhotoFile = {
  objectKey: string;
  width: number;
  height: number;
  size: number;
  contentType: 'image/webp';
};

export async function writeDemoPhotoFile(params: {
  userId: string;
  entryId: string;
  tone: string;
  label: string;
}): Promise<DemoPhotoFile> {
  const objectKey = `skin-journal/${params.userId}/${params.entryId}/demo.webp`;
  const buffer = await generateDemoPhoto(params.tone, params.label);
  const fullPath = localMediaPath(objectKey);
  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, buffer);

  return {
    objectKey,
    width: 960,
    height: 1152,
    size: buffer.length,
    contentType: 'image/webp',
  };
}

export async function removeDemoPhotoDirectory(userId: string): Promise<void> {
  await rm(resolve(mediaRoot(), 'skin-journal', userId), {
    recursive: true,
    force: true,
  });
}

async function generateDemoPhoto(tone: string, label: string): Promise<Buffer> {
  const svg = `
    <svg width="960" height="1152" viewBox="0 0 960 1152" xmlns="http://www.w3.org/2000/svg">
      <rect width="960" height="1152" fill="#f6efe9"/>
      <ellipse cx="480" cy="558" rx="255" ry="330" fill="${tone}"/>
      <ellipse cx="385" cy="500" rx="28" ry="16" fill="#5f463e" opacity="0.62"/>
      <ellipse cx="575" cy="500" rx="28" ry="16" fill="#5f463e" opacity="0.62"/>
      <path d="M450 610 C470 625 500 625 520 610" stroke="#875f55" stroke-width="10" fill="none" stroke-linecap="round" opacity="0.5"/>
      <path d="M390 705 C445 745 525 745 580 705" stroke="#7f4f4d" stroke-width="12" fill="none" stroke-linecap="round" opacity="0.45"/>
      <circle cx="365" cy="610" r="32" fill="#d56f6a" opacity="0.18"/>
      <circle cx="595" cy="612" r="34" fill="#d56f6a" opacity="0.18"/>
      <text x="480" y="1040" text-anchor="middle" font-family="Arial, sans-serif" font-size="38" font-weight="700" fill="#7a6258">${label}</text>
    </svg>`;

  return sharp(Buffer.from(svg)).webp({ quality: 85 }).toBuffer();
}

function localMediaPath(objectKey: string): string {
  const root = mediaRoot();
  const path = resolve(root, objectKey);
  if (path !== root && path.startsWith(`${root}${sep}`)) {
    return path;
  }
  throw new Error('Unsafe demo media object key');
}

function mediaRoot(): string {
  return resolve(process.cwd(), SKIN_JOURNAL_LOCAL_DIR);
}
