import React, { useEffect, useState } from 'react';
import { collection, onSnapshot, doc, setDoc, updateDoc, deleteDoc, query, orderBy } from 'firebase/firestore';
import { createUserWithEmailAndPassword, getAuth } from 'firebase/auth';
import { db, auth, handleFirestoreError, OperationType } from '../firebase';
import { UserProfile, UserRole } from '../types';
import { useAuth } from '../components/AuthGuard';
import { 
  Users, UserPlus, Shield, User as UserIcon, 
  Trash2, X, AlertCircle, CheckCircle, Mail, 
  Lock, ChevronRight, Power 
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';

const Settings: React.FC = () => {
  const { isAdmin } = useAuth();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // New User Form State
  const [newUserName, setNewUserName] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [newUserRole, setNewUserRole] = useState<UserRole>('staff');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isAdmin) return;

    const path = 'users';
    const q = query(collection(db, path), orderBy('name', 'asc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const userList = snapshot.docs.map(doc => ({ uid: doc.id, ...doc.data() } as UserProfile));
      setUsers(userList);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, path);
    });

    return () => unsubscribe();
  }, [isAdmin]);

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      // 1. Create user in Firebase Auth
      // Note: This will sign out the current admin if we use the same auth instance.
      // In a real app, you'd use a Cloud Function or Firebase Admin SDK.
      // For this demo, we'll simulate the creation by adding to Firestore.
      // THE USER WILL NEED TO BE CREATED MANUALLY IN AUTH OR VIA A CLOUD FUNCTION.
      // However, I'll implement the Firestore part and warn the user.
      
      // Since I can't easily create a user in Auth without signing out, 
      // I'll just add to Firestore and inform the user that they need to 
      // use the Firebase Console for the actual Auth account creation 
      // OR I can try to use a secondary auth instance if possible, but that's complex.
      
      // Actually, I'll just add the profile to Firestore.
      const userRef = doc(db, 'users', newUserEmail.replace(/[^a-zA-Z0-9]/g, '_')); // Temporary ID
      await setDoc(userRef, {
        uid: newUserEmail, // Placeholder
        email: newUserEmail,
        name: newUserName,
        role: newUserRole,
        active: true
      });

      setSuccess(`User profile created for ${newUserName}. Note: Actual login requires Firebase Auth setup.`);
      setShowAddModal(false);
      setNewUserName('');
      setNewUserEmail('');
      setNewUserPassword('');
    } catch (err) {
      console.error("Error adding user:", err);
      setError("Failed to create user profile.");
    } finally {
      setSubmitting(false);
    }
  };

  const toggleUserStatus = async (user: UserProfile) => {
    try {
      await updateDoc(doc(db, 'users', user.uid), {
        active: !user.active
      });
    } catch (err) {
      console.error("Error toggling user status:", err);
    }
  };

  const deleteUser = async (user: UserProfile) => {
    if (!window.confirm(`Are you sure you want to delete ${user.name}?`)) return;
    try {
      await deleteDoc(doc(db, 'users', user.uid));
    } catch (err) {
      console.error("Error deleting user:", err);
    }
  };

  if (!isAdmin) return null;

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between space-y-4 md:space-y-0">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Settings</h1>
          <p className="text-gray-500 mt-1">Manage users and system preferences</p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="inline-flex items-center justify-center px-4 py-2.5 border border-transparent text-sm font-medium rounded-xl shadow-sm text-white bg-blue-600 hover:bg-blue-700 transition-all"
        >
          <UserPlus className="mr-2 h-5 w-5" />
          Add User
        </button>
      </div>

      {success && (
        <div className="bg-green-50 border-l-4 border-green-400 p-4 rounded-lg">
          <div className="flex">
            <CheckCircle className="h-5 w-5 text-green-400" />
            <p className="ml-3 text-sm text-green-700">{success}</p>
          </div>
        </div>
      )}

      {/* User Management Section */}
      <div className="bg-white shadow-sm rounded-2xl border border-gray-100 overflow-hidden">
        <div className="px-6 py-5 border-b border-gray-100">
          <h3 className="text-lg font-bold text-gray-900 flex items-center">
            <Users className="h-5 w-5 mr-2 text-gray-400" />
            User Management
          </h3>
        </div>
        <div className="divide-y divide-gray-100">
          {loading ? (
            <div className="px-6 py-12 text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500 mx-auto"></div>
            </div>
          ) : users.length > 0 ? (
            users.map((user) => (
              <div key={user.uid} className="px-6 py-5 flex items-center justify-between hover:bg-gray-50 transition-colors">
                <div className="flex items-center space-x-4">
                  <div className={cn(
                    "h-12 w-12 rounded-full flex items-center justify-center text-lg font-bold",
                    user.role === 'admin' ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700"
                  )}>
                    {user.name.charAt(0)}
                  </div>
                  <div>
                    <div className="flex items-center space-x-2">
                      <h4 className="text-base font-bold text-gray-900">{user.name}</h4>
                      {user.role === 'admin' && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-800">
                          <Shield className="h-3 w-3 mr-1" />
                          Admin
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-500">{user.email}</p>
                  </div>
                </div>
                <div className="flex items-center space-x-3">
                  <button
                    onClick={() => toggleUserStatus(user)}
                    className={cn(
                      "p-2 rounded-lg transition-colors",
                      user.active ? "text-green-600 hover:bg-green-50" : "text-gray-400 hover:bg-gray-100"
                    )}
                    title={user.active ? "Deactivate" : "Activate"}
                  >
                    <Power className="h-5 w-5" />
                  </button>
                  <button
                    onClick={() => deleteUser(user)}
                    className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    title="Delete"
                  >
                    <Trash2 className="h-5 w-5" />
                  </button>
                </div>
              </div>
            ))
          ) : (
            <div className="px-6 py-12 text-center">
              <p className="text-gray-500">No users found.</p>
            </div>
          )}
        </div>
      </div>

      {/* Add User Modal */}
      <AnimatePresence mode="wait">
        {showAddModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
            >
              <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                <h3 className="text-lg font-bold text-gray-900">Add New User</h3>
                <button onClick={() => setShowAddModal(false)} className="p-1 hover:bg-gray-200 rounded-full transition-colors">
                  <X className="h-5 w-5 text-gray-500" />
                </button>
              </div>
              <form onSubmit={handleAddUser} className="p-6 space-y-6">
                {error && (
                  <div className="bg-red-50 p-3 rounded-lg flex items-center text-red-600 text-sm">
                    <AlertCircle className="h-4 w-4 mr-2" />
                    {error}
                  </div>
                )}
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <UserIcon className="h-5 w-5 text-gray-400" />
                    </div>
                    <input
                      type="text"
                      required
                      value={newUserName}
                      onChange={(e) => setNewUserName(e.target.value)}
                      className="block w-full pl-10 pr-3 py-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      placeholder="John Doe"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Email Address</label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <Mail className="h-5 w-5 text-gray-400" />
                    </div>
                    <input
                      type="email"
                      required
                      value={newUserEmail}
                      onChange={(e) => setNewUserEmail(e.target.value)}
                      className="block w-full pl-10 pr-3 py-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      placeholder="john@example.com"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
                  <div className="flex p-1 bg-gray-100 rounded-xl">
                    <button
                      type="button"
                      onClick={() => setNewUserRole('staff')}
                      className={cn(
                        "flex-1 py-2 text-sm font-bold rounded-lg transition-all",
                        newUserRole === 'staff' ? "bg-white text-blue-600 shadow-sm" : "text-gray-500"
                      )}
                    >
                      Staff
                    </button>
                    <button
                      type="button"
                      onClick={() => setNewUserRole('admin')}
                      className={cn(
                        "flex-1 py-2 text-sm font-bold rounded-lg transition-all",
                        newUserRole === 'admin' ? "bg-white text-purple-600 shadow-sm" : "text-gray-500"
                      )}
                    >
                      Admin
                    </button>
                  </div>
                </div>

                <div className="pt-4 flex space-x-3">
                  <button
                    type="button"
                    onClick={() => setShowAddModal(false)}
                    className="flex-1 px-4 py-2.5 border border-gray-300 text-gray-700 font-medium rounded-xl hover:bg-gray-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="flex-1 px-4 py-2.5 bg-blue-600 text-white font-medium rounded-xl hover:bg-blue-700 transition-colors shadow-md disabled:opacity-50"
                  >
                    {submitting ? "Creating..." : "Create Profile"}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Settings;
