import React, { useEffect, useState, useRef } from 'react';
import { 
  collection, onSnapshot, query, orderBy, 
  addDoc, serverTimestamp, limit
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { ChatMessage } from '../types';
import { useAuth } from '../components/AuthGuard';
import { Send, User, MessageSquare, Loader2, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { cn } from '../lib/utils';
import { format, isToday, isYesterday, isSameDay } from 'date-fns';

const Chat: React.FC = () => {
  const { profile, loading: authLoading } = useAuth();
  const { t } = useTranslation();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const path = 'chatMessages';
    const q = query(
      collection(db, path), 
      orderBy('createdAt', 'desc'),
      limit(100)
    );
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgs = snapshot.docs.map(doc => ({ 
        id: doc.id, 
        ...doc.data() 
      } as ChatMessage)).reverse();
      setMessages(msgs);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, path);
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (scrollRef.current && !showScrollButton) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, showScrollButton]);

  const handleScroll = () => {
    if (scrollRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
      const isNearBottom = scrollHeight - scrollTop - clientHeight < 100;
      setShowScrollButton(!isNearBottom);
    }
  };

  const scrollToBottom = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: 'smooth'
      });
      setShowScrollButton(false);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !profile || sending) return;

    const messageText = newMessage.trim();
    setNewMessage(''); // Clear immediately for better UX
    setSending(true);
    try {
      await addDoc(collection(db, 'chatMessages'), {
        text: messageText,
        senderId: profile.uid,
        senderName: profile.name || t('common.unknownUser'),
        senderPhotoUrl: profile.photoUrl || null,
        createdAt: serverTimestamp()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'chatMessages');
      setNewMessage(messageText); // Restore on error
    } finally {
      setSending(false);
    }
  };

  const convertToDate = (timestamp: any): Date => {
    if (!timestamp) return new Date();
    return timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  };

  const formatMessageTime = (timestamp: any) => {
    const date = convertToDate(timestamp);
    return format(date, 'HH:mm');
  };

  const getDateLabel = (timestamp: any) => {
    const date = convertToDate(timestamp);
    if (isToday(date)) return t('chat.today');
    if (isYesterday(date)) return t('chat.yesterday');
    return format(date, 'MMM d, yyyy');
  };

  if (authLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="h-8 w-8 text-blue-600 animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto h-[calc(100vh-12rem)] flex flex-col bg-white dark:bg-gray-900 rounded-3xl border border-gray-100 dark:border-gray-800 shadow-xl overflow-hidden transition-all duration-300 relative">
      {/* Chat Header */}
      <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between bg-white/80 dark:bg-gray-900/80 backdrop-blur-md sticky top-0 z-20">
        <div className="flex items-center space-x-3 rtl:space-x-reverse">
          <div className="bg-blue-100 dark:bg-blue-900/30 p-2 rounded-xl">
            <MessageSquare className="h-6 w-6 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white tracking-tight">
              {t('chat.title')}
            </h1>
            <p className="text-xs text-green-500 font-medium flex items-center">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 mr-1.5 rtl:mr-0 rtl:ml-1.5 animate-pulse" />
              {t('chat.online')}
            </p>
          </div>
        </div>
      </div>

      {/* Messages Area */}
      <div 
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-grow overflow-y-auto p-6 space-y-4 scroll-smooth no-scrollbar bg-gray-50/30 dark:bg-gray-900/30"
      >
        {loading ? (
          <div className="h-full flex items-center justify-center">
            <Loader2 className="h-8 w-8 text-blue-600 animate-spin" />
          </div>
        ) : messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-gray-400 space-y-4">
            <div className="p-6 bg-gray-100 dark:bg-gray-800 rounded-full">
              <MessageSquare className="h-12 w-12 opacity-20" />
            </div>
            <p className="font-medium">{t('chat.noMessages')}</p>
          </div>
        ) : (
          <div className="space-y-6">
            {messages.map((msg, index) => {
              const isMe = msg.senderId === profile?.uid;
              const prevMsg = index > 0 ? messages[index - 1] : null;
              const nextMsg = index < messages.length - 1 ? messages[index + 1] : null;
              
              const isFirstInGroup = !prevMsg || prevMsg.senderId !== msg.senderId;
              const isLastInGroup = !nextMsg || nextMsg.senderId !== msg.senderId;
              
              const showDateSeparator = !prevMsg || !isSameDay(
                convertToDate(prevMsg.createdAt),
                convertToDate(msg.createdAt)
              );

              return (
                <React.Fragment key={msg.id}>
                  {showDateSeparator && (
                    <div className="flex justify-center my-6">
                      <span className="px-3 py-1 bg-gray-200/50 dark:bg-gray-800/50 text-gray-500 dark:text-gray-400 text-[10px] font-bold rounded-full uppercase tracking-wider backdrop-blur-sm">
                        {getDateLabel(msg.createdAt)}
                      </span>
                    </div>
                  )}
                  
                  <motion.div
                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    className={cn(
                      "flex items-end space-x-2 rtl:space-x-reverse group",
                      isMe ? "flex-row-reverse space-x-reverse" : "flex-row",
                      !isLastInGroup && "mb-1"
                    )}
                  >
                    {/* Avatar */}
                    {!isMe && (
                      <div className={cn(
                        "flex-shrink-0 w-8 h-8 rounded-full overflow-hidden bg-white dark:bg-gray-800 flex items-center justify-center border border-gray-100 dark:border-gray-700 shadow-sm transition-all duration-300",
                        !isLastInGroup && "opacity-0 scale-75"
                      )}>
                        {msg.senderPhotoUrl ? (
                          <img 
                            src={msg.senderPhotoUrl} 
                            alt={msg.senderName} 
                            className="w-full h-full object-cover"
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          <User className="h-4 w-4 text-gray-400" />
                        )}
                      </div>
                    )}

                    {/* Message Bubble Container */}
                    <div className={cn(
                      "max-w-[80%] flex flex-col",
                      isMe ? "items-end" : "items-start"
                    )}>
                      {isFirstInGroup && !isMe && (
                        <span className="text-[10px] font-bold text-gray-500 dark:text-gray-400 mb-1 px-2">
                          {msg.senderName}
                        </span>
                      )}
                      
                      <div className="relative group">
                        <div className={cn(
                          "px-4 py-2.5 text-sm shadow-sm transition-all duration-300",
                          isMe 
                            ? "bg-blue-600 text-white rounded-2xl rounded-br-none" 
                            : "bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-2xl rounded-bl-none border border-gray-100 dark:border-gray-700",
                          !isFirstInGroup && (isMe ? "rounded-tr-none" : "rounded-tl-none"),
                          !isLastInGroup && (isMe ? "rounded-br-2xl" : "rounded-bl-2xl")
                        )}>
                          {msg.text}
                        </div>
                        
                        {/* Hover Timestamp */}
                        <div className={cn(
                          "absolute top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 whitespace-nowrap",
                          isMe ? "right-full mr-2" : "left-full ml-2"
                        )}>
                          <span className="text-[9px] text-gray-400 font-medium bg-white/80 dark:bg-gray-900/80 px-1.5 py-0.5 rounded-md backdrop-blur-sm border border-gray-100 dark:border-gray-800">
                            {formatMessageTime(msg.createdAt)}
                          </span>
                        </div>
                      </div>

                      {isLastInGroup && (
                        <span className={cn(
                          "text-[9px] text-gray-400 mt-1 px-2 font-medium",
                          isMe && "text-right"
                        )}>
                          {formatMessageTime(msg.createdAt)}
                        </span>
                      )}
                    </div>

                    {/* My Avatar (Optional, usually not shown in modern chats but user asked for avatars) */}
                    {isMe && (
                      <div className={cn(
                        "flex-shrink-0 w-8 h-8 rounded-full overflow-hidden bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center border border-blue-100 dark:border-blue-900/30 shadow-sm transition-all duration-300",
                        !isLastInGroup && "opacity-0 scale-75"
                      )}>
                        {msg.senderPhotoUrl ? (
                          <img 
                            src={msg.senderPhotoUrl} 
                            alt={msg.senderName} 
                            className="w-full h-full object-cover"
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          <User className="h-4 w-4 text-blue-400" />
                        )}
                      </div>
                    )}
                  </motion.div>
                </React.Fragment>
              );
            })}
          </div>
        )}
      </div>

      {/* Scroll to Bottom Button */}
      <AnimatePresence>
        {showScrollButton && (
          <motion.button
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            onClick={scrollToBottom}
            className="absolute bottom-24 right-6 p-2 bg-white dark:bg-gray-800 text-blue-600 dark:text-blue-400 rounded-full shadow-lg border border-gray-100 dark:border-gray-700 z-30 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            <ChevronDown className="h-5 w-5" />
          </motion.button>
        )}
      </AnimatePresence>

      {/* Input Area */}
      <div className="p-4 bg-white dark:bg-gray-900 border-t border-gray-100 dark:border-gray-800 backdrop-blur-md">
        <form onSubmit={handleSendMessage} className="flex items-center space-x-2 rtl:space-x-reverse">
          <div className="flex-grow relative">
            <input
              type="text"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              placeholder={t('chat.placeholder')}
              className="w-full bg-gray-50 dark:bg-gray-800 border-transparent dark:border-transparent rounded-2xl px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500 focus:bg-white dark:focus:bg-gray-700 transition-all dark:text-white pr-10"
            />
          </div>
          <button
            type="submit"
            disabled={!newMessage.trim() || sending}
            className={cn(
              "p-3 rounded-2xl transition-all flex items-center justify-center shadow-md",
              newMessage.trim() && !sending
                ? "bg-blue-600 text-white hover:bg-blue-700 hover:scale-105 active:scale-95 shadow-blue-500/20"
                : "bg-gray-100 dark:bg-gray-800 text-gray-400 cursor-not-allowed"
            )}
          >
            {sending ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Send className="h-5 w-5 rtl:rotate-180" />
            )}
          </button>
        </form>
      </div>
    </div>
  );
};

export default Chat;
