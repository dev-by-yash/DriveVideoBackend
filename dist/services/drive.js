import { prisma } from '../db.js';
import { rootFolderId } from '../utils.js';
export async function ensureOwnsFolder(userId, folderId) {
    if (!folderId) {
        return null;
    }
    const folder = await prisma.folder.findFirst({ where: { id: folderId, userId } });
    if (!folder) {
        throw new Error('Folder not found');
    }
    return folder;
}
export async function createFolder(userId, name, parentId) {
    await ensureOwnsFolder(userId, parentId);
    return prisma.folder.create({
        data: {
            userId,
            name,
            parentId
        }
    });
}
function buildTree(folders) {
    const nodes = new Map();
    const roots = [];
    for (const folder of folders) {
        nodes.set(folder.id, {
            id: folder.id,
            name: folder.name,
            parentId: folder.parentId,
            createdAt: folder.createdAt.toISOString(),
            updatedAt: folder.updatedAt.toISOString(),
            children: []
        });
    }
    for (const folder of folders) {
        const node = nodes.get(folder.id);
        if (!node) {
            continue;
        }
        if (folder.parentId) {
            const parent = nodes.get(folder.parentId);
            if (parent) {
                parent.children.push(node);
            }
        }
        else {
            roots.push(node);
        }
    }
    const sortNodes = (items) => {
        items.sort((left, right) => left.name.localeCompare(right.name));
        for (const item of items) {
            sortNodes(item.children);
        }
    };
    sortNodes(roots);
    return roots;
}
async function buildBreadcrumb(userId, folderId) {
    const breadcrumb = [{ id: 'root', name: 'All files' }];
    if (!folderId) {
        return breadcrumb;
    }
    const chain = [];
    let currentId = folderId;
    while (currentId) {
        const currentFolder = await prisma.folder.findFirst({ where: { id: currentId, userId } });
        if (!currentFolder) {
            throw new Error('Folder not found');
        }
        chain.push(currentFolder);
        currentId = currentFolder.parentId;
    }
    for (const folder of chain.reverse()) {
        breadcrumb.push({ id: folder.id, name: folder.name });
    }
    return breadcrumb;
}
export async function getFolderContents(userId, folderId) {
    const normalizedFolderId = rootFolderId(folderId);
    if (normalizedFolderId) {
        await ensureOwnsFolder(userId, normalizedFolderId);
    }
    const [folders, videos, breadcrumb] = await Promise.all([
        prisma.folder.findMany({
            where: { userId, parentId: normalizedFolderId },
            orderBy: { name: 'asc' }
        }),
        prisma.video.findMany({
            where: { userId, folderId: normalizedFolderId },
            orderBy: { createdAt: 'desc' }
        }),
        buildBreadcrumb(userId, normalizedFolderId)
    ]);
    return {
        currentFolder: normalizedFolderId ? { id: normalizedFolderId, name: breadcrumb.at(-1)?.name ?? 'Folder' } : { id: 'root', name: 'All files' },
        breadcrumb,
        folders,
        videos
    };
}
export async function getFolderTree(userId) {
    const folders = await prisma.folder.findMany({
        where: { userId },
        orderBy: { name: 'asc' }
    });
    return buildTree(folders);
}
export async function createVideoRecord(data) {
    return prisma.video.create({
        data: {
            ...data,
            status: 'UPLOADING',
            bunnyLibraryId: 0
        }
    });
}
export async function updateVideo(videoId, data) {
    return prisma.video.update({ where: { id: videoId }, data });
}
export async function getVideoById(userId, videoId) {
    return prisma.video.findFirst({ where: { id: videoId, userId } });
}
export async function listPendingVideos(limit = 20) {
    return prisma.video.findMany({
        where: {
            status: { in: ['UPLOADING', 'PROCESSING'] }
        },
        orderBy: { updatedAt: 'asc' },
        take: limit
    });
}
