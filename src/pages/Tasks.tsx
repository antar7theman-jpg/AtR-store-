import React, { useEffect, useState } from 'react';
import { 
  collection, onSnapshot, query, orderBy, 
  addDoc, updateDoc, deleteDoc, doc, 
  serverTimestamp, Timestamp 
} from 'firebase/firestore';
import { ref, uploadString, getDownloadURL } from 'firebase/storage';
import { db, storage, handleFirestoreError, OperationType } from '../firebase';
import { Task, Priority, UserProfile, TaskStatus, Team } from '../types';
import { useAuth } from '../components/AuthGuard';
import { 
  Plus, CheckCircle, Circle, Trash2, 
  AlertCircle, Clock, Filter, ChevronDown,
  Calendar, MoreVertical, Check, User,
  PlayCircle, UserPlus, UsersRound,
  X, ImageIcon, Camera, Upload
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { differenceInDays } from 'date-fns';
import { cn, formatDate, compressImage } from '../lib/utils';
import { CachedImage } from '../components/CachedImage';
import { useTranslation } from 'react-i18next';
import confetti from 'canvas-confetti';

const Tasks: React.FC = () => {
  const { profile, isAdmin, isStaff, isUser } = useAuth();
  const canManageTasks = isAdmin || isStaff;
  const { t } = useTranslation();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [showCompleteConfirm, setShowCompleteConfirm] = useState<Task | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [viewImage, setViewImage] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'pending' | 'completed'>('all');
  const [sortBy, setSortBy] = useState<'createdAt' | 'priority' | 'dueDate'>('createdAt');
  const [statusFilter, setStatusFilter] = useState<'all' | TaskStatus>('all');
  const [userFilter, setUserFilter] = useState<string>('all');
  const [teamFilter, setTeamFilter] = useState<string>('all');
  const [showMyTasksOnly, setShowMyTasksOnly] = useState(false);
  const [completionImage, setCompletionImage] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  // Form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<Priority>('medium');
  const [dueDate, setDueDate] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [assignedTeamId, setAssignedTeamId] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Helper to safely convert Firestore timestamp to Date
  const safeToDate = (timestamp: any) => {
    if (!timestamp || typeof timestamp.toDate !== 'function') return new Date();
    return timestamp.toDate();
  };

  useEffect(() => {
    const path = 'tasks';
    const q = query(collection(db, path), orderBy('createdAt', 'desc'));
    
    const unsubscribeTasks = onSnapshot(q, (snapshot) => {
      const taskList = snapshot.docs.map(doc => ({ 
        id: doc.id, 
        ...doc.data() 
      } as Task));
      setTasks(taskList);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, path);
    });

    const usersPath = 'users';
    const unsubscribeUsers = onSnapshot(collection(db, usersPath), (snapshot) => {
      const userList = snapshot.docs.map(doc => ({ 
        uid: doc.id, 
        ...doc.data() 
      } as UserProfile));
      setUsers(userList);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, usersPath);
    });

    const teamsPath = 'teams';
    const unsubscribeTeams = onSnapshot(collection(db, teamsPath), (snapshot) => {
      const teamList = snapshot.docs.map(doc => ({ 
        id: doc.id, 
        ...doc.data() 
      } as Team));
      setTeams(teamList);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, teamsPath);
    });

    return () => {
      unsubscribeTasks();
      unsubscribeUsers();
      unsubscribeTeams();
    };
  }, []);

  const handleAddTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile || !title.trim() || !description.trim()) {
      toast.error(t('tasks.errorMissingFields', { defaultValue: 'Please fill in all required fields' }));
      return;
    }

    setSubmitting(true);
    try {
      const taskData: any = {
        title: title.trim(),
        description: description.trim(),
        priority,
        completed: false,
        status: 'pending',
        createdAt: serverTimestamp(),
        createdBy: profile.uid,
        assignedTo: assignedTo || null,
        assignedTeamId: assignedTeamId || null,
      };

      if (dueDate) {
        taskData.dueDate = Timestamp.fromDate(new Date(dueDate));
      }

      if (assignedTo) {
        taskData.assignedTo = assignedTo;
      }

      if (assignedTeamId) {
        taskData.assignedTeamId = assignedTeamId;
      }

      const taskRef = await addDoc(collection(db, 'tasks'), taskData);
      
      // Send notification
      const { sendTaskAlert } = await import('../services/notificationService');
      const assignedUser = assignedTo ? users.find(u => u.uid === assignedTo) : null;
      sendTaskAlert({ ...taskData, id: taskRef.id }, assignedUser);
      
      // Reset form
      setTitle('');
      setDescription('');
      setPriority('medium');
      setDueDate('');
      setAssignedTo('');
      setAssignedTeamId('');
      setShowAddModal(false);
    } catch (error) {
      console.error("Error adding task:", error);
    } finally {
      setSubmitting(false);
    }
  };

  const isAuthorizedToUpdate = (task: Task) => {
    if (isAdmin) return true;
    if (task.createdBy === profile?.uid) return true;
    if (task.assignedTo === profile?.uid) return true;
    if (task.assignedTeamId && profile?.teamIds?.includes(task.assignedTeamId)) return true;
    if (isStaff && !task.assignedTo && !task.assignedTeamId) return true;
    return false;
  };

  const toggleTask = async (task: Task) => {
    if (!isAuthorizedToUpdate(task)) {
      toast.error(t('tasks.unauthorizedUpdate', { defaultValue: 'You are not authorized to update this task' }));
      return;
    }

    if (!task.completed) {
      setShowCompleteConfirm(task);
      return;
    }
    
    try {
      const updateData: any = {
        completed: false,
        status: 'pending'
      };

      if (!task.assignedTo && !task.assignedTeamId && profile) {
        updateData.assignedTo = profile.uid;
      }

      await updateDoc(doc(db, 'tasks', task.id), updateData);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `tasks/${task.id}`);
    }
  };

  const confirmCompleteTask = async () => {
    if (!showCompleteConfirm) return;
    
    if (!isAuthorizedToUpdate(showCompleteConfirm)) {
      toast.error(t('tasks.unauthorizedUpdate', { defaultValue: 'You are not authorized to update this task' }));
      setShowCompleteConfirm(null);
      return;
    }

    setCompleting(true);
    try {
      let imageUrl = '';
      if (completionImage) {
        setIsUploading(true);
        const storageRef = ref(storage, `tasks/${showCompleteConfirm.id}/completion_${Date.now()}.jpg`);
        await uploadString(storageRef, completionImage, 'data_url');
        imageUrl = await getDownloadURL(storageRef);
        setIsUploading(false);
      }

      const updateData: any = {
        completed: true,
        status: 'completed'
      };

      if (imageUrl) {
        updateData.completionImage = imageUrl;
      }

      if (!showCompleteConfirm.assignedTo && !showCompleteConfirm.assignedTeamId && profile) {
        updateData.assignedTo = profile.uid;
      }

      await updateDoc(doc(db, 'tasks', showCompleteConfirm.id), updateData);
      
      // Send notification
      const { sendTaskCompletionAlert } = await import('../services/notificationService');
      sendTaskCompletionAlert(showCompleteConfirm, profile?.name || 'Unknown');
      
      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#22c55e', '#3b82f6', '#ffffff']
      });

      toast.success(t('tasks.taskCompleted', { defaultValue: 'Task marked as completed!' }));
      setShowCompleteConfirm(null);
      setCompletionImage(null);
    } catch (error) {
      console.error("Error completing task:", error);
      toast.error(t('common.errorUpdatingTask', { defaultValue: 'Failed to update task. Please try again.' }));
      // Log to agent but don't crash the UI
      try {
        handleFirestoreError(error, OperationType.UPDATE, `tasks/${showCompleteConfirm.id}`);
      } catch (e) {
        // Ignore the re-thrown error from handleFirestoreError
      }
    } finally {
      setCompleting(false);
      setIsUploading(false);
    }
  };

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64 = reader.result as string;
        try {
          const compressed = await compressImage(base64);
          setCompletionImage(compressed);
        } catch (err) {
          console.error("Error compressing image:", err);
          setCompletionImage(base64);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const updateTaskStatus = async (task: Task, status: TaskStatus) => {
    if (!isAuthorizedToUpdate(task)) {
      toast.error(t('tasks.unauthorizedUpdate', { defaultValue: 'You are not authorized to update this task' }));
      return;
    }

    if (status === 'completed' && !task.completed) {
      setShowCompleteConfirm(task);
      return;
    }

    try {
      const updateData: any = {
        status,
        completed: status === 'completed'
      };

      // Automatically assign to current user if picking up an unassigned task
      if (!task.assignedTo && !task.assignedTeamId && profile) {
        updateData.assignedTo = profile.uid;
        toast.info(t('tasks.autoAssigned', { defaultValue: 'Task assigned to you' }));
      }

      await updateDoc(doc(db, 'tasks', task.id), updateData);
      if (status === 'completed') {
        confetti({
          particleCount: 80,
          spread: 60,
          origin: { y: 0.7 },
          colors: ['#22c55e', '#3b82f6']
        });
      }
      toast.success(t('tasks.statusUpdated', { defaultValue: 'Task status updated' }));
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `tasks/${task.id}`);
    }
  };

  const updateTaskAssignment = async (taskId: string, userId: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (task && !isAuthorizedToUpdate(task)) {
      toast.error(t('tasks.unauthorizedUpdate', { defaultValue: 'You are not authorized to update this task' }));
      return;
    }

    try {
      await updateDoc(doc(db, 'tasks', taskId), {
        assignedTo: userId || null,
        assignedTeamId: null
      });

      // Send notification
      const assignedUser = userId ? users.find(u => u.uid === userId) : null;
      if (task) {
        const { sendTaskAlert } = await import('../services/notificationService');
        sendTaskAlert(task, assignedUser);
      }
      toast.success(t('tasks.assignmentUpdated', { defaultValue: 'Task assignment updated' }));
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `tasks/${taskId}`);
    }
  };

  const deleteTask = (id: string) => {
    setShowDeleteConfirm(id);
  };

  const confirmDeleteTask = async () => {
    if (!showDeleteConfirm) return;
    setDeleting(true);
    try {
      await deleteDoc(doc(db, 'tasks', showDeleteConfirm));
      toast.success(t('tasks.taskDeleted', { defaultValue: 'Task deleted successfully' }));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `tasks/${showDeleteConfirm}`);
    } finally {
      setDeleting(false);
      setShowDeleteConfirm(null);
    }
  };

  const filteredTasks = tasks.filter(task => {
    const currentStatus = task.status || (task.completed ? 'completed' : 'pending');
    const matchesStatus = statusFilter === 'all' || currentStatus === statusFilter;
    const matchesUser = userFilter === 'all' || task.assignedTo === userFilter;
    const matchesMyTasks = !showMyTasksOnly || task.assignedTo === profile?.uid;
    return matchesStatus && matchesUser && matchesMyTasks;
  }).sort((a, b) => {
    if (sortBy === 'priority') {
      const priorityMap = { high: 3, medium: 2, low: 1 };
      return priorityMap[b.priority] - priorityMap[a.priority];
    }
    if (sortBy === 'dueDate') {
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return a.dueDate.toMillis() - b.dueDate.toMillis();
    }
    return 0; // Default to Firestore order (createdAt desc)
  });

  const priorityColors = {
    high: 'text-red-600 bg-red-50 dark:bg-red-900/30 border-red-100 dark:border-red-900/50',
    medium: 'text-amber-600 bg-amber-50 dark:bg-amber-900/30 border-amber-100 dark:border-amber-900/50',
    low: 'text-blue-600 bg-blue-50 dark:bg-blue-900/30 border-blue-100 dark:border-blue-900/50'
  };

  const priorityIcons = {
    high: <AlertCircle className="h-4 w-4" />,
    medium: <Clock className="h-4 w-4" />,
    low: <CheckCircle className="h-4 w-4" />
  };

  const statusColors: Record<TaskStatus, string> = {
    'pending': 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700',
    'in-progress': 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800',
    'completed': 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 border-green-200 dark:border-green-800'
  };

  const cardStatusStyles: Record<TaskStatus, string> = {
    'pending': 'border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900',
    'in-progress': 'border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-900/20 shadow-sm shadow-blue-100/50 dark:shadow-none',
    'completed': 'border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-900/20 opacity-90'
  };

  const TaskSkeleton = () => (
    <div className="space-y-4">
      {[1, 2, 3].map((i) => (
        <div key={i} className="p-5 rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 animate-pulse">
          <div className="flex items-start space-x-4 rtl:space-x-reverse">
            <div className="mt-1 h-6 w-6 bg-gray-200 dark:bg-gray-800 rounded-full" />
            <div className="flex-grow space-y-3">
              <div className="flex justify-between items-center">
                <div className="h-5 w-1/3 bg-gray-200 dark:bg-gray-800 rounded-lg" />
                <div className="flex space-x-2 rtl:space-x-reverse">
                  <div className="h-5 w-16 bg-gray-200 dark:bg-gray-800 rounded-full" />
                  <div className="h-5 w-20 bg-gray-200 dark:bg-gray-800 rounded-full" />
                </div>
              </div>
              <div className="h-4 w-2/3 bg-gray-100 dark:bg-gray-800/50 rounded-lg" />
              <div className="flex space-x-4 rtl:space-x-reverse pt-2">
                <div className="h-4 w-24 bg-gray-100 dark:bg-gray-800/50 rounded-md" />
                <div className="h-4 w-32 bg-gray-100 dark:bg-gray-800/50 rounded-md" />
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between space-y-4 md:space-y-0">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white tracking-tight">{t('tasks.title')}</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">{t('tasks.subtitle')}</p>
        </div>
        {canManageTasks && (
          <button
            onClick={() => setShowAddModal(true)}
            className="inline-flex items-center justify-center px-6 py-3 border border-transparent text-base font-medium rounded-xl shadow-sm text-white bg-blue-600 hover:bg-blue-700 transition-all transform hover:scale-105 active:scale-95"
          >
            <Plus className="mr-2 h-5 w-5 rtl:mr-0 rtl:ml-2" />
            {t('tasks.addTask')}
          </button>
        )}
      </div>

      {/* Filters & Sorting */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 bg-white dark:bg-gray-900 p-3 sm:p-4 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm overflow-hidden">
        <div className="flex items-center space-x-1 rtl:space-x-reverse bg-gray-50 dark:bg-gray-800 p-1 rounded-xl overflow-x-auto no-scrollbar">
          <button
            onClick={() => setShowMyTasksOnly(!showMyTasksOnly)}
            className={cn(
              "px-3 sm:px-4 py-2 text-[10px] sm:text-sm font-bold rounded-lg transition-all whitespace-nowrap flex items-center gap-2",
              showMyTasksOnly ? "bg-blue-600 text-white shadow-sm" : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            )}
          >
            <User className="h-3 w-3 sm:h-4 sm:w-4" />
            {t('tasks.myTasks', { defaultValue: 'My Tasks' })}
          </button>
          <div className="h-4 w-px bg-gray-200 dark:bg-gray-700 mx-1" />
          {(['all', 'pending', 'in-progress', 'completed'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={cn(
                "px-3 sm:px-4 py-2 text-[10px] sm:text-sm font-bold rounded-lg transition-all capitalize whitespace-nowrap",
                statusFilter === s ? "bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 shadow-sm" : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
              )}
            >
              {t(`tasks.${s}`)}
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between sm:justify-start gap-4">
          <div className="flex items-center space-x-2 rtl:space-x-reverse">
            <User className="h-4 w-4 text-gray-400 dark:text-gray-500" />
            <select
              value={userFilter}
              onChange={(e) => setUserFilter(e.target.value)}
              disabled={showMyTasksOnly}
              className={cn(
                "bg-transparent text-sm font-medium focus:outline-none max-w-[120px] sm:max-w-[150px] truncate",
                showMyTasksOnly ? "text-gray-300 dark:text-gray-700 cursor-not-allowed" : "text-gray-600 dark:text-gray-300 cursor-pointer"
              )}
            >
              <option value="all" className="dark:bg-gray-900">{t('tasks.allUsers', { defaultValue: 'All Users' })}</option>
              <option value="" className="dark:bg-gray-900">{t('tasks.unassigned')}</option>
              {users.map(user => (
                <option key={user.uid} value={user.uid} className="dark:bg-gray-900">{user.name}</option>
              ))}
            </select>
          </div>

          <div className="h-6 w-px bg-gray-200 dark:bg-gray-800" />

          <div className="flex items-center space-x-2 rtl:space-x-reverse">
            <Filter className="h-4 w-4 text-gray-400 dark:text-gray-500" />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="bg-transparent text-sm font-medium text-gray-600 dark:text-gray-300 focus:outline-none cursor-pointer"
            >
              <option value="createdAt" className="dark:bg-gray-900">{t('tasks.sortByDateCreated', { defaultValue: 'Sort by Date Created' })}</option>
              <option value="priority" className="dark:bg-gray-900">{t('tasks.sortByPriority', { defaultValue: 'Sort by Priority' })}</option>
              <option value="dueDate" className="dark:bg-gray-900">{t('tasks.sortByDueDate', { defaultValue: 'Sort by Due Date' })}</option>
            </select>
          </div>
        </div>
      </div>

      {/* Task List */}
      <div className="space-y-4">
        {loading ? (
          <TaskSkeleton />
        ) : (
          <AnimatePresence mode="popLayout">
            {filteredTasks.length > 0 ? (
              filteredTasks.map((task) => {
                const currentStatus = task.status;
                const assignedUser = task.assignedTo ? users.find(u => u.uid === task.assignedTo) : null;
                return (
                <motion.div
                  key={task.id}
                  layout
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ 
                    opacity: task.completed ? 0.7 : 1, 
                    scale: 1,
                  }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.3 }}
                  className={cn(
                    "group p-5 rounded-2xl border transition-all hover:shadow-md relative overflow-hidden",
                    cardStatusStyles[currentStatus],
                    task.completed && "ring-2 ring-green-500/20 shadow-lg shadow-green-100/50 dark:shadow-none"
                  )}
                >
                  {/* Status Indicator Bar */}
                  <div className={cn(
                    "absolute top-0 left-0 bottom-0 w-1.5",
                    currentStatus === 'pending' ? "bg-gray-300 dark:bg-gray-700" :
                    currentStatus === 'in-progress' ? "bg-blue-500" :
                    "bg-green-500"
                  )} />

                  <div className="flex items-start space-x-3 sm:space-x-4 rtl:space-x-reverse pl-2 rtl:pl-0 rtl:pr-2">
                    <button
                      onClick={() => toggleTask(task)}
                      disabled={!isAuthorizedToUpdate(task)}
                      className={cn(
                        "mt-1 flex-shrink-0 transition-colors",
                        task.completed ? "text-green-500" : "text-gray-300 dark:text-gray-700 hover:text-blue-500 dark:hover:text-blue-400",
                        !isAuthorizedToUpdate(task) && "opacity-50 cursor-not-allowed"
                      )}
                    >
                      <motion.div
                        initial={false}
                        animate={{ scale: task.completed ? [1, 1.2, 1] : 1 }}
                        transition={{ duration: 0.3 }}
                      >
                        {task.completed ? (
                          <CheckCircle className="h-5 w-5 sm:h-6 sm:w-6" />
                        ) : (
                          <Circle className="h-5 w-5 sm:h-6 sm:w-6" />
                        )}
                      </motion.div>
                    </button>

                    <div className="flex-grow min-w-0">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div className="relative inline-block max-w-full">
                          <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3">
                            <h3 className={cn(
                              "text-base sm:text-lg font-bold truncate transition-colors duration-300",
                              task.completed ? "text-gray-400 dark:text-gray-600" : "text-gray-900 dark:text-white"
                            )}>
                              {task.title}
                            </h3>
                            {task.assignedTo && (
                              <div className="flex items-center text-[10px] sm:text-xs text-indigo-600 dark:text-indigo-400 font-semibold bg-indigo-50 dark:bg-indigo-900/20 px-2 py-0.5 rounded-full w-fit">
                                {assignedUser?.photoUrl ? (
                                  <img 
                                    src={assignedUser.photoUrl} 
                                    alt={assignedUser.name} 
                                    className="h-4 w-4 rounded-full mr-1 rtl:mr-0 rtl:ml-1 object-cover border border-indigo-200 dark:border-indigo-800" 
                                    referrerPolicy="no-referrer" 
                                  />
                                ) : (
                                  <User className="h-3 w-3 mr-1 rtl:mr-0 rtl:ml-1" />
                                )}
                                {assignedUser?.name || task.assignedTo}
                              </div>
                            )}
                            {task.completed && (
                              <motion.span
                                initial={{ opacity: 0, x: -10 }}
                                animate={{ opacity: 1, x: 0 }}
                                className="text-[10px] font-bold uppercase tracking-wider text-green-600 dark:text-green-400 bg-green-100 dark:bg-green-900/30 px-1.5 py-0.5 rounded w-fit"
                              >
                                {t('tasks.completed')}
                              </motion.span>
                            )}
                          </div>
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: task.completed ? '100%' : 0 }}
                            transition={{ duration: 0.3, ease: "easeInOut" }}
                            className="absolute top-1/2 left-0 h-[2px] bg-gray-400 dark:bg-gray-600 pointer-events-none"
                          />
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <select
                            value={currentStatus}
                            onChange={(e) => updateTaskStatus(task, e.target.value as TaskStatus)}
                            disabled={!isAuthorizedToUpdate(task)}
                            className={cn(
                              "text-[9px] sm:text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full border transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-900",
                              statusColors[currentStatus],
                              !isAuthorizedToUpdate(task) ? "opacity-60 cursor-not-allowed" : "cursor-pointer"
                            )}
                          >
                            <option value="pending" className="dark:bg-gray-900">{t('tasks.pending')}</option>
                            <option value="in-progress" className="dark:bg-gray-900">{t('tasks.in-progress')}</option>
                            <option value="completed" className="dark:bg-gray-900">{t('tasks.completed')}</option>
                          </select>
                          <div className={cn(
                            "flex-shrink-0 flex items-center space-x-1 rtl:space-x-reverse px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-full text-[9px] sm:text-[10px] font-bold uppercase tracking-wider border",
                            priorityColors[task.priority]
                          )}>
                            {priorityIcons[task.priority]}
                            <span>{t(`dashboard.priority.${task.priority}`)}</span>
                          </div>
                        </div>
                      </div>

                        {task.description && (
                          <div className="relative inline-block max-w-full">
                            <p className={cn(
                              "mt-1 text-xs sm:text-sm line-clamp-2 transition-colors duration-300",
                              task.completed ? "text-gray-400 dark:text-gray-600 italic" : "text-gray-500 dark:text-gray-400"
                            )}>
                              {task.description}
                            </p>
                            <motion.div
                              initial={{ width: 0 }}
                              animate={{ width: task.completed ? '100%' : 0 }}
                              transition={{ duration: 0.3, ease: "easeInOut", delay: 0.1 }}
                              className="absolute top-[60%] left-0 h-[1px] bg-gray-300 dark:bg-gray-700 pointer-events-none"
                            />
                          </div>
                        )}

                        {task.completionImage && (
                          <div className="mt-3">
                            <button
                              onClick={() => setViewImage(task.completionImage!)}
                              className="relative w-20 h-20 sm:w-24 sm:h-24 rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700 transition-transform hover:scale-105"
                            >
                              <CachedImage
                                cacheKey={task.id}
                                src={task.completionImage}
                                alt="Completion"
                                className="w-full h-full object-cover"
                              />
                              <div className="absolute inset-0 bg-black/20 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                                <PlayCircle className="h-6 w-6 text-white" />
                              </div>
                            </button>
                          </div>
                        )}

                        <div className="mt-3 sm:mt-4 flex flex-wrap items-center gap-y-2 gap-x-3 sm:gap-x-4 text-[10px] sm:text-xs font-medium text-gray-400 dark:text-gray-500">
                          <div className="flex items-center whitespace-nowrap">
                            <Clock className="h-3 w-3 sm:h-3.5 sm:w-3.5 mr-1 rtl:mr-0 rtl:ml-1" />
                            {formatDate(safeToDate(task.createdAt))}
                          </div>
                          {task.dueDate && (
                            <div className={cn(
                              "flex items-center px-1.5 py-0.5 rounded-md whitespace-nowrap",
                              !task.completed && safeToDate(task.dueDate).getTime() < Date.now() 
                                ? "bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400" 
                                : "bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400"
                            )}>
                              <Calendar className="h-3 w-3 sm:h-3.5 sm:w-3.5 mr-1 rtl:mr-0 rtl:ml-1" />
                              <span className="hidden sm:inline">{t('tasks.dueDate')}: </span>
                              {formatDate(safeToDate(task.dueDate))}
                            </div>
                          )}
                          <div className={cn(
                            "flex items-center px-1.5 py-0.5 rounded-md transition-colors whitespace-nowrap",
                            (task.assignedTo || task.assignedTeamId) ? "bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400" : "bg-gray-50 dark:bg-gray-800 text-gray-400 dark:text-gray-500"
                          )}>
                            {task.assignedTeamId ? (
                              <UsersRound className="h-3 w-3 sm:h-3.5 sm:w-3.5 mr-1 rtl:mr-0 rtl:ml-1" />
                            ) : (
                              assignedUser?.photoUrl ? (
                                <img 
                                  src={assignedUser.photoUrl} 
                                  alt={assignedUser.name} 
                                  className="h-4 w-4 rounded-full mr-1 rtl:mr-0 rtl:ml-1 object-cover border border-indigo-200 dark:border-indigo-800" 
                                  referrerPolicy="no-referrer" 
                                />
                              ) : (
                                <User className="h-3 w-3 sm:h-3.5 sm:w-3.5 mr-1 rtl:mr-0 rtl:ml-1" />
                              )
                            )}
                            {task.assignedTeamId ? (
                              <span className="text-[9px] sm:text-[10px] font-bold uppercase tracking-wider">
                                {teams.find(t => t.id === task.assignedTeamId)?.name || t('tasks.team')}
                              </span>
                            ) : (
                              <>
                                {canManageTasks ? (
                                  <select
                                    value={task.assignedTo || ''}
                                    onChange={(e) => updateTaskAssignment(task.id, e.target.value)}
                                    className={cn(
                                      "bg-transparent border-none focus:ring-0 text-[9px] sm:text-[10px] font-bold uppercase tracking-wider p-0 max-w-[120px] sm:max-w-none truncate cursor-pointer"
                                    )}
                                  >
                                    <option value="" className="dark:bg-gray-900">{t('tasks.unassigned')}</option>
                                    {users.map(user => (
                                      <option key={user.uid} value={user.uid} className="dark:bg-gray-900">{user.name}</option>
                                    ))}
                                    {/* Fallback for pre-provisioned user not in list */}
                                    {task.assignedTo && !users.find(u => u.uid === task.assignedTo) && (
                                      <option value={task.assignedTo} className="dark:bg-gray-900">{task.assignedTo}</option>
                                    )}
                                  </select>
                                ) : (
                                  <span className="text-[9px] sm:text-[10px] font-bold uppercase tracking-wider">
                                    {users.find(u => u.uid === task.assignedTo)?.name || task.assignedTo || t('tasks.unassigned')}
                                  </span>
                                )}
                              </>
                            )}
                          </div>

                          {!task.assignedTo && !task.completed && (
                            <button
                              onClick={() => updateTaskAssignment(task.id, profile?.uid || '')}
                              className="flex items-center px-3 py-1.5 rounded-xl bg-indigo-600 text-white text-[11px] sm:text-xs font-bold uppercase tracking-wider hover:bg-indigo-700 transition-all shadow-md hover:shadow-lg active:scale-95"
                            >
                              <UserPlus className="h-3.5 w-3.5 mr-1.5" />
                              {t('tasks.accept', { defaultValue: 'Pick Up Task' })}
                            </button>
                          )}
                      </div>
                    </div>

                    {(isAdmin || task.createdBy === profile?.uid) && (
                      <button
                        onClick={() => deleteTask(task.id)}
                        className="flex-shrink-0 p-2 text-gray-300 dark:text-gray-700 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-xl transition-all opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                      >
                        <Trash2 className="h-4 w-4 sm:h-5 sm:w-5" />
                      </button>
                    )}
                  </div>
                </motion.div>
              );
            })
          ) : (
            <div className="bg-white dark:bg-gray-900 py-16 text-center rounded-3xl border border-dashed border-gray-200 dark:border-gray-800">
              <div className="bg-gray-50 dark:bg-gray-800 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                <Check className="h-8 w-8 text-gray-300 dark:text-gray-600" />
              </div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">{t('tasks.noTasksFound')}</h3>
              <p className="text-gray-500 dark:text-gray-400 mt-1">{t('tasks.noTasksSubtitle')}</p>
            </div>
          )}
        </AnimatePresence>
      )}
      </div>

      {/* Add Task Modal */}
      <AnimatePresence>
        {showAddModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white dark:bg-gray-900 rounded-3xl shadow-2xl w-full max-w-md overflow-hidden border border-gray-100 dark:border-gray-800"
            >
              <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center bg-gray-50 dark:bg-gray-800/50">
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">{t('tasks.createTask')}</h3>
                <button 
                  onClick={() => setShowAddModal(false)} 
                  className="p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full transition-colors"
                >
                  <ChevronDown className="h-5 w-5 text-gray-500 dark:text-gray-400" />
                </button>
              </div>

              <form onSubmit={handleAddTask} className="p-6 space-y-6">
                <div>
                  <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-2">{t('tasks.taskTitle')}</label>
                  <input
                    type="text"
                    required
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder={t('tasks.taskTitlePlaceholder', { defaultValue: 'e.g. Restock dairy section' })}
                    className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                  />
                </div>

                <div>
                  <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-2">{t('tasks.taskDescription')}</label>
                  <textarea
                    required
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder={t('tasks.taskDescriptionPlaceholder', { defaultValue: 'Add more details...' })}
                    rows={3}
                    className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all resize-none"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-2">{t('tasks.priority')}</label>
                    <div className="relative">
                      <select
                        value={priority}
                        onChange={(e) => setPriority(e.target.value as Priority)}
                        className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 appearance-none transition-all font-medium"
                      >
                        <option value="low" className="dark:bg-gray-900">{t('dashboard.priority.low')}</option>
                        <option value="medium" className="dark:bg-gray-900">{t('dashboard.priority.medium')}</option>
                        <option value="high" className="dark:bg-gray-900">{t('dashboard.priority.high')}</option>
                      </select>
                      <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 dark:text-gray-500 pointer-events-none" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-2">{t('tasks.dueDate')}</label>
                    <input
                      type="date"
                      value={dueDate}
                      onChange={(e) => setDueDate(e.target.value)}
                      className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all font-medium"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-2">{t('tasks.assignedTo')} ({t('common.optional')})</label>
                  <div className="relative">
                    <select
                      value={assignedTo ? `user:${assignedTo}` : assignedTeamId ? `team:${assignedTeamId}` : ""}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (!val) {
                          setAssignedTo('');
                          setAssignedTeamId('');
                          return;
                        }
                        const [type, id] = val.split(':');
                        if (type === 'user') {
                          setAssignedTo(id);
                          setAssignedTeamId('');
                        } else if (type === 'team') {
                          setAssignedTeamId(id);
                          setAssignedTo('');
                        }
                      }}
                      className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 appearance-none transition-all font-medium"
                    >
                      <option value="" className="dark:bg-gray-900">{t('tasks.unassigned')}</option>
                      <optgroup label={t('tasks.users', { defaultValue: 'Users' })} className="dark:bg-gray-900">
                        {users.map(user => (
                          <option key={user.uid} value={`user:${user.uid}`} className="dark:bg-gray-900">{user.name}</option>
                        ))}
                      </optgroup>
                      <optgroup label={t('settings.teams', { defaultValue: 'Teams' })} className="dark:bg-gray-900">
                        {teams.map(team => (
                          <option key={team.id} value={`team:${team.id}`} className="dark:bg-gray-900">{team.name}</option>
                        ))}
                      </optgroup>
                    </select>
                    <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 dark:text-gray-500 pointer-events-none" />
                  </div>
                </div>

                <div className="pt-4 flex space-x-3 rtl:space-x-reverse">
                  <button
                    type="button"
                    onClick={() => setShowAddModal(false)}
                    className="flex-1 px-4 py-3.5 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 font-bold rounded-2xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-all"
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="flex-1 px-4 py-3.5 bg-blue-600 text-white font-bold rounded-2xl hover:bg-blue-700 transition-all shadow-lg shadow-blue-200 dark:shadow-none disabled:opacity-50"
                  >
                    {submitting ? t('common.saving') : t('tasks.createTask')}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {showDeleteConfirm && (
          <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white dark:bg-gray-900 rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden border border-gray-100 dark:border-gray-800"
            >
              <div className="p-8 text-center">
                <div className="bg-red-100 dark:bg-red-900/30 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Trash2 className="h-8 w-8 text-red-600 dark:text-red-400" />
                </div>
                <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">{t('tasks.confirmDelete', { defaultValue: 'Confirm Delete' })}</h3>
                <p className="text-gray-500 dark:text-gray-400 text-sm mb-6">
                  {t('tasks.deleteTaskConfirm')}
                </p>
                <div className="space-y-3">
                  <button
                    onClick={confirmDeleteTask}
                    disabled={deleting}
                    className="w-full py-4 bg-red-600 text-white font-bold rounded-2xl hover:bg-red-700 transition-all shadow-md disabled:opacity-50"
                  >
                    {deleting ? t('common.loading') : t('common.delete')}
                  </button>
                  <button
                    onClick={() => setShowDeleteConfirm(null)}
                    disabled={deleting}
                    className="w-full py-4 bg-white dark:bg-gray-800 border-2 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 font-bold rounded-2xl hover:bg-gray-50 dark:hover:bg-gray-700 transition-all disabled:opacity-50"
                  >
                    {t('common.cancel')}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Complete Confirmation Modal */}
      <AnimatePresence>
        {showCompleteConfirm && (
          <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white dark:bg-gray-900 rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden border border-gray-100 dark:border-gray-800"
            >
              <div className="p-8 text-center">
                <div className="bg-green-100 dark:bg-green-900/30 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                  <CheckCircle className="h-8 w-8 text-green-600 dark:text-green-400" />
                </div>
                <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">{t('tasks.confirmComplete', { defaultValue: 'Complete Task?' })}</h3>
                <p className="text-gray-500 dark:text-gray-400 text-sm mb-6">
                  {t('tasks.completeTaskConfirm', { defaultValue: 'Are you sure you want to mark this task as completed?' })}
                </p>

                {/* Image Upload for Completion */}
                <div className="mb-6">
                  <label className="block text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-3 text-left">
                    {t('tasks.completionProof', { defaultValue: 'Completion Proof (Optional)' })}
                  </label>
                  
                  {completionImage ? (
                    <div className="relative group rounded-2xl overflow-hidden aspect-video bg-gray-100 dark:bg-gray-800 border-2 border-dashed border-gray-200 dark:border-gray-700">
                      <img 
                        src={completionImage} 
                        alt="Completion preview" 
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <button
                          onClick={() => setCompletionImage(null)}
                          className="p-2 bg-red-600 text-white rounded-full hover:bg-red-700 transition-colors"
                        >
                          <X className="h-5 w-5" />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        onClick={() => document.getElementById('task-image-upload')?.click()}
                        className="flex flex-col items-center justify-center p-4 bg-gray-50 dark:bg-gray-800/50 border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-2xl hover:bg-gray-100 dark:hover:bg-gray-800 transition-all group"
                      >
                        <Upload className="h-6 w-6 text-gray-400 group-hover:text-blue-500 mb-2" />
                        <span className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase">{t('common.upload')}</span>
                      </button>
                      <button
                        onClick={() => {
                          // In a real app we might use a camera component, 
                          // but for now we'll just trigger the file input with capture
                          const input = document.getElementById('task-image-upload') as HTMLInputElement;
                          if (input) {
                            input.setAttribute('capture', 'environment');
                            input.click();
                          }
                        }}
                        className="flex flex-col items-center justify-center p-4 bg-gray-50 dark:bg-gray-800/50 border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-2xl hover:bg-gray-100 dark:hover:bg-gray-800 transition-all group"
                      >
                        <Camera className="h-6 w-6 text-gray-400 group-hover:text-blue-500 mb-2" />
                        <span className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase">{t('common.camera')}</span>
                      </button>
                      <input 
                        id="task-image-upload"
                        type="file" 
                        accept="image/*" 
                        className="hidden" 
                        onChange={handleImageSelect}
                      />
                    </div>
                  )}
                </div>

                <div className="space-y-3">
                  <button
                    onClick={confirmCompleteTask}
                    disabled={completing}
                    className="w-full py-4 bg-green-600 text-white font-bold rounded-2xl hover:bg-green-700 transition-all shadow-md disabled:opacity-50"
                  >
                    {completing ? t('common.loading') : t('common.confirm')}
                  </button>
                  <button
                    onClick={() => setShowCompleteConfirm(null)}
                    disabled={completing}
                    className="w-full py-4 bg-white dark:bg-gray-800 border-2 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 font-bold rounded-2xl hover:bg-gray-50 dark:hover:bg-gray-700 transition-all disabled:opacity-50"
                  >
                    {t('common.cancel')}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      {/* View Image Modal */}
      <AnimatePresence>
        {viewImage && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/90 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="relative max-w-4xl w-full h-full flex items-center justify-center"
            >
              <button
                onClick={() => setViewImage(null)}
                className="absolute top-4 right-4 p-3 bg-white/10 hover:bg-white/20 text-white rounded-full transition-colors z-10"
              >
                <ChevronDown className="h-6 w-6" />
              </button>
              <CachedImage
                cacheKey={tasks.find(t => t.completionImage === viewImage)?.id || ''}
                src={viewImage}
                alt="Completion Full"
                className="max-w-full max-h-full object-contain rounded-2xl shadow-2xl"
              />
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Tasks;
