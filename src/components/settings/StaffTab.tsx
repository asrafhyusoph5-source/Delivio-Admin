import React, { useState, useEffect } from 'react';
import {
  db,
  collection,
  getDocs,
  doc,
  setDoc,
  deleteDoc,
  updateDoc,
  Timestamp,
  query,
  limit
} from '../../firebase';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { logAuditEvent } from '../../utils/audit';
import { formatTimestamp } from '../../utils/date';
import type { StaffInvite, UserProfile, AdminRole } from '../../types';
import {
  Users,
  UserPlus,
  Mail,
  Shield,
  ShieldCheck,
  ShieldAlert,
  Trash2,
  Ban,
  CheckCircle2,
  Clock,
  Loader2,
  AlertCircle,
  Sparkles,
  Headphones,
  Coins
} from 'lucide-react';
import { ConfirmationModal } from '../common/ConfirmationModal';

export const StaffTab: React.FC = () => {
  const { adminProfile, isFullAdmin } = useAuth();
  const { showSuccess, showError } = useToast();

  const [staffUsers, setStaffUsers] = useState<UserProfile[]>([]);
  const [invites, setInvites] = useState<StaffInvite[]>([]);
  const [loading, setLoading] = useState(true);

  // Invite modal
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<AdminRole>('support');
  const [inviting, setInviting] = useState(false);

  // Suspend / Reactivate action modal
  const [suspendModalOpen, setSuspendModalOpen] = useState(false);
  const [targetStaff, setTargetStaff] = useState<UserProfile | null>(null);
  const [actionType, setActionType] = useState<'suspend' | 'reactivate'>('suspend');
  const [actionReason, setActionReason] = useState('');
  const [processingAction, setProcessingAction] = useState(false);

  // Revoke invite confirmation
  const [revokeModalOpen, setRevokeModalOpen] = useState(false);
  const [inviteToRevoke, setInviteToRevoke] = useState<StaffInvite | null>(null);

  const loadStaffData = async () => {
    try {
      setLoading(true);
      // Fetch users with role admin or subadmin
      const usersSnap = await getDocs(query(collection(db, 'users'), limit(500)));
      const staffList: UserProfile[] = [];
      usersSnap.forEach((docSnap) => {
        const d = docSnap.data();
        const role = String(d.role || '').toLowerCase();
        if (role === 'admin' || role === 'subadmin') {
          staffList.push({
            uid: docSnap.id,
            role,
            adminRole: d.adminRole || (role === 'admin' ? 'admin' : 'support'),
            email: d.email || '',
            name: d.name || 'Staff Member',
            phone: d.phone || '',
            status: d.status || 'active',
            adminNote: d.adminNote || '',
            createdAt: d.createdAt || null
          });
        }
      });
      setStaffUsers(staffList);

      // Fetch pending staffInvites
      const invitesSnap = await getDocs(collection(db, 'staffInvites'));
      const inviteList: StaffInvite[] = [];
      invitesSnap.forEach((docSnap) => {
        const d = docSnap.data();
        inviteList.push({
          id: docSnap.id,
          email: docSnap.id,
          adminRole: d.adminRole || 'support',
          invitedBy: d.invitedBy || 'Admin',
          createdAt: d.createdAt
        });
      });
      setInvites(inviteList);
    } catch (err: any) {
      showError(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStaffData();
  }, []);

  const handleSendInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = inviteEmail.trim().toLowerCase();
    if (!cleanEmail) return;

    try {
      setInviting(true);
      const inviteRef = doc(db, 'staffInvites', cleanEmail);
      const newInvite: StaffInvite = {
        email: cleanEmail,
        adminRole: inviteRole,
        invitedBy: adminProfile?.email || 'admin',
        createdAt: Timestamp.now()
      };

      await setDoc(inviteRef, newInvite);

      await logAuditEvent({
        adminId: adminProfile?.uid || 'admin',
        adminName: adminProfile?.name || 'Administrator',
        adminEmail: adminProfile?.email,
        action: 'INVITE_STAFF',
        entityType: 'staffInvite',
        entityId: cleanEmail,
        details: `Invited ${cleanEmail} as ${inviteRole.toUpperCase()} sub-admin`
      });

      showSuccess(`Invitation created for ${cleanEmail}! They can now create an account on the login page.`);
      setInviteEmail('');
      setInviteRole('support');
      setInviteModalOpen(false);
      loadStaffData();
    } catch (err: any) {
      showError(err);
    } finally {
      setInviting(false);
    }
  };

  const handleRevokeInvite = async () => {
    if (!inviteToRevoke) return;
    try {
      const emailLower = inviteToRevoke.email.toLowerCase();
      await deleteDoc(doc(db, 'staffInvites', emailLower));

      await logAuditEvent({
        adminId: adminProfile?.uid || 'admin',
        adminName: adminProfile?.name || 'Administrator',
        adminEmail: adminProfile?.email,
        action: 'REVOKE_STAFF_INVITE',
        entityType: 'staffInvite',
        entityId: emailLower,
        details: `Revoked pending staff invite for ${emailLower}`
      });

      showSuccess(`Invitation for ${emailLower} has been revoked.`);
      setRevokeModalOpen(false);
      setInviteToRevoke(null);
      loadStaffData();
    } catch (err: any) {
      showError(err);
    }
  };

  const handleConfirmStatusAction = async () => {
    if (!targetStaff) return;
    if (!isFullAdmin) {
      showError('Only full administrators have permission to suspend or reactivate staff accounts.');
      return;
    }

    try {
      setProcessingAction(true);
      const newStatus = actionType === 'suspend' ? 'suspended' : 'active';
      const userRef = doc(db, 'users', targetStaff.uid);

      await updateDoc(userRef, {
        status: newStatus,
        adminNote: actionReason.trim() ? `${actionType.toUpperCase()}: ${actionReason.trim()}` : targetStaff.adminNote || '',
        updatedAt: Timestamp.now()
      });

      await logAuditEvent({
        adminId: adminProfile?.uid || 'admin',
        adminName: adminProfile?.name || 'Administrator',
        adminEmail: adminProfile?.email,
        action: actionType === 'suspend' ? 'SUSPEND_STAFF' : 'REACTIVATE_STAFF',
        entityType: 'user',
        entityId: targetStaff.uid,
        details: `${actionType === 'suspend' ? 'Suspended' : 'Reactivated'} staff member ${targetStaff.email} (${targetStaff.name}). Reason: ${actionReason || 'None provided'}`
      });

      showSuccess(`Staff account for ${targetStaff.email} is now ${newStatus}.`);
      setSuspendModalOpen(false);
      setTargetStaff(null);
      setActionReason('');
      loadStaffData();
    } catch (err: any) {
      showError(err);
    } finally {
      setProcessingAction(false);
    }
  };

  const getRoleBadge = (role?: AdminRole | string) => {
    switch (role) {
      case 'admin':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-black bg-amber-400 text-black shadow-xs">
            <ShieldCheck className="w-3.5 h-3.5" /> Full Admin
          </span>
        );
      case 'finance':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-extrabold bg-blue-100 text-blue-900 dark:bg-blue-950/70 dark:text-blue-300 border border-blue-300 dark:border-blue-700">
            <Coins className="w-3.5 h-3.5" /> Finance
          </span>
        );
      case 'support':
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-extrabold bg-purple-100 text-purple-900 dark:bg-purple-950/70 dark:text-purple-300 border border-purple-300 dark:border-purple-700">
            <Headphones className="w-3.5 h-3.5" /> Support
          </span>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* Overview Banner */}
      <div className="p-5 rounded-3xl bg-amber-50/70 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/50 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-amber-600 shrink-0" />
            <h3 className="font-extrabold text-base text-gray-900 dark:text-white">
              Staff & Sub-Admin Role Management
            </h3>
          </div>
          <p className="text-xs text-gray-600 dark:text-zinc-300 max-w-2xl leading-relaxed">
            Invite team members with role-based access. <strong>Support</strong> can view tickets, orders, and inbox; <strong>Finance</strong> can manage wallets, remittances, payouts, and reports; <strong>Admin</strong> has unrestricted control. <em>Only full administrators can change settings or suspend accounts.</em>
          </p>
        </div>

        <button
          type="button"
          onClick={() => setInviteModalOpen(true)}
          className="delivio-btn-yellow px-4 py-2.5 rounded-2xl text-xs font-black flex items-center gap-2 shadow-md shrink-0 self-start sm:self-auto"
        >
          <UserPlus className="w-4 h-4" />
          <span>Invite Staff Member</span>
        </button>
      </div>

      {/* Role Breakdown Reference Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="p-4 rounded-2xl bg-white dark:bg-zinc-850 border border-purple-200 dark:border-purple-900/50 shadow-2xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black text-purple-700 dark:text-purple-300 uppercase tracking-wider flex items-center gap-1.5">
              <Headphones className="w-4 h-4" /> Support Role
            </span>
            <span className="text-[10px] bg-purple-100 dark:bg-purple-950 text-purple-800 dark:text-purple-300 px-2 py-0.5 rounded-md font-bold">
              Sub-Admin
            </span>
          </div>
          <p className="text-xs text-gray-600 dark:text-zinc-400">
            Dedicated customer and driver care access. Allowed pages:
          </p>
          <div className="flex flex-wrap gap-1 pt-1">
            <span className="px-2 py-0.5 rounded-md bg-gray-100 dark:bg-zinc-800 text-[11px] font-semibold text-gray-700 dark:text-zinc-300">
              Support Tickets
            </span>
            <span className="px-2 py-0.5 rounded-md bg-gray-100 dark:bg-zinc-800 text-[11px] font-semibold text-gray-700 dark:text-zinc-300">
              Live Orders View
            </span>
            <span className="px-2 py-0.5 rounded-md bg-gray-100 dark:bg-zinc-800 text-[11px] font-semibold text-gray-700 dark:text-zinc-300">
              Inbox Broadcasts
            </span>
            <span className="px-2 py-0.5 rounded-md bg-gray-100 dark:bg-zinc-800 text-[11px] font-semibold text-gray-700 dark:text-zinc-300">
              Fraud Flags
            </span>
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-zinc-850 border border-blue-200 dark:border-blue-900/50 shadow-2xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black text-blue-700 dark:text-blue-300 uppercase tracking-wider flex items-center gap-1.5">
              <Coins className="w-4 h-4" /> Finance Role
            </span>
            <span className="text-[10px] bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-300 px-2 py-0.5 rounded-md font-bold">
              Sub-Admin
            </span>
          </div>
          <p className="text-xs text-gray-600 dark:text-zinc-400">
            Accounting, remittance, and ledger management. Allowed pages:
          </p>
          <div className="flex flex-wrap gap-1 pt-1">
            <span className="px-2 py-0.5 rounded-md bg-gray-100 dark:bg-zinc-800 text-[11px] font-semibold text-gray-700 dark:text-zinc-300">
              Wallet Transfers
            </span>
            <span className="px-2 py-0.5 rounded-md bg-gray-100 dark:bg-zinc-800 text-[11px] font-semibold text-gray-700 dark:text-zinc-300">
              Merchant Remittances
            </span>
            <span className="px-2 py-0.5 rounded-md bg-gray-100 dark:bg-zinc-800 text-[11px] font-semibold text-gray-700 dark:text-zinc-300">
              Driver Payouts
            </span>
            <span className="px-2 py-0.5 rounded-md bg-gray-100 dark:bg-zinc-800 text-[11px] font-semibold text-gray-700 dark:text-zinc-300">
              Financial Reports
            </span>
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-zinc-850 border border-amber-300 dark:border-amber-800/80 shadow-2xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black text-amber-700 dark:text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4" /> Full Administrator
            </span>
            <span className="text-[10px] bg-amber-400 text-black px-2 py-0.5 rounded-md font-extrabold">
              Master Admin
            </span>
          </div>
          <p className="text-xs text-gray-600 dark:text-zinc-400">
            Unrestricted administrative control across the entire platform:
          </p>
          <div className="flex flex-wrap gap-1 pt-1">
            <span className="px-2 py-0.5 rounded-md bg-amber-100 dark:bg-amber-950/60 text-[11px] font-semibold text-amber-900 dark:text-amber-300">
              Platform Settings
            </span>
            <span className="px-2 py-0.5 rounded-md bg-amber-100 dark:bg-amber-950/60 text-[11px] font-semibold text-amber-900 dark:text-amber-300">
              Suspend / Ban Accounts
            </span>
            <span className="px-2 py-0.5 rounded-md bg-amber-100 dark:bg-amber-950/60 text-[11px] font-semibold text-amber-900 dark:text-amber-300">
              All Operating Tools
            </span>
          </div>
        </div>
      </div>

      {/* Pending Invites List */}
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-3xl p-5 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Mail className="w-4 h-4 text-amber-500" />
            <h4 className="font-extrabold text-sm text-gray-900 dark:text-white">
              Pending Staff Invitations ({invites.length})
            </h4>
          </div>
          <span className="text-[11px] text-gray-400">
            Stored in <code className="font-mono text-amber-600 dark:text-amber-400">staffInvites/{'{email}'}</code>
          </span>
        </div>

        {invites.length === 0 ? (
          <div className="py-6 text-center text-xs text-gray-400 border border-dashed border-gray-200 dark:border-zinc-800 rounded-2xl">
            No pending staff invites. Click "Invite Staff Member" above to invite someone.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-50 dark:bg-zinc-850 uppercase font-bold text-gray-500 dark:text-zinc-400 border-b border-gray-200 dark:border-zinc-800">
                <tr>
                  <th className="px-4 py-3">Invited Email</th>
                  <th className="px-4 py-3">Assigned Role</th>
                  <th className="px-4 py-3">Invited By</th>
                  <th className="px-4 py-3">Created</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-zinc-800 font-medium">
                {invites.map((inv) => (
                  <tr key={inv.email} className="hover:bg-gray-50/50 dark:hover:bg-zinc-850/50">
                    <td className="px-4 py-3 font-mono font-bold text-gray-900 dark:text-white">
                      {inv.email}
                    </td>
                    <td className="px-4 py-3">{getRoleBadge(inv.adminRole)}</td>
                    <td className="px-4 py-3 text-gray-600 dark:text-zinc-300">{inv.invitedBy}</td>
                    <td className="px-4 py-3 text-gray-500 dark:text-zinc-400">
                      {formatTimestamp(inv.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => {
                          setInviteToRevoke(inv);
                          setRevokeModalOpen(true);
                        }}
                        className="px-2.5 py-1 rounded-lg text-xs font-bold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
                      >
                        Revoke Invite
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Active Staff List */}
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-3xl p-5 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-emerald-500" />
            <h4 className="font-extrabold text-sm text-gray-900 dark:text-white">
              Active Staff & Administrators ({staffUsers.length})
            </h4>
          </div>
          <span className="text-[11px] text-gray-400">
            Stored in <code className="font-mono text-amber-600 dark:text-amber-400">users/{'{uid}'}</code> with role subadmin / admin
          </span>
        </div>

        {loading ? (
          <div className="py-12 flex justify-center text-amber-500">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        ) : staffUsers.length === 0 ? (
          <div className="py-8 text-center text-xs text-gray-400">
            No staff records found.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-50 dark:bg-zinc-850 uppercase font-bold text-gray-500 dark:text-zinc-400 border-b border-gray-200 dark:border-zinc-800">
                <tr>
                  <th className="px-4 py-3">Staff Name</th>
                  <th className="px-4 py-3">Email Address</th>
                  <th className="px-4 py-3">System Role</th>
                  <th className="px-4 py-3">Account Status</th>
                  <th className="px-4 py-3">Created</th>
                  <th className="px-4 py-3 text-right">Admin Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-zinc-800 font-medium">
                {staffUsers.map((member) => (
                  <tr key={member.uid} className="hover:bg-gray-50/50 dark:hover:bg-zinc-850/50">
                    <td className="px-4 py-3">
                      <div className="font-bold text-gray-900 dark:text-white">{member.name}</div>
                      <div className="text-[10px] font-mono text-gray-400">{member.uid}</div>
                    </td>
                    <td className="px-4 py-3 font-mono text-gray-800 dark:text-zinc-200">
                      {member.email}
                    </td>
                    <td className="px-4 py-3">{getRoleBadge(member.adminRole)}</td>
                    <td className="px-4 py-3">
                      {member.status === 'suspended' ? (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300 border border-red-300">
                          Suspended
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-300">
                          Active
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-500 dark:text-zinc-400">
                      {formatTimestamp(member.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {member.uid === adminProfile?.uid ? (
                        <span className="text-[11px] text-gray-400 italic">You</span>
                      ) : isFullAdmin ? (
                        member.status === 'suspended' ? (
                          <button
                            type="button"
                            onClick={() => {
                              setTargetStaff(member);
                              setActionType('reactivate');
                              setSuspendModalOpen(true);
                            }}
                            className="px-2.5 py-1 rounded-lg text-xs font-bold text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/40"
                          >
                            Reactivate
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setTargetStaff(member);
                              setActionType('suspend');
                              setSuspendModalOpen(true);
                            }}
                            className="px-2.5 py-1 rounded-lg text-xs font-bold text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"
                          >
                            Suspend
                          </button>
                        )
                      ) : (
                        <span className="text-[11px] text-gray-400">Full admin only</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Invite Modal */}
      {inviteModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="w-full max-w-md bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-3xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 pb-2 border-b border-gray-100 dark:border-zinc-800">
              <div className="p-2 rounded-xl bg-amber-400 text-black">
                <UserPlus className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-extrabold text-base text-gray-900 dark:text-white">
                  Invite Staff Member
                </h3>
                <p className="text-xs text-gray-500 dark:text-zinc-400">
                  Writes to <code className="font-mono text-amber-600">staffInvites/{'{email}'}</code>
                </p>
              </div>
            </div>

            <form onSubmit={handleSendInvite} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-700 dark:text-zinc-300 uppercase tracking-wider mb-1.5">
                  Staff Email Address
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-gray-400 absolute left-3.5 top-3" />
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    required
                    placeholder="teammate@delivio.ph"
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-medium text-gray-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-amber-400"
                  />
                </div>
                <span className="text-[10px] text-gray-400 mt-1 block">
                  Email will be stored in lowercase.
                </span>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 dark:text-zinc-300 uppercase tracking-wider mb-1.5">
                  Select Role & Permissions
                </label>
                <div className="space-y-2">
                  <label
                    className={`flex items-start gap-3 p-3 rounded-2xl border cursor-pointer transition-all ${
                      inviteRole === 'support'
                        ? 'border-purple-500 bg-purple-50/50 dark:bg-purple-950/20'
                        : 'border-gray-200 dark:border-zinc-800 hover:bg-gray-50'
                    }`}
                  >
                    <input
                      type="radio"
                      name="role"
                      value="support"
                      checked={inviteRole === 'support'}
                      onChange={() => setInviteRole('support')}
                      className="mt-1 text-purple-600"
                    />
                    <div>
                      <span className="font-bold text-xs text-gray-900 dark:text-white block">
                        Support Sub-Admin
                      </span>
                      <span className="text-[11px] text-gray-500 dark:text-zinc-400 block mt-0.5">
                        Access to support tickets, live orders view, inbox broadcasts, and fraud flags.
                      </span>
                    </div>
                  </label>

                  <label
                    className={`flex items-start gap-3 p-3 rounded-2xl border cursor-pointer transition-all ${
                      inviteRole === 'finance'
                        ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-950/20'
                        : 'border-gray-200 dark:border-zinc-800 hover:bg-gray-50'
                    }`}
                  >
                    <input
                      type="radio"
                      name="role"
                      value="finance"
                      checked={inviteRole === 'finance'}
                      onChange={() => setInviteRole('finance')}
                      className="mt-1 text-blue-600"
                    />
                    <div>
                      <span className="font-bold text-xs text-gray-900 dark:text-white block">
                        Finance Sub-Admin
                      </span>
                      <span className="text-[11px] text-gray-500 dark:text-zinc-400 block mt-0.5">
                        Access to wallet transfers, merchant remittances, driver payouts, and financial reports.
                      </span>
                    </div>
                  </label>

                  <label
                    className={`flex items-start gap-3 p-3 rounded-2xl border cursor-pointer transition-all ${
                      inviteRole === 'admin'
                        ? 'border-amber-500 bg-amber-50/50 dark:bg-amber-950/20'
                        : 'border-gray-200 dark:border-zinc-800 hover:bg-gray-50'
                    }`}
                  >
                    <input
                      type="radio"
                      name="role"
                      value="admin"
                      checked={inviteRole === 'admin'}
                      onChange={() => setInviteRole('admin')}
                      className="mt-1 text-amber-600"
                    />
                    <div>
                      <span className="font-bold text-xs text-gray-900 dark:text-white block">
                        Full Administrator
                      </span>
                      <span className="text-[11px] text-gray-500 dark:text-zinc-400 block mt-0.5">
                        Full platform authority, ability to alter settings and suspend/ban accounts.
                      </span>
                    </div>
                  </label>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-gray-100 dark:border-zinc-800">
                <button
                  type="button"
                  onClick={() => setInviteModalOpen(false)}
                  disabled={inviting}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-gray-600 hover:bg-gray-100 dark:hover:bg-zinc-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={inviting}
                  className="delivio-btn-yellow px-5 py-2 rounded-xl text-xs font-bold flex items-center gap-2"
                >
                  {inviting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Send Staff Invite
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Revoke Invite Confirmation */}
      {revokeModalOpen && inviteToRevoke && (
        <ConfirmationModal
          isOpen={revokeModalOpen}
          onClose={() => setRevokeModalOpen(false)}
          onConfirm={handleRevokeInvite}
          title={`Revoke invitation for ${inviteToRevoke.email}?`}
          message="They will no longer be able to complete registration with this invited email address."
          confirmLabel="Revoke Invite"
          isDestructive={true}
        />
      )}

      {/* Suspend / Reactivate Confirmation Modal */}
      {suspendModalOpen && targetStaff && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="w-full max-w-sm bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-3xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div
                className={`p-2.5 rounded-2xl ${
                  actionType === 'suspend'
                    ? 'bg-red-100 text-red-600 dark:bg-red-950/60'
                    : 'bg-emerald-100 text-emerald-600 dark:bg-emerald-950/60'
                }`}
              >
                {actionType === 'suspend' ? (
                  <Ban className="w-5 h-5" />
                ) : (
                  <CheckCircle2 className="w-5 h-5" />
                )}
              </div>
              <div>
                <h3 className="font-extrabold text-sm text-gray-900 dark:text-white">
                  {actionType === 'suspend' ? 'Suspend Staff Account' : 'Reactivate Staff Account'}
                </h3>
                <p className="text-xs text-gray-500">{targetStaff.email}</p>
              </div>
            </div>

            <p className="text-xs text-gray-600 dark:text-zinc-300">
              {actionType === 'suspend'
                ? 'Suspending this staff member will immediately revoke their ability to log in to the admin console.'
                : 'Reactivating this account will restore their console access.'}
            </p>

            <div>
              <label className="block text-[11px] font-bold text-gray-700 dark:text-zinc-300 uppercase mb-1">
                Reason / Internal Note
              </label>
              <textarea
                value={actionReason}
                onChange={(e) => setActionReason(e.target.value)}
                rows={3}
                placeholder="Provide a reason for the audit trail..."
                className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-medium text-gray-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-amber-400"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setSuspendModalOpen(false)}
                disabled={processingAction}
                className="px-4 py-2 text-xs font-bold text-gray-600 hover:bg-gray-100 rounded-xl"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmStatusAction}
                disabled={processingAction}
                className={`px-5 py-2 text-xs font-bold rounded-xl text-white flex items-center gap-1.5 ${
                  actionType === 'suspend' ? 'bg-red-600 hover:bg-red-700' : 'bg-emerald-600 hover:bg-emerald-700'
                }`}
              >
                {processingAction && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Confirm {actionType === 'suspend' ? 'Suspension' : 'Reactivation'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
