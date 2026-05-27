import type { Folder, User, Video } from '@prisma/client';

export type AuthedUser = Pick<User, 'id' | 'email' | 'createdAt'>;

export type FolderTreeNode = {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
  children: FolderTreeNode[];
};

export type FolderContentsResponse = {
  currentFolder: { id: string | 'root'; name: string };
  breadcrumb: Array<{ id: string | 'root'; name: string }>;
  folders: Folder[];
  videos: Video[];
};

export type BunnyVideoStatus = 'uploading' | 'processing' | 'success' | 'failed';
