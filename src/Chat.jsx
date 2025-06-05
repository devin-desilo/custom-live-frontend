import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';

function Chat({ roomId, userId, username, socket }) {
  const [messages, setMessages] = useState([]);
  const [message, setMessage] = useState('');
  const [viewerCount, setViewerCount] = useState(0);
  const chatContainerRef = useRef(null);

  // Use the socket passed from parent or create a new one
  const socketRef = useRef(socket || io(process.env.REACT_APP_SOCKET_URL, {
    query: { roomId },
    autoConnect: true
  }));

  useEffect(() => {
    const currentSocket = socketRef.current;
    
    if (!currentSocket) return;

    // Set up event listeners
    const handleChatMessage = (msgData) => {
      console.log('Received chat message:', msgData);
      // Prevent duplicate messages by checking if message already exists
      setMessages((prevMessages) => {
        const exists = prevMessages.some(msg => msg.id === msgData.id);
        if (exists) {
          console.log('Duplicate message detected, skipping:', msgData.id);
          return prevMessages;
        }
        return [...prevMessages, msgData];
      });
    };

    const handleViewerCount = (count) => {
      setViewerCount(count);
    };

    const handleStreamStarted = () => {
      const systemMessage = {
        id: `stream_started_${Date.now()}_${Math.random()}`, // Ensure unique ID
        roomId,
        message: 'Live stream has started! Welcome everyone! 🎉',
        username: 'System',
        timestamp: new Date().toISOString(),
        userId: 'system',
        isSystem: true
      };
      
      setMessages((prevMessages) => {
        // Check if we already have a stream started message
        const hasStreamStarted = prevMessages.some(msg => 
          msg.isSystem && msg.message.includes('Live stream has started')
        );
        if (hasStreamStarted) {
          console.log('Stream started message already exists, skipping duplicate');
          return prevMessages;
        }
        return [...prevMessages, systemMessage];
      });
    };

    const handleStreamEnded = () => {
      const systemMessage = {
        id: `stream_ended_${Date.now()}_${Math.random()}`, // Ensure unique ID
        roomId,
        message: 'Live stream has ended. Thanks for watching! 👋',
        username: 'System',
        timestamp: new Date().toISOString(),
        userId: 'system',
        isSystem: true
      };
      
      setMessages((prevMessages) => {
        // Check if we already have a stream ended message
        const hasStreamEnded = prevMessages.some(msg => 
          msg.isSystem && msg.message.includes('Live stream has ended')
        );
        if (hasStreamEnded) {
          console.log('Stream ended message already exists, skipping duplicate');
          return prevMessages;
        }
        return [...prevMessages, systemMessage];
      });
    };

    // Add event listeners
    currentSocket.on('chat_message', handleChatMessage);
    currentSocket.on('viewerCount', handleViewerCount);
    currentSocket.on('stream_started', handleStreamStarted);
    currentSocket.on('stream_ended', handleStreamEnded);

    // Join room notification
    if (roomId && username) {
      currentSocket.emit('join_room_notification', { roomId, username });
    }

    // Cleanup function
    return () => {
      if (currentSocket) {
        currentSocket.off('chat_message', handleChatMessage);
        currentSocket.off('viewerCount', handleViewerCount);
        currentSocket.off('stream_started', handleStreamStarted);
        currentSocket.off('stream_ended', handleStreamEnded);
        
        // Send leave notification
        if (roomId && username) {
          currentSocket.emit('leave_room_notification', { roomId, username });
        }
      }
    };
  }, [roomId, username]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [messages]);

  const sendMessage = (e) => {
    e.preventDefault();
    if (message.trim() && socketRef.current && roomId) {
      const messageData = {
        roomId,
        message: message.trim(),
        username: username || 'Anonymous',
        timestamp: new Date().toISOString()
      };
      
      socketRef.current.emit('chat_message', messageData);
      setMessage('');
    }
  };

  const formatTime = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const formatMessage = (msg) => {
    if (msg.isSystem) {
      return (
        <div key={msg.id} className="text-center text-sm text-gray-500 py-1 italic">
          {msg.message}
        </div>
      );
    }

    const isOwnMessage = msg.userId === userId;
    
    return (
      <div key={msg.id} className={`mb-2 ${isOwnMessage ? 'text-right' : 'text-left'}`}>
        <div className={`inline-block max-w-xs lg:max-w-md px-3 py-2 rounded-lg ${
          isOwnMessage 
            ? 'bg-blue-500 text-white' 
            : 'bg-gray-200 text-gray-800'
        }`}>
          <div className="text-xs opacity-75 mb-1">
            {msg.username} • {formatTime(msg.timestamp)}
          </div>
          <div className="text-sm">{msg.message}</div>
        </div>
      </div>
    );
  };

  return (
    <div className="mt-4 w-full max-w-md bg-white rounded-lg shadow-md h-80 flex flex-col">
      {/* Chat Header */}
      <div className="bg-blue-500 text-white p-3 rounded-t-lg flex justify-between items-center">
        <h2 className="text-lg font-bold">Live Chat</h2>
        <div className="flex items-center space-x-2">
          <div className="flex items-center">
            <div className="w-2 h-2 bg-green-400 rounded-full mr-1"></div>
            <span className="text-sm">{viewerCount} viewers</span>
          </div>
        </div>
      </div>

      {/* Messages Container */}
      <div 
        ref={chatContainerRef} 
        className="flex-grow overflow-y-auto p-3 space-y-1 bg-gray-50"
        style={{ maxHeight: '240px' }}
      >
        {messages.length === 0 ? (
          <div className="text-center text-gray-500 text-sm mt-4">
            No messages yet. Start the conversation! 💬
          </div>
        ) : (
          messages.map(formatMessage)
        )}
      </div>

      {/* Message Input */}
      <div className="p-3 border-t border-gray-200">
        <form onSubmit={sendMessage} className="flex">
          <input
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            className="flex-grow p-2 text-sm border rounded-l-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="Type a message..."
            maxLength={200}
            disabled={!roomId}
          />
          <button 
            type="submit" 
            className="bg-blue-500 text-white px-4 py-2 rounded-r-lg hover:bg-blue-600 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
            disabled={!message.trim() || !roomId}
          >
            Send
          </button>
        </form>
        <div className="text-xs text-gray-500 mt-1">
          Room: {roomId || 'Not connected'}
        </div>
      </div>
    </div>
  );
}

export default Chat; 