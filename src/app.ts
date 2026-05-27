import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { env, isProduction } from './env.js';
import { clearSessionCookie, hashPassword, requireUser, setSessionCookie, signSession, verifyPassword } from './auth.js';
import { prisma } from './db.js';
import { buildEmbedUrl, createBunnyVideo, createTusUploadCredentials, getBunnyPlayData, getBunnyVideo, mapBunnyVideoStatus, mapWebhookStatus, uploadBunnyVideo, validateWebhookSignature, deleteBunnyVideo } from './services/bunny.js';
import { createFolder, createVideoRecord, getFolderContents, getFolderTree, getVideoById, ensureOwnsFolder, listPendingVideos, updateVideo } from './services/drive.js';
import { rootFolderId, safeTrim } from './utils.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 500 * 1024 * 1024
  }
});

export const app = express();
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDir, '..', '..');

app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());

app.get('/api/health', (_request, response) => {
  response.json({ ok: true });
});

app.post('/api/bunny/webhook', express.raw({ type: 'application/json' }), async (request, response) => {
  const rawBody = request.body instanceof Buffer ? request.body.toString('utf8') : '';

  if (!validateWebhookSignature(rawBody, request.headers)) {
    response.status(401).json({ error: 'Invalid signature' });
    return;
  }

  const payload = JSON.parse(rawBody) as {
    VideoLibraryId: number;
    VideoGuid: string;
    Status: number;
  };

  const video = await prisma.video.findFirst({
    where: {
      bunnyVideoId: payload.VideoGuid,
      bunnyLibraryId: payload.VideoLibraryId
    }
  });

  if (!video) {
    response.status(200).json({ ok: true });
    return;
  }

  const mappedStatus = mapWebhookStatus(payload.Status);
  const finalPatch: Record<string, unknown> = {
    bunnyVideoStatus: payload.Status,
    lastSyncedAt: new Date()
  };

  if (mappedStatus === 'processing') {
    finalPatch.status = 'PROCESSING';
    if (!video.processingStartedAt) {
      finalPatch.processingStartedAt = new Date();
    }
  }

  if (mappedStatus === 'success') {
    finalPatch.status = 'SUCCESS';
    finalPatch.processedAt = new Date();
    try {
      const playData = await getBunnyPlayData(payload.VideoGuid);
      finalPatch.playbackUrl = playData.videoPlaylistUrl ?? playData.fallbackUrl ?? buildEmbedUrl(payload.VideoGuid);
      finalPatch.embedUrl = buildEmbedUrl(payload.VideoGuid);
      finalPatch.thumbnailUrl = playData.thumbnailUrl ?? playData.previewUrl ?? video.thumbnailUrl ?? null;
    } catch {
      finalPatch.embedUrl = buildEmbedUrl(payload.VideoGuid);
    }
  }

  if (mappedStatus === 'failed') {
    finalPatch.status = 'FAILED';
    finalPatch.failedAt = new Date();
  }

  await prisma.video.update({ where: { id: video.id }, data: finalPatch });
  response.json({ ok: true });
});

app.use('/api', express.json({ limit: '2mb' }));

app.post('/api/auth/signup', async (request, response) => {
  const { email, password } = request.body as { email?: string; password?: string };
  const normalizedEmail = safeTrim(email).toLowerCase();

  if (!normalizedEmail || !password || password.length < 8) {
    response.status(400).json({ error: 'Email and password are required' });
    return;
  }

  const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (existing) {
    response.status(409).json({ error: 'Email already exists' });
    return;
  }

  const user = await prisma.user.create({
    data: {
      email: normalizedEmail,
      passwordHash: await hashPassword(password)
    }
  });

  const token = signSession({ userId: user.id, email: user.email });
  setSessionCookie(response, token);
  response.status(201).json({ user: { id: user.id, email: user.email, createdAt: user.createdAt.toISOString() } });
});

app.post('/api/auth/signin', async (request, response) => {
  const { email, password } = request.body as { email?: string; password?: string };
  const normalizedEmail = safeTrim(email).toLowerCase();

  if (!normalizedEmail || !password) {
    response.status(400).json({ error: 'Email and password are required' });
    return;
  }

  const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    response.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  const token = signSession({ userId: user.id, email: user.email });
  setSessionCookie(response, token);
  response.json({ user: { id: user.id, email: user.email, createdAt: user.createdAt.toISOString() } });
});

app.get('/api/auth/me', requireUser, async (request, response) => {
  const user = await prisma.user.findUnique({
    where: { id: request.user!.id },
    select: { id: true, email: true, createdAt: true }
  });

  if (!user) {
    response.status(404).json({ error: 'User not found' });
    return;
  }

  response.json({ user: { ...user, createdAt: user.createdAt.toISOString() } });
});

app.post('/api/auth/logout', (_request, response) => {
  clearSessionCookie(response);
  response.json({ ok: true });
});

app.get('/api/folders/tree', requireUser, async (request, response) => {
  const tree = await getFolderTree(request.user!.id);
  response.json({ tree });
});

app.get('/api/folders/:folderId/contents', requireUser, async (request, response) => {
  const requestedFolderId = readParam(request.params.folderId);
  const folderId: string | null = requestedFolderId && requestedFolderId !== 'root' ? requestedFolderId : null;
  try {
    const contents = await getFolderContents(request.user!.id, folderId);
    response.json(contents);
  } catch {
    response.status(404).json({ error: 'Folder not found' });
  }
});

app.post('/api/folders', requireUser, async (request, response) => {
  const { name, parentId } = request.body as { name?: string; parentId?: string | null };
  const normalizedName = safeTrim(name);

  if (!normalizedName) {
    response.status(400).json({ error: 'Folder name is required' });
    return;
  }

  try {
    const folder = await createFolder(request.user!.id, normalizedName, rootFolderId(parentId));
    response.status(201).json({ folder });
  } catch {
    response.status(400).json({ error: 'Unable to create folder' });
  }
});

app.post('/api/videos/upload-session', requireUser, async (request, response) => {
  const { folderId, title, fileName, mimeType, sizeBytes } = request.body as {
    folderId?: string | null;
    title?: string;
    fileName?: string;
    mimeType?: string;
    sizeBytes?: number;
  };

  const normalizedTitle = safeTrim(title) || safeTrim(fileName)?.replace(/\.[^.]+$/, '') || 'Untitled video';
  const normalizedFileName = safeTrim(fileName) || `${normalizedTitle}.mp4`;
  const normalizedMimeType = safeTrim(mimeType) || 'video/mp4';
  const normalizedSizeBytes = Number.isFinite(sizeBytes) && typeof sizeBytes === 'number' ? Math.max(0, Math.floor(sizeBytes)) : 0;
  const normalizedFolderId = rootFolderId(folderId);

  try {
    if (normalizedFolderId) {
      await ensureOwnsFolder(request.user!.id, normalizedFolderId);
    }

    const record = await createVideoRecord({
      userId: request.user!.id,
      folderId: normalizedFolderId,
      title: normalizedTitle,
      originalFileName: normalizedFileName,
      mimeType: normalizedMimeType,
      sizeBytes: normalizedSizeBytes
    });

    const bunnyVideo = await createBunnyVideo(normalizedTitle);
    const video = await prisma.video.update({
      where: { id: record.id },
      data: {
        bunnyLibraryId: env.BUNNY_STREAM_LIBRARY_ID,
        bunnyVideoId: bunnyVideo.guid,
        status: 'UPLOADING'
      }
    });

    response.status(201).json({
      video: serializeVideo(video),
      upload: createTusUploadCredentials(bunnyVideo.guid)
    });
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : 'Unable to prepare upload' });
  }
});

app.get('/api/videos/:videoId', requireUser, async (request, response) => {
  const videoId = readParam(request.params.videoId);
  if (!videoId) {
    response.status(400).json({ error: 'Video id is required' });
    return;
  }

  const video = await getVideoById(request.user!.id, videoId);

  if (!video) {
    response.status(404).json({ error: 'Video not found' });
    return;
  }

  response.json({ video: serializeVideo(video) });
});

app.post('/api/videos/upload', requireUser, upload.single('file'), async (request, response) => {
  const file = request.file;
  const title = safeTrim(request.body.title) || file?.originalname.replace(/\.[^.]+$/, '') || 'Untitled video';
  const folderId = rootFolderId(request.body.folderId as string | null | undefined);

  if (!file) {
    response.status(400).json({ error: 'A video file is required' });
    return;
  }

  try {
    if (folderId) {
      await ensureOwnsFolder(request.user!.id, folderId);
    }

    const record = await createVideoRecord({
      userId: request.user!.id,
      folderId,
      title,
      originalFileName: file.originalname,
      mimeType: file.mimetype,
      sizeBytes: file.size
    });

    const bunnyVideo = await createBunnyVideo(title);

    const video = await prisma.video.update({
      where: { id: record.id },
      data: {
        bunnyLibraryId: env.BUNNY_STREAM_LIBRARY_ID,
        bunnyVideoId: bunnyVideo.guid,
        status: 'UPLOADING'
      }
    });

    void processBunnyUpload({
      videoId: record.id,
      bunnyVideoId: bunnyVideo.guid,
      buffer: file.buffer
    });

    response.status(202).json({ video: serializeVideo(video) });
    return;
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : 'Unable to upload video' });
  }
});

app.get('/api/videos/:videoId/play', requireUser, async (request, response) => {
  const videoId = readParam(request.params.videoId);
  if (!videoId) {
    response.status(400).json({ error: 'Video id is required' });
    return;
  }

  const video = await getVideoById(request.user!.id, videoId);

  if (!video || !video.bunnyVideoId) {
    response.status(404).json({ error: 'Video not found' });
    return;
  }

  const embedUrl = video.embedUrl ?? buildEmbedUrl(video.bunnyVideoId);
  const playbackUrl = video.playbackUrl ?? embedUrl;

  response.json({
    video: serializeVideo(video),
    playbackUrl,
    embedUrl,
    thumbnailUrl: video.thumbnailUrl,
    ready: video.status === 'SUCCESS'
  });
});

app.post('/api/videos/:videoId/sync', requireUser, async (request, response) => {
  const videoId = readParam(request.params.videoId);
  if (!videoId) {
    response.status(400).json({ error: 'Video id is required' });
    return;
  }

  const video = await getVideoById(request.user!.id, videoId);

  if (!video || !video.bunnyVideoId) {
    response.status(404).json({ error: 'Video not found' });
    return;
  }

  const synced = await syncVideoFromBunny(video.id);
  response.json({ video: serializeVideo(synced) });
});

app.delete('/api/videos/:videoId', requireUser, async (request, response) => {
  const videoId = readParam(request.params.videoId);
  if (!videoId) {
    response.status(400).json({ error: 'Video id is required' });
    return;
  }

  const video = await getVideoById(request.user!.id, videoId);
  if (!video) {
    response.status(404).json({ error: 'Video not found' });
    return;
  }

  try {
    if (video.bunnyVideoId) {
      try {
        await deleteBunnyVideo(video.bunnyVideoId);
      } catch {
        // ignore remote delete errors; continue to remove local record
      }
    }

    await prisma.video.delete({ where: { id: video.id } });
    response.json({ ok: true });
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : 'Unable to delete video' });
  }
});

app.get('/api/content', requireUser, async (request, response) => {
  const folderId = request.query.folderId ? String(request.query.folderId) : null;
  try {
    const contents = await getFolderContents(request.user!.id, folderId === 'root' ? null : folderId);
    response.json(contents);
  } catch {
    response.status(404).json({ error: 'Folder not found' });
  }
});

const clientDist = path.resolve(projectRoot, 'frontend', 'dist');
const clientIndex = path.join(clientDist, 'index.html');

if (fs.existsSync(clientIndex)) {
  app.use(express.static(clientDist));
  app.get(/^(?!\/api).*/, (_request, response) => {
    response.sendFile(clientIndex);
  });
}

async function syncVideoFromBunny(videoId: string) {
  const video = await prisma.video.findUnique({ where: { id: videoId } });
  if (!video || !video.bunnyVideoId) {
    throw new Error('Video not found');
  }

  const bunnyVideo = await getBunnyVideo(video.bunnyVideoId);
  const mappedStatus = mapBunnyVideoStatus(bunnyVideo.status);
  const embedUrl = buildEmbedUrl(video.bunnyVideoId);

  const update: Record<string, unknown> = {
    bunnyVideoStatus: bunnyVideo.status,
    bunnyEncodeProgress: bunnyVideo.encodeProgress ?? 0,
    lastSyncedAt: new Date(),
    embedUrl
  };

  if (mappedStatus === 'processing') {
    update.status = 'PROCESSING';
    if (!video.processingStartedAt) {
      update.processingStartedAt = new Date();
    }
  }

  if (mappedStatus === 'success') {
    update.status = 'SUCCESS';
    update.processedAt = new Date();
    try {
      const playData = await getBunnyPlayData(video.bunnyVideoId);
      update.playbackUrl = playData.videoPlaylistUrl ?? playData.fallbackUrl ?? embedUrl;
      update.thumbnailUrl = playData.thumbnailUrl ?? playData.previewUrl ?? video.thumbnailUrl ?? null;
    } catch {
      update.playbackUrl = embedUrl;
    }
  }

  if (mappedStatus === 'failed') {
    update.status = 'FAILED';
    update.failedAt = new Date();
  }

  return prisma.video.update({ where: { id: video.id }, data: update });
}

async function processBunnyUpload({ videoId, bunnyVideoId, buffer }: { videoId: string; bunnyVideoId: string; buffer: Buffer }) {
  try {
    await uploadBunnyVideo(bunnyVideoId, buffer, { jitEnabled: true, enabledOutputCodecs: 'x264' });
    const playData = await getBunnyPlayData(bunnyVideoId);
    const embedUrl = buildEmbedUrl(bunnyVideoId);

    await prisma.video.update({
      where: { id: videoId },
      data: {
        status: 'PROCESSING',
        uploadedAt: new Date(),
        processingStartedAt: new Date(),
        bunnyVideoStatus: 1,
        bunnyEncodeProgress: 0,
        embedUrl,
        playbackUrl: playData.videoPlaylistUrl ?? playData.fallbackUrl ?? embedUrl,
        thumbnailUrl: playData.thumbnailUrl ?? playData.previewUrl ?? null,
        lastSyncedAt: new Date(),
        errorMessage: null
      }
    });
  } catch (uploadError) {
    await prisma.video.update({
      where: { id: videoId },
      data: {
        status: 'FAILED',
        failedAt: new Date(),
        errorMessage: uploadError instanceof Error ? uploadError.message : 'Upload failed',
        lastSyncedAt: new Date()
      }
    });
  }
}

function readParam(value: string | string[] | undefined) {
  return typeof value === 'string' ? value : undefined;
}

function serializeVideo(video: {
  id: string;
  userId: string;
  folderId: string | null;
  title: string;
  originalFileName: string;
  mimeType: string;
  sizeBytes: number;
  status: string;
  bunnyLibraryId: number;
  bunnyVideoId: string | null;
  bunnyVideoStatus: number | null;
  bunnyEncodeProgress: number | null;
  playbackUrl: string | null;
  embedUrl: string | null;
  thumbnailUrl: string | null;
  errorMessage: string | null;
  uploadedAt: Date | null;
  processingStartedAt: Date | null;
  processedAt: Date | null;
  failedAt: Date | null;
  lastSyncedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...video,
    uploadedAt: video.uploadedAt?.toISOString() ?? null,
    processingStartedAt: video.processingStartedAt?.toISOString() ?? null,
    processedAt: video.processedAt?.toISOString() ?? null,
    failedAt: video.failedAt?.toISOString() ?? null,
    lastSyncedAt: video.lastSyncedAt?.toISOString() ?? null,
    createdAt: video.createdAt.toISOString(),
    updatedAt: video.updatedAt.toISOString()
  };
}

export async function runBunnyPollingSync() {
  const pending = await listPendingVideos(12);
  for (const video of pending) {
    try {
      if (video.bunnyVideoId) {
        await syncVideoFromBunny(video.id);
      }
    } catch {
      // The webhook remains the primary path; polling is a best-effort fallback.
    }
  }
}
