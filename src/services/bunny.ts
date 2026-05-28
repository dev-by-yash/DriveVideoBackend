import crypto from 'crypto';
import { env } from '../env.js';

export type BunnyVideoApiStatus = {
  videoLibraryId: number;
  guid: string;
  title: string;
  dateUploaded: string;
  status: number;
  encodeProgress: number;
  thumbnailFileName?: string | null;
  thumbnailBlurhash?: string | null;
  availableResolutions?: string | null;
  outputCodecs?: string | null;
};

export type BunnyVideoPlayData = {
  thumbnailUrl?: string | null;
  previewUrl?: string | null;
  videoPlaylistUrl?: string | null;
  fallbackUrl?: string | null;
};

export type BunnyTusUploadCredentials = {
  videoId: string;
  libraryId: number;
  expirationTime: number;
  signature: string;
  endpoint: string;
  embedUrl: string;
};

export type BunnyUploadOptions = {
  jitEnabled?: boolean;
  enabledOutputCodecs?: string;
};

const apiBase = env.BUNNY_STREAM_API_BASE.replace(/\/$/, '');

function accessKeyHeaders(contentType = 'application/json') {
  return {
    AccessKey: env.BUNNY_STREAM_ACCESS_KEY,
    Accept: 'application/json',
    'Content-Type': contentType
  };
}

function readOnlyHeaders(contentType = 'application/json') {
  return {
    AccessKey: env.BUNNY_STREAM_READ_ONLY_KEY,
    Accept: 'application/json',
    'Content-Type': contentType
  };
}

export function buildEmbedUrl(videoId: string) {
  const lib = String(env.BUNNY_STREAM_LIBRARY_ID).replace(/[^0-9]/g, '');
  const safeId = String(videoId).replace(/["'\\\s]/g, '').trim();
  return `${env.BUNNY_PLAYER_BASE_URL.replace(/\/$/, '')}/${lib}/${safeId}`;
}

export async function createBunnyVideo(title: string) {
  const response = await fetch(`${apiBase}/library/${env.BUNNY_STREAM_LIBRARY_ID}/videos`, {
    method: 'POST',
    headers: accessKeyHeaders(),
    body: JSON.stringify({ title })
  });

  if (!response.ok) {
    throw new Error(`Bunny create failed: ${response.status}`);
  }

  return response.json() as Promise<{ guid: string }>;
}

export function createTusUploadCredentials(videoId: string): BunnyTusUploadCredentials {
  const expirationTime = Math.floor(Date.now() / 1000) + 24 * 60 * 60;
  const signature = crypto
    .createHash('sha256')
    .update(`${env.BUNNY_STREAM_LIBRARY_ID}${env.BUNNY_STREAM_ACCESS_KEY}${expirationTime}${videoId}`)
    .digest('hex');

  return {
    videoId,
    libraryId: env.BUNNY_STREAM_LIBRARY_ID,
    expirationTime,
    signature,
    endpoint: `${apiBase}/tusupload`,
    embedUrl: buildEmbedUrl(videoId)
  };
}

export async function uploadBunnyVideo(videoId: string, buffer: Buffer, options: BunnyUploadOptions = {}) {
  async function sendUpload(query: URLSearchParams) {
    const url = new URL(`${apiBase}/library/${env.BUNNY_STREAM_LIBRARY_ID}/videos/${videoId}`);
    if ([...query.keys()].length > 0) {
      url.search = query.toString();
    }

    return fetch(url, {
      method: 'PUT',
      headers: accessKeyHeaders('application/octet-stream'),
      body: buffer
    });
  }

  const query = new URLSearchParams();
  if (options.jitEnabled) {
    query.set('jitEnabled', 'true');
  }
  if (options.enabledOutputCodecs) {
    query.set('enabledOutputCodecs', options.enabledOutputCodecs);
  }

  let response = await sendUpload(query);

  if (!response.ok && options.jitEnabled) {
    response = await sendUpload(new URLSearchParams());
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Bunny upload failed: ${response.status} ${text}`);
  }

  return response.json() as Promise<{ success: boolean; message?: string; statusCode?: number }>;
}

export async function getBunnyVideo(videoId: string) {
  const response = await fetch(`${apiBase}/library/${env.BUNNY_STREAM_LIBRARY_ID}/videos/${videoId}`, {
    method: 'GET',
    headers: accessKeyHeaders()
  });

  if (!response.ok) {
    throw new Error(`Bunny get video failed: ${response.status}`);
  }

  return response.json() as Promise<BunnyVideoApiStatus>;
}

export async function getBunnyPlayData(videoId: string) {
  const response = await fetch(`${apiBase}/library/${env.BUNNY_STREAM_LIBRARY_ID}/videos/${videoId}/play`, {
    method: 'GET',
    headers: accessKeyHeaders()
  });

  if (!response.ok) {
    throw new Error(`Bunny play data failed: ${response.status}`);
  }

  return response.json() as Promise<BunnyVideoPlayData>;
}

export async function deleteBunnyVideo(videoId: string) {
  const url = `${apiBase}/library/${env.BUNNY_STREAM_LIBRARY_ID}/videos/${videoId}`;
  const response = await fetch(url, {
    method: 'DELETE',
    headers: accessKeyHeaders()
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Bunny delete failed: ${response.status} ${text}`);
  }

  return true;
}

export function mapBunnyVideoStatus(status: number) {
  if (status === 4) {
    return 'success' as const;
  }

  if (status === 5 || status === 6) {
    return 'failed' as const;
  }

  return 'processing' as const;
}

export function mapWebhookStatus(status: number) {
  if (status === 3 || status === 4) {
    return 'success' as const;
  }

  if (status === 5) {
    return 'failed' as const;
  }

  return 'processing' as const;
}

export function validateWebhookSignature(rawBody: string, headers: Headers | Record<string, string | string[] | undefined>) {
  if (!env.BUNNY_STREAM_READ_ONLY_KEY) {
    return false;
  }

  const signature = getHeader(headers, 'x-bunnystream-signature');
  const version = getHeader(headers, 'x-bunnystream-signature-version');
  const algorithm = getHeader(headers, 'x-bunnystream-signature-algorithm');

  if (version !== 'v1' || algorithm !== 'hmac-sha256' || typeof signature !== 'string') {
    return false;
  }

  const expected = crypto.createHmac('sha256', env.BUNNY_STREAM_READ_ONLY_KEY).update(rawBody, 'utf8').digest('hex');

  if (signature.length !== expected.length || !/^[0-9a-f]+$/.test(signature)) {
    return false;
  }

  return crypto.timingSafeEqual(Buffer.from(signature, 'utf8'), Buffer.from(expected, 'utf8'));
}

function getHeader(headers: Headers | Record<string, string | string[] | undefined>, name: string) {
  if (typeof (headers as Headers).get === 'function') {
    const headerApi = headers as Headers;
    return headerApi.get(name) ?? headerApi.get(name.toLowerCase()) ?? undefined;
  }

  const record = headers as any;
  const value = record[name] ?? record[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}
