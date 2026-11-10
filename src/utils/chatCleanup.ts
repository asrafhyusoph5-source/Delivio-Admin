import {
  db,
  collection,
  doc,
  getDocs,
  deleteDoc,
  writeBatch,
  query,
  where,
  limit,
  Timestamp
} from '../firebase';
import { logAuditEvent } from './audit';

/**
 * Permanently deletes a single chat thread and all its subcollection messages.
 * Writes an entry in auditLogs.
 */
export async function deleteChatThread(
  chatId: string,
  adminProfile?: { uid?: string; name?: string; email?: string } | null
): Promise<{ deletedMessages: number }> {
  try {
    // 1. Fetch all messages in subcollection orderChats/{chatId}/chatMessages
    const messagesRef = collection(db, 'orderChats', chatId, 'chatMessages');
    const msgSnap = await getDocs(messagesRef);
    let messageCount = 0;

    // Delete messages in batches
    if (!msgSnap.empty) {
      let batch = writeBatch(db);
      let countInBatch = 0;

      for (const d of msgSnap.docs) {
        batch.delete(d.ref);
        countInBatch++;
        messageCount++;

        if (countInBatch >= 400) {
          await batch.commit();
          batch = writeBatch(db);
          countInBatch = 0;
        }
      }

      if (countInBatch > 0) {
        await batch.commit();
      }
    }

    // 2. Delete the thread document itself
    const threadRef = doc(db, 'orderChats', chatId);
    await deleteDoc(threadRef);

    // 3. Write audit log
    await logAuditEvent({
      adminId: adminProfile?.uid || 'admin',
      adminName: adminProfile?.name || 'Administrator',
      adminEmail: adminProfile?.email,
      action: 'DELETE_CHAT_THREAD',
      entityType: 'orderChats',
      entityId: chatId,
      details: `Permanently deleted order chat thread ${chatId} (${messageCount} message(s) removed)`
    });

    return { deletedMessages: messageCount };
  } catch (err) {
    console.error(`Failed to delete chat thread ${chatId}:`, err);
    throw err;
  }
}

/**
 * Cleans up up to maxDocs (default 300) expired documents platform-wide
 * (messages first, then threads) whose expireAt is in the past.
 * Used for full-admin login cleanup and manual "Delete all expired chats now" action.
 */
export async function cleanupExpiredChats(
  maxDocs = 300,
  adminProfile?: { uid?: string; name?: string; email?: string } | null
): Promise<{ deletedThreads: number; deletedMessages: number; totalDeleted: number }> {
  let deletedThreads = 0;
  let deletedMessages = 0;
  let totalDeleted = 0;

  try {
    const now = Timestamp.now();
    const nowMs = Date.now();

    // 1. Query expired threads: expireAt <= now
    const expiredThreadsQuery = query(
      collection(db, 'orderChats'),
      where('expireAt', '<=', now),
      limit(50)
    );
    const expiredThreadsSnap = await getDocs(expiredThreadsQuery);

    for (const threadDoc of expiredThreadsSnap.docs) {
      if (totalDeleted >= maxDocs) break;

      const chatId = threadDoc.id;
      const messagesRef = collection(db, 'orderChats', chatId, 'chatMessages');
      const msgSnap = await getDocs(messagesRef);

      if (!msgSnap.empty) {
        let batch = writeBatch(db);
        let inBatch = 0;

        for (const msg of msgSnap.docs) {
          if (totalDeleted >= maxDocs) break;
          batch.delete(msg.ref);
          deletedMessages++;
          totalDeleted++;
          inBatch++;

          if (inBatch >= 400) {
            await batch.commit();
            batch = writeBatch(db);
            inBatch = 0;
          }
        }

        if (inBatch > 0) {
          await batch.commit();
        }
      }

      if (totalDeleted < maxDocs) {
        await deleteDoc(threadDoc.ref);
        deletedThreads++;
        totalDeleted++;
      }
    }

    // 2. Also check active threads for any expired messages (up to remaining quota)
    if (totalDeleted < maxDocs) {
      const activeThreadsSnap = await getDocs(
        query(collection(db, 'orderChats'), limit(30))
      );

      for (const tDoc of activeThreadsSnap.docs) {
        if (totalDeleted >= maxDocs) break;

        const chatId = tDoc.id;
        const expMsgsQuery = query(
          collection(db, 'orderChats', chatId, 'chatMessages'),
          where('expireAt', '<', now),
          limit(Math.min(100, maxDocs - totalDeleted))
        );
        const expMsgsSnap = await getDocs(expMsgsQuery);

        if (!expMsgsSnap.empty) {
          const batch = writeBatch(db);
          for (const msg of expMsgsSnap.docs) {
            batch.delete(msg.ref);
            deletedMessages++;
            totalDeleted++;
          }
          await batch.commit().catch(() => {});
        }

        // If thread itself is expired
        const dt = tDoc.data();
        if (dt.expireAt) {
          const tExpMs = dt.expireAt.toMillis ? dt.expireAt.toMillis() : new Date(dt.expireAt).getTime();
          if (!isNaN(tExpMs) && tExpMs < nowMs && totalDeleted < maxDocs) {
            await deleteDoc(tDoc.ref).catch(() => {});
            deletedThreads++;
            totalDeleted++;
          }
        }
      }
    }

    if (adminProfile && totalDeleted > 0) {
      await logAuditEvent({
        adminId: adminProfile.uid || 'admin',
        adminName: adminProfile.name || 'Administrator',
        adminEmail: adminProfile.email,
        action: 'CLEANUP_EXPIRED_CHATS',
        entityType: 'orderChats',
        entityId: 'batch',
        details: `Deleted ${deletedThreads} expired thread(s) and ${deletedMessages} message(s) (total ${totalDeleted} doc(s))`
      });
    }

    return { deletedThreads, deletedMessages, totalDeleted };
  } catch (err) {
    console.debug('Expired chat cleanup note:', err);
    return { deletedThreads, deletedMessages, totalDeleted };
  }
}

/**
 * Whenever the app loads its list of chat threads (and when the chat screen opens),
 * delete the expired data that belongs to the signed-in user:
 * for each thread I can read, query its chatMessages where expireAt < now (limit 100)
 * and delete them in a batch, then delete the thread itself if its own expireAt < now.
 * Run this at most once every 30 minutes, in the background, and ignore any errors silently.
 * Do not delete anything that is not expired. Never delete threads of other users.
 */
export async function cleanupExpiredThreadData(
  threads: { id: string; expireAt?: any }[],
  force = false
): Promise<void> {
  if (!threads || threads.length === 0) return;

  try {
    const THIRTY_MINUTES_MS = 30 * 60 * 1000;
    const nowMs = Date.now();
    const storageKey = 'delivio_last_thread_cleanup_time';
    const lastRunStr = sessionStorage.getItem(storageKey);
    const lastRun = lastRunStr ? Number(lastRunStr) : 0;

    // Run at most once every 30 minutes unless forced
    if (!force && lastRun && nowMs - lastRun < THIRTY_MINUTES_MS) {
      return;
    }

    sessionStorage.setItem(storageKey, String(nowMs));
    const nowTimestamp = Timestamp.now();

    for (const thread of threads) {
      if (!thread || !thread.id) continue;

      try {
        // Query its chatMessages where expireAt < now (limit 100)
        const msgQuery = query(
          collection(db, 'orderChats', thread.id, 'chatMessages'),
          where('expireAt', '<', nowTimestamp),
          limit(100)
        );
        const msgSnap = await getDocs(msgQuery);

        if (!msgSnap.empty) {
          const batch = writeBatch(db);
          msgSnap.docs.forEach((docSnap) => {
            batch.delete(docSnap.ref);
          });
          await batch.commit().catch(() => {});
        }

        // Then delete the thread itself if its own expireAt < now
        let isThreadExpired = false;
        if (thread.expireAt) {
          const threadExpMs = thread.expireAt.toMillis
            ? thread.expireAt.toMillis()
            : new Date(thread.expireAt).getTime();
          if (!isNaN(threadExpMs) && threadExpMs < nowMs) {
            isThreadExpired = true;
          }
        }

        if (isThreadExpired) {
          await deleteDoc(doc(db, 'orderChats', thread.id)).catch(() => {});
        }
      } catch {
        // Ignore any errors silently
      }
    }
  } catch {
    // Ignore any errors silently
  }
}
