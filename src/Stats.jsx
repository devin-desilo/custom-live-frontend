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

function Stats() {
  const [viewerCount, setViewerCount] = useState(0);
  const [viewers, setViewers] = useState([]);
  const [showViewers, setShowViewers] = useState(false);
  const [roomId, setRoomId] = useState(new URLSearchParams(window.location.search).get('room') || '');
  const socketRef = useRef(null);

  useEffect(() => {
    // Initialize socket connection
    socketRef.current = createSocket(roomId);
    
    // Connect socket when component mounts
    socketRef.current.connect();
    
    // Set up event listeners
    socketRef.current.on('viewerCount', (count) => {
      console.log('Received viewer count update:', count);
      setViewerCount(count);
    });

    socketRef.current.on('viewer_list', (data) => {
      console.log('Received viewer list for room', data.roomId, ':', data.viewers);
      setViewers(data.viewers);
      setShowViewers(true);
    });

    // Request initial viewer count when component mounts
    if (roomId) {
      socketRef.current.emit('request_viewer_list', roomId);
      console.log('Requested initial viewer list for room:', roomId);
    }
    
    // Clean up socket connection when component unmounts
    return () => {
      if (socketRef.current) {
        socketRef.current.off('viewerCount');
        socketRef.current.off('viewer_list');
        socketRef.current.disconnect();
      }
    };
  }, [roomId]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlRoom = params.get('room');
    if (urlRoom) {
      setRoomId(urlRoom);
    }
  }, []);

  const handleViewerCountClick = () => {
    if (roomId && socketRef.current) {
      socketRef.current.emit('request_viewer_list', roomId);
    }
  };

  return (
    <div className="mt-4 w-full max-w-md bg-white rounded-lg shadow-md p-4">
      <h2 className="text-xl font-bold mb-2">Stream Stats</h2>
      <p className="text-gray-700 cursor-pointer hover:underline" onClick={handleViewerCountClick}>
        Current Viewers: {viewers.length}
      </p>
      {showViewers && viewers.length > 0 && (
        <div className="mt-2 max-h-48 overflow-y-auto border-t border-gray-200">
          <h3 className="text-lg font-semibold">Viewers:</h3>
          <ul className="list-disc pl-5 text-gray-700">
            {viewers.map((viewer, index) => (
              <li key={index}>{viewer}</li>
            ))}
          </ul>
          <button onClick={() => setShowViewers(false)} className="mt-2 bg-gray-300 text-gray-800 p-1 rounded hover:bg-gray-400">Close</button>
        </div>
      )}
    </div>
  );
}

export default Stats; 