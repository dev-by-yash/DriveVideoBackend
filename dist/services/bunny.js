import crypto from 'crypto';
import { env } from '../env.js';
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
export function buildEmbedUrl(videoId) {
    return `${env.BUNNY_PLAYER_BASE_URL.replace(/\/$/, '')}/${env.BUNNY_STREAM_LIBRARY_ID}/${videoId}`;
}
export async function createBunnyVideo(title) {
    const response = await fetch(`${apiBase}/library/${env.BUNNY_STREAM_LIBRARY_ID}/videos`, {
        method: 'POST',
        headers: accessKeyHeaders(),
        body: JSON.stringify({ title })
    });
    if (!response.ok) {
        throw new Error(`Bunny create failed: ${response.status}`);
    }
    return response.json();
}
export function createTusUploadCredentials(videoId) {
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
export async function uploadBunnyVideo(videoId, buffer, options = {}) {
    async function sendUpload(query) {
        const url = new URL(`${apiBase}/library/${env.BUNNY_STREAM_LIBRARY_ID}/videos/${videoId}`);
        if ([...query.keys()].length > 0) {
            url.search = query.toString();
        }
        return fetch(url, {
            method: 'PUT',
            headers: accessKeyHeaders('application/octet-stream'),
            body: new Uint8Array(buffer)
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
    return response.json();
}
export async function getBunnyVideo(videoId) {
    const response = await fetch(`${apiBase}/library/${env.BUNNY_STREAM_LIBRARY_ID}/videos/${videoId}`, {
        method: 'GET',
        headers: accessKeyHeaders()
    });
    if (!response.ok) {
        throw new Error(`Bunny get video failed: ${response.status}`);
    }
    return response.json();
}
export async function getBunnyPlayData(videoId) {
    const response = await fetch(`${apiBase}/library/${env.BUNNY_STREAM_LIBRARY_ID}/videos/${videoId}/play`, {
        method: 'GET',
        headers: accessKeyHeaders()
    });
    if (!response.ok) {
        throw new Error(`Bunny play data failed: ${response.status}`);
    }
    return response.json();
}
export async function deleteBunnyVideo(videoId) {
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
export function mapBunnyVideoStatus(status) {
    if (status === 4) {
        return 'success';
    }
    if (status === 5 || status === 6) {
        return 'failed';
    }
    return 'processing';
}
export function mapWebhookStatus(status) {
    if (status === 3 || status === 4) {
        return 'success';
    }
    if (status === 5) {
        return 'failed';
    }
    return 'processing';
}
export function validateWebhookSignature(rawBody, headers) {
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
function getHeader(headers, name) {
    if (typeof headers.get === 'function') {
        const headerApi = headers;
        return headerApi.get(name) ?? headerApi.get(name.toLowerCase()) ?? undefined;
    }
    const record = headers;
    const value = record[name] ?? record[name.toLowerCase()];
    return Array.isArray(value) ? value[0] : value;
}
