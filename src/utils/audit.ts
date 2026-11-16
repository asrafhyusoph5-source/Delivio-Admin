import { db, collection, addDoc } from '../firebase';
import { nowTs } from './date';

export async function logAuditEvent(params: {
  adminId: string;
  adminName: string;
  adminEmail?: string;
  action: string;
  entityType: string;
  entityId: string;
  details?: string;
  oldValue?: any;
  newValue?: any;
  reason?: string;
}) {
  try {
    const colRef = collection(db, 'auditLogs');
    await addDoc(colRef, {
      ...params,
      timestamp: nowTs()
    });
  } catch (err) {
    console.error('Failed to write audit log:', err);
  }
}

export async function logEditHistory(params: {
  entityType: 'customer' | 'merchant' | 'rider' | string;
  entityId: string;
  field: string;
  oldValue: any;
  newValue: any;
  editedBy: string;
  editedByName: string;
}) {
  try {
    const colRef = collection(db, 'editHistory');
    await addDoc(colRef, {
      ...params,
      at: nowTs()
    });
  } catch (err) {
    console.error('Failed to write edit history:', err);
  }
}
