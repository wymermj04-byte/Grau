import { supabase } from '@/lib/supabase';

export type AnnouncementAudience = 'Everyone' | 'Kids' | 'Adults';
export type AnnouncementAudienceInput = 'all' | 'kids' | 'adults';

export type Announcement = {
  id: number;
  title: string;
  body: string;
  audience: AnnouncementAudience;
  createdAt: string;
  publishedAt: string | null;
};

export type AnnouncementReadReceipt = {
  announcementId: number;
  readAt: string;
};

type AnnouncementRow = {
  id: number | string;
  title: string;
  body: string;
  audience: string;
  created_at: string;
  published_at: string | null;
};

type AnnouncementReadReceiptRow = {
  announcement_id: number | string;
  read_at: string;
};

export class AnnouncementSessionError extends Error {
  constructor() {
    super('Your session has ended. Please sign in again.');
    this.name = 'AnnouncementSessionError';
  }
}

export class AnnouncementDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnnouncementDataError';
  }
}

async function requireAuthenticatedSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (!data.session) throw new AnnouncementSessionError();
  return data.session;
}

function asAnnouncementId(value: number | string, fieldName: string) {
  const id = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new AnnouncementDataError(`The announcement response has an invalid ${fieldName}.`);
  }
  return id;
}

function asAudience(value: string): AnnouncementAudience {
  if (value === 'all') return 'Everyone';
  if (value === 'kids') return 'Kids';
  if (value === 'adults') return 'Adults';
  throw new AnnouncementDataError('The announcement response has an unsupported audience.');
}

function toAnnouncement(row: AnnouncementRow): Announcement {
  if (typeof row.title !== 'string' || typeof row.body !== 'string' || typeof row.created_at !== 'string') {
    throw new AnnouncementDataError('The announcement response is incomplete.');
  }

  return {
    id: asAnnouncementId(row.id, 'id'),
    title: row.title,
    body: row.body,
    audience: asAudience(row.audience),
    createdAt: row.created_at,
    publishedAt: row.published_at,
  };
}

export async function listAnnouncements(): Promise<Announcement[]> {
  await requireAuthenticatedSession();

  const { data, error } = await supabase
    .from('academy_announcements')
    .select('id, title, body, audience, created_at, published_at')
    .is('retracted_at', null)
    .order('published_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false });

  if (error) throw error;
  return ((data ?? []) as AnnouncementRow[]).map(toAnnouncement);
}

export async function createAnnouncement(
  title: string,
  message: string,
  audience: AnnouncementAudienceInput,
): Promise<Announcement> {
  await requireAuthenticatedSession();

  const { data, error } = await supabase.rpc('create_academy_announcement', {
    p_title: title,
    p_message: message,
    p_audience: audience,
  });

  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new AnnouncementDataError('The announcement was created without a returned record.');
  return toAnnouncement(row as AnnouncementRow);
}

export async function markAnnouncementRead(announcementId: number): Promise<void> {
  await requireAuthenticatedSession();

  const { error } = await supabase.rpc('mark_announcement_read', {
    p_announcement_id: announcementId,
  });

  if (error) throw error;
}

export async function listMyReadReceipts(): Promise<AnnouncementReadReceipt[]> {
  const session = await requireAuthenticatedSession();

  const { data, error } = await supabase
    .from('academy_announcement_reads')
    .select('announcement_id, read_at')
    .eq('user_id', session.user.id)
    .order('read_at', { ascending: false });

  if (error) throw error;
  return ((data ?? []) as AnnouncementReadReceiptRow[]).map((receipt) => {
    if (typeof receipt.read_at !== 'string') {
      throw new AnnouncementDataError('The announcement read receipt response is incomplete.');
    }
    return {
      announcementId: asAnnouncementId(receipt.announcement_id, 'read receipt announcement ID'),
      readAt: receipt.read_at,
    };
  });
}
