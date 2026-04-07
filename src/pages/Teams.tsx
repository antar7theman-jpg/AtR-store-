import React, { useEffect, useState } from 'react';
import { collection, onSnapshot, doc, setDoc, updateDoc, deleteDoc, query, orderBy, getDoc } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { UserProfile, Team } from '../types';
import { useAuth } from '../components/AuthGuard';
import { 
  UsersRound, Plus, Trash2, UserPlus, X, Search, Filter, 
  ChevronRight, LayoutGrid, List as ListIcon, Info
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

const Teams: React.FC = () => {
  const { isAdmin, isStaff, user } = useAuth();
  const canManage = isAdmin || isStaff;
  const { t, i18n } = useTranslation();
  
  const [teams, setTeams] = useState<Team[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  
  // Modals
  const [showAddModal, setShowAddModal] = useState(false);
  const [showMembersModal, setShowMembersModal] = useState(false);
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<Team | null>(null);
  const [memberToToggle, setMemberToToggle] = useState<{ team: Team, user: UserProfile, isAdding: boolean } | null>(null);

  // Form State
  const [newTeamName, setNewTeamName] = useState('');
  const [newTeamDescription, setNewTeamDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const teamsUnsubscribe = onSnapshot(
      query(collection(db, 'teams'), orderBy('name', 'asc')),
      (snapshot) => {
        setTeams(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as Team)));
        setLoading(false);
      }
    );

    const usersUnsubscribe = onSnapshot(
      query(collection(db, 'users'), orderBy('name', 'asc')),
      (snapshot) => {
        setUsers(snapshot.docs.map(doc => ({ ...doc.data(), uid: doc.id } as UserProfile)));
      }
    );

    return () => {
      teamsUnsubscribe();
      usersUnsubscribe();
    };
  }, []);

  const handleCreateTeam = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTeamName.trim()) return;

    setSubmitting(true);
    try {
      const teamId = doc(collection(db, 'teams')).id;
      await setDoc(doc(db, 'teams', teamId), {
        name: newTeamName,
        description: newTeamDescription,
        memberUids: [],
        createdAt: new Date()
      });
      toast.success(t('settings.teamCreated'));
      setShowAddModal(false);
      setNewTeamName('');
      setNewTeamDescription('');
    } catch (err) {
      console.error("Error creating team:", err);
      toast.error(t('common.error'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteTeam = async (teamId: string) => {
    try {
      // First, remove teamId from all members
      const team = teams.find(t => t.id === teamId);
      if (team) {
        for (const uid of team.memberUids) {
          const userRef = doc(db, 'users', uid);
          const userDoc = await getDoc(userRef);
          if (userDoc.exists()) {
            const userData = userDoc.data() as UserProfile;
            const newTeamIds = (userData.teamIds || []).filter(id => id !== teamId);
            await updateDoc(userRef, { teamIds: newTeamIds });
          }
        }
      }

      await deleteDoc(doc(db, 'teams', teamId));
      toast.success(t('settings.teamDeleted'));
      setShowDeleteConfirm(null);
    } catch (err) {
      console.error("Error deleting team:", err);
      toast.error(t('common.error'));
    }
  };

  const toggleUserInTeam = async (team: Team, userUid: string) => {
    const isMember = team.memberUids.includes(userUid);
    const newMembers = isMember 
      ? team.memberUids.filter(uid => uid !== userUid)
      : Array.from(new Set([...team.memberUids, userUid]));
    
    try {
      await updateDoc(doc(db, 'teams', team.id), {
        memberUids: newMembers
      });

      // Also update user's teamIds
      const userRef = doc(db, 'users', userUid);
      const userDoc = await getDoc(userRef);
      if (userDoc.exists()) {
        const userData = userDoc.data() as UserProfile;
        const currentTeamIds = userData.teamIds || [];
        const newTeamIds = isMember
          ? currentTeamIds.filter(id => id !== team.id)
          : Array.from(new Set([...currentTeamIds, team.id]));
        
        await updateDoc(userRef, {
          teamIds: newTeamIds
        });
      }
      toast.success(isMember ? t('settings.removeUserFromTeam') : t('settings.addUserToTeam'));
    } catch (err) {
      console.error("Error updating team members:", err);
      toast.error(t('common.error'));
    }
  };

  const filteredTeams = teams.filter(team => 
    team.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    team.description?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between space-y-4 md:space-y-0">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white tracking-tight">{t('settings.teams')}</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">{t('settings.manageTeams')}</p>
        </div>
        {canManage && (
          <button
            onClick={() => setShowAddModal(true)}
            className="inline-flex items-center justify-center px-6 py-3 border border-transparent text-base font-medium rounded-xl shadow-sm text-white bg-blue-600 hover:bg-blue-700 transition-all transform hover:scale-105 active:scale-95"
          >
            <Plus className="mr-2 h-5 w-5 rtl:mr-0 rtl:ml-2" />
            {t('settings.addTeam')}
          </button>
        )}
      </div>

      {/* Filters & Search */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 bg-white dark:bg-gray-900 p-4 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm">
        <div className="relative flex-grow">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
          <input
            type="text"
            placeholder={t('common.search')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-gray-50 dark:bg-gray-800 border-none rounded-xl focus:ring-2 focus:ring-blue-500 dark:text-white transition-all"
          />
        </div>
        <div className="flex items-center bg-gray-100 dark:bg-gray-800 p-1 rounded-xl">
          <button
            onClick={() => setViewMode('grid')}
            className={cn(
              "p-2 rounded-lg transition-all",
              viewMode === 'grid' ? "bg-white dark:bg-gray-700 shadow-sm text-blue-600 dark:text-blue-400" : "text-gray-500"
            )}
          >
            <LayoutGrid className="h-5 w-5" />
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={cn(
              "p-2 rounded-lg transition-all",
              viewMode === 'list' ? "bg-white dark:bg-gray-700 shadow-sm text-blue-600 dark:text-blue-400" : "text-gray-500"
            )}
          >
            <ListIcon className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Teams List */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-48 bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 animate-pulse" />
          ))}
        </div>
      ) : filteredTeams.length > 0 ? (
        <div className={cn(
          viewMode === 'grid' 
            ? "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6" 
            : "space-y-4"
        )}>
          <AnimatePresence mode="popLayout">
            {filteredTeams.map((team) => (
              <motion.div
                key={team.id}
                layout
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className={cn(
                  "group bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-6 hover:shadow-xl hover:border-blue-100 dark:hover:border-blue-900/30 transition-all relative overflow-hidden",
                  viewMode === 'list' && "flex items-center justify-between py-4"
                )}
              >
                <div className={cn("flex items-start space-x-4 rtl:space-x-reverse", viewMode === 'list' && "items-center")}>
                  <div className="h-14 w-14 rounded-2xl bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center text-blue-600 dark:text-blue-400 group-hover:scale-110 transition-transform">
                    <UsersRound className="h-7 w-7" />
                  </div>
                  <div className="flex-grow min-w-0">
                    <h3 className="text-xl font-bold text-gray-900 dark:text-white truncate">{team.name}</h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400 line-clamp-2 mt-1">{team.description || t('settings.noDescription')}</p>
                    <div className="flex items-center mt-4 space-x-4 rtl:space-x-reverse">
                      <div className="flex -space-x-2 rtl:space-x-reverse overflow-hidden">
                        {team.memberUids.slice(0, 5).map(uid => {
                          const member = users.find(u => u.uid === uid);
                          return (
                            <div key={uid} className="inline-block h-8 w-8 rounded-full ring-2 ring-white dark:ring-gray-900 bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-[10px] font-bold text-gray-600 dark:text-gray-400">
                              {member?.photoUrl ? (
                                <img src={member.photoUrl} alt={member.name} className="h-full w-full rounded-full object-cover" referrerPolicy="no-referrer" />
                              ) : (
                                member?.name.charAt(0) || '?'
                              )}
                            </div>
                          );
                        })}
                        {team.memberUids.length > 5 && (
                          <div className="inline-block h-8 w-8 rounded-full ring-2 ring-white dark:ring-gray-900 bg-gray-50 dark:bg-gray-800 flex items-center justify-center text-[10px] font-bold text-gray-500">
                            +{team.memberUids.length - 5}
                          </div>
                        )}
                      </div>
                      <span className="text-xs font-medium text-gray-400 dark:text-gray-500">
                        {t('settings.membersCount', { count: team.memberUids.length })}
                      </span>
                    </div>
                  </div>
                </div>

                <div className={cn(
                  "flex items-center space-x-2 rtl:space-x-reverse",
                  viewMode === 'grid' ? "mt-6 pt-6 border-t border-gray-50 dark:border-gray-800" : ""
                )}>
                  <button
                    onClick={() => {
                      setSelectedTeam(team);
                      setShowMembersModal(true);
                    }}
                    className="flex-grow inline-flex items-center justify-center px-4 py-2 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 rounded-xl text-sm font-bold hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-all"
                  >
                    <UserPlus className="h-4 w-4 mr-2 rtl:mr-0 rtl:ml-2" />
                    {t('settings.manageMembers')}
                  </button>
                  {canManage && (
                    <button
                      onClick={() => setShowDeleteConfirm(team)}
                      className="p-2 text-gray-400 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                      title={t('common.delete')}
                    >
                      <Trash2 className="h-5 w-5" />
                    </button>
                  )}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-900 rounded-3xl border border-gray-100 dark:border-gray-800 p-12 text-center">
          <div className="mx-auto w-20 h-20 bg-gray-50 dark:bg-gray-800 rounded-full flex items-center justify-center mb-4">
            <UsersRound className="h-10 w-10 text-gray-300 dark:text-gray-600" />
          </div>
          <h3 className="text-xl font-bold text-gray-900 dark:text-white">{t('settings.noTeamsFound')}</h3>
          <p className="text-gray-500 dark:text-gray-400 mt-2 max-w-sm mx-auto">
            {t('settings.noTeamsSubtitle', { defaultValue: 'Create teams to organize your staff and assign tasks more efficiently.' })}
          </p>
          {canManage && (
            <button
              onClick={() => setShowAddModal(true)}
              className="mt-6 inline-flex items-center px-6 py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-all shadow-lg shadow-blue-500/20"
            >
              <Plus className="mr-2 h-5 w-5 rtl:mr-0 rtl:ml-2" />
              {t('settings.addTeam')}
            </button>
          )}
        </div>
      )}

      {/* Add Team Modal */}
      <AnimatePresence>
        {showAddModal && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white dark:bg-gray-900 rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden border border-gray-100 dark:border-gray-800"
            >
              <div className="px-8 py-6 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center bg-gray-50 dark:bg-gray-800/50">
                <h3 className="text-xl font-bold text-gray-900 dark:text-white">{t('settings.addTeam')}</h3>
                <button onClick={() => setShowAddModal(false)} className="p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full transition-colors">
                  <X className="h-6 w-6 text-gray-500 dark:text-gray-400" />
                </button>
              </div>
              <form onSubmit={handleCreateTeam} className="p-8 space-y-6">
                <div className="space-y-2">
                  <label className="text-sm font-bold text-gray-700 dark:text-gray-300 ml-1">{t('settings.teamName')}</label>
                  <input
                    required
                    type="text"
                    value={newTeamName}
                    onChange={(e) => setNewTeamName(e.target.value)}
                    className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-800 border-none rounded-xl focus:ring-2 focus:ring-blue-500 dark:text-white transition-all"
                    placeholder="e.g. Morning Shift, Warehouse A..."
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-bold text-gray-700 dark:text-gray-300 ml-1">{t('settings.teamDescription')}</label>
                  <textarea
                    rows={3}
                    value={newTeamDescription}
                    onChange={(e) => setNewTeamDescription(e.target.value)}
                    className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-800 border-none rounded-xl focus:ring-2 focus:ring-blue-500 dark:text-white transition-all resize-none"
                    placeholder="Describe the team's responsibilities..."
                  />
                </div>
                <div className="flex space-x-3 rtl:space-x-reverse pt-4">
                  <button
                    type="button"
                    onClick={() => setShowAddModal(false)}
                    className="flex-1 px-6 py-3 border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 font-bold rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="flex-1 px-6 py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition-all shadow-lg shadow-blue-500/20 disabled:opacity-50"
                  >
                    {submitting ? t('common.saving') : t('common.confirm')}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Members Management Modal */}
      <AnimatePresence>
        {showMembersModal && selectedTeam && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white dark:bg-gray-900 rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden border border-gray-100 dark:border-gray-800"
            >
              <div className="px-8 py-6 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center bg-gray-50 dark:bg-gray-800/50">
                <div>
                  <h3 className="text-xl font-bold text-gray-900 dark:text-white">{selectedTeam.name}</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400">{t('settings.manageMembers')}</p>
                </div>
                <button onClick={() => setShowMembersModal(false)} className="p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full transition-colors">
                  <X className="h-6 w-6 text-gray-500 dark:text-gray-400" />
                </button>
              </div>
              <div className="p-8 max-h-[60vh] overflow-y-auto space-y-4">
                {users.map(u => {
                  const isMember = selectedTeam.memberUids.includes(u.uid);
                  return (
                    <div key={u.uid} className="flex items-center justify-between p-4 rounded-2xl border border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                      <div className="flex items-center space-x-4 rtl:space-x-reverse">
                        <div className="h-12 w-12 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-700 dark:text-blue-400 font-bold overflow-hidden">
                          {u.photoUrl ? (
                            <img src={u.photoUrl} alt={u.name} className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                          ) : (
                            u.name.charAt(0)
                          )}
                        </div>
                        <div>
                          <p className="text-base font-bold text-gray-900 dark:text-white">{u.name}</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">{u.email}</p>
                        </div>
                      </div>
                      <button
                        onClick={() => {
                          if (!isMember) {
                            setMemberToToggle({ team: selectedTeam, user: u, isAdding: true });
                          } else {
                            toggleUserInTeam(selectedTeam, u.uid);
                          }
                        }}
                        className={cn(
                          "px-4 py-2 text-sm font-bold rounded-xl transition-all",
                          isMember 
                            ? "bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40"
                            : "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/40"
                        )}
                      >
                        {isMember ? t('settings.remove') : t('settings.add')}
                      </button>
                    </div>
                  );
                })}
              </div>
              <div className="px-8 py-6 bg-gray-50 dark:bg-gray-800/50 border-t border-gray-100 dark:border-gray-800 flex justify-end">
                <button
                  onClick={() => setShowMembersModal(false)}
                  className="px-6 py-3 bg-gray-900 dark:bg-white text-white dark:text-gray-900 font-bold rounded-xl hover:bg-gray-800 dark:hover:bg-gray-100 transition-colors"
                >
                  {t('settings.done')}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Member Toggle Confirmation */}
      <AnimatePresence mode="wait">
        {memberToToggle && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white dark:bg-gray-900 rounded-3xl shadow-2xl w-full max-w-md overflow-hidden border border-gray-100 dark:border-gray-800"
            >
              <div className="p-8 text-center">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/30 mb-6">
                  <UserPlus className="h-8 w-8 text-blue-600 dark:text-blue-400" />
                </div>
                <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
                  {memberToToggle.isAdding ? t('settings.confirmAddMember') : t('settings.confirmRemoveMember')}
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-8">
                  {memberToToggle.isAdding 
                    ? t('settings.confirmAddMemberMessage', { name: memberToToggle.user.name, team: memberToToggle.team.name })
                    : t('settings.confirmRemoveMemberMessage', { name: memberToToggle.user.name, team: memberToToggle.team.name })
                  }
                </p>
                <div className="flex space-x-3 rtl:space-x-reverse">
                  <button
                    onClick={() => setMemberToToggle(null)}
                    className="flex-1 px-6 py-3 border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 font-bold rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    onClick={() => {
                      toggleUserInTeam(memberToToggle.team, memberToToggle.user.uid);
                      setMemberToToggle(null);
                    }}
                    className="flex-1 px-6 py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition-all shadow-lg shadow-blue-500/20"
                  >
                    {t('common.confirm')}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Delete Team Confirmation */}
      <AnimatePresence mode="wait">
        {showDeleteConfirm && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white dark:bg-gray-900 rounded-3xl shadow-2xl w-full max-w-md overflow-hidden border border-gray-100 dark:border-gray-800"
            >
              <div className="p-8 text-center">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30 mb-6">
                  <Trash2 className="h-8 w-8 text-red-600 dark:text-red-400" />
                </div>
                <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">{t('settings.confirmDelete')}</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-8">
                  {t('settings.deleteTeamConfirm')}
                  <br />
                  <span className="font-bold text-gray-900 dark:text-white mt-2 block">{showDeleteConfirm.name}</span>
                </p>
                <div className="flex space-x-3 rtl:space-x-reverse">
                  <button
                    onClick={() => setShowDeleteConfirm(null)}
                    className="flex-1 px-6 py-3 border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 font-bold rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    onClick={() => handleDeleteTeam(showDeleteConfirm.id)}
                    className="flex-1 px-6 py-3 bg-red-600 text-white font-bold rounded-xl hover:bg-red-700 transition-all shadow-lg shadow-red-500/20"
                  >
                    {t('common.delete')}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Teams;
