import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';

// Create socket connection with authentication
const createSocket = (roomId) => {
  // Generate a temporary token for authentication
  const token = `temp_${Math.random().toString(36).substring(2, 15)}`;
  
  return io('http://localhost:5000', {
    query: { token },
    auth: { token },
    // Only connect when explicitly requested
    autoConnect: false
  });
};

function Chat() {
  const [messages, setMessages] = useState([]);
  const [message, setMessage] = useState('');
  const chatContainerRef = useRef(null);
  const socketRef = useRef(null);

  useEffect(() => {
    // Initialize socket connection
    socketRef.current = createSocket();
    
    // Connect socket when component mounts
    socketRef.current.connect();
    
    // Set up event listeners
    socketRef.current.on('chat message', (msg) => {
      setMessages((prevMessages) => [...prevMessages, msg]);
    });
    
    // Clean up socket connection when component unmounts
    return () => {
      if (socketRef.current) {
        socketRef.current.off('chat message');
        socketRef.current.disconnect();
      }
    };
  }, []);

  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [messages]);

  const sendMessage = (e) => {
    e.preventDefault();
    if (message.trim() && socketRef.current) {
      socketRef.current.emit('chat message', message);
      setMessage('');
    }
  };

  return (
    <div className="mt-4 w-full max-w-md bg-white rounded-lg shadow-md p-4 h-64 flex flex-col">
      <h2 className="text-xl font-bold mb-2">Chat</h2>
      <div ref={chatContainerRef} className="flex-grow overflow-y-auto mb-2 border-b border-gray-200">
        {messages.map((msg, index) => (
          <div key={index} className="text-gray-800 py-1">{msg}</div>
        ))}
      </div>
      <form onSubmit={sendMessage} className="flex">
        <input
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          className="flex-grow p-2 border rounded-l-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Type a message..."
        />
        <button type="submit" className="bg-blue-500 text-white p-2 rounded-r-lg hover:bg-blue-700">Send</button>
      </form>
    </div>
  );
}

export default Chat; 