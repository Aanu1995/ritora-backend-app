import sharp from 'sharp';
import { AnalysisFailureCodeValue } from '../skin-journal.constants';
import { assertAnalysisPhotoPreflight } from './skin-journal-analysis-preflight';

async function faceLikePortraitBuffer(): Promise<Buffer> {
  const svg = `
    <svg width="360" height="460" viewBox="0 0 360 460" xmlns="http://www.w3.org/2000/svg">
      <rect width="360" height="460" fill="#ece7df"/>
      <ellipse cx="180" cy="235" rx="104" ry="142" fill="#a96f56"/>
      <ellipse cx="180" cy="218" rx="86" ry="118" fill="#b8795d"/>
      <circle cx="142" cy="194" r="10" fill="#36211d"/>
      <circle cx="218" cy="194" r="10" fill="#36211d"/>
      <path d="M152 282 Q180 305 208 282" fill="none" stroke="#50302b" stroke-width="10" stroke-linecap="round"/>
      <path d="M180 206 Q169 238 183 248" fill="none" stroke="#704334" stroke-width="8" stroke-linecap="round"/>
      <ellipse cx="180" cy="354" rx="72" ry="34" fill="#8a5847"/>
    </svg>
  `;

  return sharp(Buffer.from(svg)).webp().toBuffer();
}

async function nonFaceLandscapeBuffer(): Promise<Buffer> {
  const svg = `
    <svg width="420" height="320" viewBox="0 0 420 320" xmlns="http://www.w3.org/2000/svg">
      <rect width="420" height="320" fill="#2d8a72"/>
      <rect y="0" width="420" height="92" fill="#2376a8"/>
      <rect x="0" y="188" width="420" height="132" fill="#1c6548"/>
      <path d="M0 240 C80 185 125 198 200 232 C270 265 330 220 420 252" fill="none" stroke="#e6f2ce" stroke-width="18"/>
      <path d="M15 268 C85 218 155 230 230 262 C300 292 352 254 410 284" fill="none" stroke="#365f4f" stroke-width="12"/>
    </svg>
  `;

  return sharp(Buffer.from(svg)).webp().toBuffer();
}

async function nonFaceSkinPatchBuffer(): Promise<Buffer> {
  const svg = `
    <svg width="420" height="320" viewBox="0 0 420 320" xmlns="http://www.w3.org/2000/svg">
      <rect width="420" height="320" fill="#cdd9c8"/>
      <path d="M0 94 C92 60 206 78 420 68 L420 255 C265 255 122 239 0 264 Z" fill="#c89a83"/>
      <path d="M0 202 C104 188 222 198 420 183" fill="none" stroke="#b98470" stroke-width="16" opacity="0.55"/>
      <path d="M0 248 C130 221 250 242 420 219" fill="none" stroke="#d9b19f" stroke-width="14" opacity="0.38"/>
    </svg>
  `;

  return sharp(Buffer.from(svg)).webp().toBuffer();
}

describe('assertAnalysisPhotoPreflight', () => {
  it('accepts a local face-like portrait before external analysis', async () => {
    const [result] = await assertAnalysisPhotoPreflight({
      photos: [{ angle: 'head_on', buffer: await faceLikePortraitBuffer() }],
    });

    expect(result).toMatchObject({
      angle: 'head_on',
      issues: [],
      passed: true,
    });
    expect(result).toHaveProperty('local_face_detected', true);
    expect(result).toHaveProperty('local_face_confidence', expect.any(Number));
  });

  it('rejects an obvious non-face image before external analysis', async () => {
    await expect(
      assertAnalysisPhotoPreflight({
        photos: [{ angle: 'head_on', buffer: await nonFaceLandscapeBuffer() }],
      }),
    ).rejects.toMatchObject({
      code: AnalysisFailureCodeValue.PhotoPreflightRejected,
      message: expect.stringContaining('no_local_face_detected'),
    });
  });

  it('rejects a skin-like body patch without local face structure', async () => {
    await expect(
      assertAnalysisPhotoPreflight({
        photos: [{ angle: 'head_on', buffer: await nonFaceSkinPatchBuffer() }],
      }),
    ).rejects.toMatchObject({
      code: AnalysisFailureCodeValue.PhotoPreflightRejected,
      message: expect.stringContaining('no_local_face_detected'),
    });
  });
});
