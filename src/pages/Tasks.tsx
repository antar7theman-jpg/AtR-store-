import React, { useEffect, useState } from 'react';
import { 
  collection, onSnapshot, query, orderBy, 
  addDoc, updateDoc, deleteDoc, doc, 
  serverTimestamp, Timestamp 
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { Task, Priority, UserProfile } from '../types';
import { useAuth } from '../components/AuthGuard';
import { 
  Plus, CheckCircle, Circle, Trash2, 
  AlertCircle, Clock, Filter, ChevronDown,
  Calendar, MoreVertical, Check, User
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn, formatDate } from '../lib/utils';
import { useTranslation } from 'react-i18next';

const Tasks: React.FC = () => {
  const { profile } = useAuth();
  const { t } = useTranslation();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [filter, setFilter] = useState<'all' | 'pending' | 'completed'>('all');
  const [sortBy, setSortBy] = useState<'createdAt' | 'priority' | 'dueDate'>('createdAt');

  // Form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<Priority>('medium');
  const [dueDate, setDueDate] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [submitting, setSubmitting] = useState(false);

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

    return () => {
      unsubscribeTasks();
      unsubscribeUsers();
    };
  }, []);

  const handleAddTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile || !title.trim()) return;

    setSubmitting(true);
    try {
      const taskData: any = {
        title: title.trim(),
        description: description.trim(),
        priority,
        completed: false,
        createdAt: serverTimestamp(),
        createdBy: profile.uid,
      };

      if (dueDate) {
        taskData.dueDate = Timestamp.fromDate(new Date(dueDate));
      }

      if (assignedTo) {
        taskData.assignedTo = assignedTo;
      }

      const taskRef = await addDoc(collection(db, 'tasks'), taskData);
      
      // Send notification if high priority or assigned to someone
      if (priority === 'high' || assignedTo) {
        const { sendTaskAlert } = await import('../services/notificationService');
        const assignedUser = assignedTo ? users.find(u => u.uid === assignedTo) : null;
        sendTaskAlert({ ...taskData, id: taskRef.id }, assignedUser);
      }
      
      // Reset form
      setTitle('');
      setDescription('');
      setPriority('medium');
      setDueDate('');
      setAssignedTo('');
      setShowAddModal(false);
    } catch (error) {
      console.error("Error adding task:", error);
    } finally {
      setSubmitting(false);
    }
  };

  const toggleTask = async (task: Task) => {
    try {
      await updateDoc(doc(db, 'tasks', task.id), {
        completed: !task.completed
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `tasks/${task.id}`);
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
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `tasks/${showDeleteConfirm}`);
    } finally {
      setDeleting(false);
      setShowDeleteConfirm(null);
    }
  };

  const filteredTasks = tasks.filter(task => {
    if (filter === 'pending') return !task.completed;
    if (filter === 'completed') return task.completed;
    return true;
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
    high: 'text-red-600 bg-red-50 border-red-100',
    medium: 'text-amber-600 bg-amber-50 border-amber-100',
    low: 'text-blue-600 bg-blue-50 border-blue-100'
  };

  const priorityIcons = {
    high: <AlertCircle className="h-4 w-4" />,
    medium: <Clock className="h-4 w-4" />,
    low: <CheckCircle className="h-4 w-4" />
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between space-y-4 md:space-y-0">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight">{t('tasks.title')}</h1>
          <p className="text-gray-500 mt-1">{t('tasks.subtitle')}</p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="inline-flex items-center justify-center px-6 py-3 border border-transparent text-base font-medium rounded-xl shadow-sm text-white bg-blue-600 hover:bg-blue-700 transition-all transform hover:scale-105 active:scale-95"
        >
          <Plus className="mr-2 h-5 w-5 rtl:mr-0 rtl:ml-2" />
          {t('tasks.addTask')}
        </button>
      </div>

      {/* Filters & Sorting */}
      <div className="flex flex-wrap items-center gap-4 bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
        <div className="flex items-center space-x-2 rtl:space-x-reverse bg-gray-50 p-1 rounded-xl">
          {(['all', 'pending', 'completed'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                "px-4 py-2 text-sm font-bold rounded-lg transition-all capitalize",
                filter === f ? "bg-white text-blue-600 shadow-sm" : "text-gray-500 hover:text-gray-700"
              )}
            >
              {t(`tasks.${f}`)}
            </button>
          ))}
        </div>

        <div className="h-8 w-px bg-gray-200 hidden md:block" />

        <div className="flex items-center space-x-2 rtl:space-x-reverse">
          <Filter className="h-4 w-4 text-gray-400" />
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            className="bg-transparent text-sm font-medium text-gray-600 focus:outline-none cursor-pointer"
          >
            <option value="createdAt">{t('tasks.sortByDateCreated', { defaultValue: 'Sort by Date Created' })}</option>
            <option value="priority">{t('tasks.sortByPriority', { defaultValue: 'Sort by Priority' })}</option>
            <option value="dueDate">{t('tasks.sortByDueDate', { defaultValue: 'Sort by Due Date' })}</option>
          </select>
        </div>
      </div>

      {/* Task List */}
      <div className="space-y-4">
        <AnimatePresence mode="popLayout">
          {filteredTasks.length > 0 ? (
            filteredTasks.map((task) => (
              <motion.div
                key={task.id}
                layout
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className={cn(
                  "group bg-white p-5 rounded-2xl border transition-all hover:shadow-md",
                  task.completed ? "border-gray-100 opacity-75" : "border-gray-200"
                )}
              >
                <div className="flex items-start space-x-4 rtl:space-x-reverse">
                  <button
                    onClick={() => toggleTask(task)}
                    className={cn(
                      "mt-1 flex-shrink-0 transition-colors",
                      task.completed ? "text-green-500" : "text-gray-300 hover:text-blue-500"
                    )}
                  >
                    {task.completed ? (
                      <CheckCircle className="h-6 w-6" />
                    ) : (
                      <Circle className="h-6 w-6" />
                    )}
                  </button>

                  <div className="flex-grow min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className={cn(
                        "text-lg font-bold truncate",
                        task.completed ? "text-gray-400 line-through" : "text-gray-900"
                      )}>
                        {task.title}
                      </h3>
                      <div className={cn(
                        "flex-shrink-0 flex items-center space-x-1 rtl:space-x-reverse px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border",
                        priorityColors[task.priority]
                      )}>
                        {priorityIcons[task.priority]}
                        <span>{t(`dashboard.priority.${task.priority}`)}</span>
                      </div>
                    </div>

                    {task.description && (
                      <p className={cn(
                        "mt-1 text-sm line-clamp-2",
                        task.completed ? "text-gray-300" : "text-gray-500"
                      )}>
                        {task.description}
                      </p>
                    )}

                    <div className="mt-4 flex flex-wrap items-center gap-4 text-xs font-medium text-gray-400">
                      <div className="flex items-center">
                        <Clock className="h-3.5 w-3.5 mr-1 rtl:mr-0 rtl:ml-1" />
                        {formatDate(task.createdAt.toDate())}
                      </div>
                      {task.dueDate && (
                        <div className={cn(
                          "flex items-center px-2 py-0.5 rounded-md",
                          !task.completed && task.dueDate.toMillis() < Date.now() 
                            ? "bg-red-50 text-red-600" 
                            : "bg-gray-50 text-gray-500"
                        )}>
                          <Calendar className="h-3.5 w-3.5 mr-1 rtl:mr-0 rtl:ml-1" />
                          {t('tasks.dueDate')}: {formatDate(task.dueDate.toDate())}
                        </div>
                      )}
                      {task.assignedTo && (
                        <div className="flex items-center px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-600">
                          <User className="h-3.5 w-3.5 mr-1 rtl:mr-0 rtl:ml-1" />
                          {t('tasks.assignedTo')}: {users.find(u => u.uid === task.assignedTo)?.name || t('common.unknown')}
                        </div>
                      )}
                    </div>
                  </div>

                  <button
                    onClick={() => deleteTask(task.id)}
                    className="flex-shrink-0 p-2 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all opacity-0 group-hover:opacity-100"
                  >
                    <Trash2 className="h-5 w-5" />
                  </button>
                </div>
              </motion.div>
            ))
          ) : (
            <div className="bg-white py-16 text-center rounded-3xl border border-dashed border-gray-200">
              <div className="bg-gray-50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                <Check className="h-8 w-8 text-gray-300" />
              </div>
              <h3 className="text-lg font-bold text-gray-900">{t('tasks.noTasksFound')}</h3>
              <p className="text-gray-500 mt-1">{t('tasks.noTasksSubtitle')}</p>
            </div>
          )}
        </AnimatePresence>
      </div>

      {/* Add Task Modal */}
      <AnimatePresence>
        {showAddModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden"
            >
              <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                <h3 className="text-lg font-bold text-gray-900">{t('tasks.createTask')}</h3>
                <button 
                  onClick={() => setShowAddModal(false)} 
                  className="p-2 hover:bg-gray-200 rounded-full transition-colors"
                >
                  <ChevronDown className="h-5 w-5 text-gray-500" />
                </button>
              </div>

              <form onSubmit={handleAddTask} className="p-6 space-y-6">
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">{t('tasks.taskTitle')}</label>
                  <input
                    type="text"
                    required
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder={t('tasks.taskTitlePlaceholder', { defaultValue: 'e.g. Restock dairy section' })}
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                  />
                </div>

                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">{t('tasks.taskDescription')} ({t('common.optional')})</label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder={t('tasks.taskDescriptionPlaceholder', { defaultValue: 'Add more details...' })}
                    rows={3}
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all resize-none"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-2">{t('tasks.priority')}</label>
                    <div className="relative">
                      <select
                        value={priority}
                        onChange={(e) => setPriority(e.target.value as Priority)}
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 appearance-none transition-all font-medium"
                      >
                        <option value="low">{t('dashboard.priority.low')}</option>
                        <option value="medium">{t('dashboard.priority.medium')}</option>
                        <option value="high">{t('dashboard.priority.high')}</option>
                      </select>
                      <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-2">{t('tasks.dueDate')}</label>
                    <input
                      type="date"
                      value={dueDate}
                      onChange={(e) => setDueDate(e.target.value)}
                      className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all font-medium"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">{t('tasks.assignedTo')} ({t('common.optional')})</label>
                  <div className="relative">
                    <select
                      value={assignedTo}
                      onChange={(e) => setAssignedTo(e.target.value)}
                      className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 appearance-none transition-all font-medium"
                    >
                      <option value="">{t('tasks.unassigned')}</option>
                      {users.map(user => (
                        <option key={user.uid} value={user.uid}>{user.name}</option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
                  </div>
                </div>

                <div className="pt-4 flex space-x-3 rtl:space-x-reverse">
                  <button
                    type="button"
                    onClick={() => setShowAddModal(false)}
                    className="flex-1 px-4 py-3.5 border border-gray-200 text-gray-700 font-bold rounded-2xl hover:bg-gray-50 transition-all"
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="flex-1 px-4 py-3.5 bg-blue-600 text-white font-bold rounded-2xl hover:bg-blue-700 transition-all shadow-lg shadow-blue-200 disabled:opacity-50"
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
              className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden"
            >
              <div className="p-8 text-center">
                <div className="bg-red-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Trash2 className="h-8 w-8 text-red-600" />
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-2">{t('tasks.confirmDelete', { defaultValue: 'Confirm Delete' })}</h3>
                <p className="text-gray-500 text-sm mb-6">
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
                    className="w-full py-4 bg-white border-2 border-gray-200 text-gray-700 font-bold rounded-2xl hover:bg-gray-50 transition-all disabled:opacity-50"
                  >
                    {t('common.cancel')}
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

export default Tasks;
